#!/usr/bin/env python3
"""Real Docker/Compose backup E2E using temporary projects and synthetic SQLite.

Written before the production helper changes. Never mounts production volumes,
logs in to Codex, contacts the model, or invokes helpers with their default
production project. Requires a previously built image in the selected daemon.
"""
import argparse
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import tempfile
import time
import uuid


def run(command, *, environment=None, payload=None):
    result = subprocess.run(command, input=payload, capture_output=True, env=environment)
    if result.returncode:
        raise RuntimeError(f"Command failed: {command[0]} (exit {result.returncode})")
    return result.stdout


def fixture(image, *, distractor=False):
    services = f"""services:
  kaiwa:
    image: {image}
    pull_policy: never
    environment:
      KAIWA_DEPLOYMENT: local
      KAIWA_DB_PATH: /app/data/kaiwa.db
    read_only: true
    tmpfs: [/tmp]
    volumes:
      - data:/app/data
      - snapshots:/home/kaiwa/Documents/Kaiwa Backups
  tts-distractor:
    image: {image}
    pull_policy: never
    command: [python, -c, 'import time; time.sleep(600)']
volumes:
  data:
  snapshots:
"""
    if distractor:
        return f"""services:
  kaiwa:
    image: {image}
    pull_policy: never
    command: [python, -c, 'import time; time.sleep(600)']
  tts-distractor:
    image: {image}
    pull_policy: never
    command: [python, -c, 'import time; time.sleep(600)']
"""
    return services


def wait_for_app(docker, container_id):
    deadline = time.monotonic() + 30
    command = [*docker, 'exec', container_id, 'python', '-c',
               "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8130/healthz', timeout=1).read()"]
    while time.monotonic() < deadline:
        result = subprocess.run(command, capture_output=True)
        if result.returncode == 0:
            return
        time.sleep(0.2)
    raise RuntimeError('Synthetic Kaiwa did not become ready')


def verify_snapshot(path):
    if path.read_bytes()[:16] != b'SQLite format 3\x00':
        raise RuntimeError('Export did not contain pure SQLite bytes')
    with sqlite3.connect(path.as_uri() + '?mode=ro', uri=True) as snapshot:
        if snapshot.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
            raise RuntimeError('Snapshot integrity failed')
        if snapshot.execute('SELECT name FROM profile WHERE id=1').fetchone()[0] != 'Backup E2E':
            raise RuntimeError('Export selected the wrong profile')
        if snapshot.execute('SELECT content FROM personal_memories').fetchone()[0] != 'Dato sintético backup E2E.':
            raise RuntimeError('Snapshot lost synthetic memory')


def expect_refused(command, environment):
    result = subprocess.run(command, capture_output=True, env=environment)
    if result.returncode == 0 or result.stdout:
        raise RuntimeError('Unsafe selection did not fail closed with empty stdout')


def exercise_project_file(environment, directory):
    source = Path(__file__).resolve().parent
    project_file = directory / 'compose-project'
    project_file.write_text(environment['KAIWA_COMPOSE_PROJECT'] + '\n')
    configured_environment = {**environment, 'KAIWA_BACKUP_PROJECT_FILE': str(project_file)}
    configured_environment.pop('KAIWA_COMPOSE_PROJECT')
    run(['bash', str(source / 'backup.sh')], environment=configured_environment)
    snapshot_path = directory / 'configured-export.db'
    snapshot_path.write_bytes(run(['bash', str(source / 'export-backup.sh')], environment=configured_environment))
    verify_snapshot(snapshot_path)

    # Inspect initialization only: never select/read the real fallback project.
    missing_file_environment = {**configured_environment, 'KAIWA_BACKUP_PROJECT_FILE': str(directory / 'absent-project-file')}
    initialize = ['bash', '-c', 'source "$1"; initialize_backup_target; printf "%s" "$KAIWA_COMPOSE_PROJECT"',
                  'backup-project-check', str(source / 'kaiwa-backup-container.sh')]
    if run(initialize, environment=missing_file_environment) != b'kaiwa-private':
        raise RuntimeError('Missing project file did not preserve the manual default')

    for invalid_content in ('', 'invalid project\n', environment['KAIWA_COMPOSE_PROJECT'] + '\nother\n',
                            environment['KAIWA_COMPOSE_PROJECT'] + '\n\n'):
        project_file.write_text(invalid_content)
        for helper in ('backup.sh', 'export-backup.sh'):
            expect_refused(['bash', str(source / helper)], configured_environment)
    explicit_environment = {**configured_environment, 'KAIWA_COMPOSE_PROJECT': environment['KAIWA_COMPOSE_PROJECT']}
    snapshot_path.write_bytes(run(['bash', str(source / 'export-backup.sh')], environment=explicit_environment))
    verify_snapshot(snapshot_path)
    for helper in ('backup.sh', 'export-backup.sh'):
        expect_refused(['bash', str(source / helper)], {**configured_environment, 'KAIWA_COMPOSE_PROJECT': ''})
    return ['project-file-exact-selection', 'missing-project-file-manual-fallback-without-docker-query',
            'malformed-project-file-refused', 'explicit-project-precedence-and-empty-refused']


def exercise(docker, compose, environment, directory):
    source = Path(__file__).resolve().parent
    checks = []
    container_id = run([*compose, 'ps', '-q', 'kaiwa']).decode().strip()
    wait_for_app(docker, container_id)
    run([*docker, 'exec', '--user', '1000:1000', container_id, 'python', '-c',
         "from server import db, memory; db.update_profile({'name':'Backup E2E'}); memory.add('intereses','Dato sintético backup E2E.')"])
    checks.append('synthetic-project-with-distractors')

    run(['bash', str(source / 'backup.sh')], environment=environment)
    run([*docker, 'exec', container_id, 'python', '-c',
         "import glob, os; from server import backup; snapshots=glob.glob(backup.backup_dir()+'/kaiwa-*.db'); assert snapshots; assert all(os.stat(path).st_mode & 0o077 == 0 for path in snapshots)"])
    checks.append('server-snapshot-created')
    snapshot_path = directory / 'synthetic-snapshot.db'
    snapshot_path.write_bytes(run(['bash', str(source / 'export-backup.sh')], environment=environment))
    verify_snapshot(snapshot_path)
    checks.append('consistent-export-with-memory')
    checks.extend(exercise_project_file(environment, directory))

    run([*docker, 'exec', container_id, 'python', '-c',
         "from server import db; db.update_profile({'name':'Changed synthetic profile'})"])
    run([*docker, 'exec', '-i', '--user', '1000:1000', container_id, 'python', '-c',
         "import sys; from server import backup, db; assert backup.restore_from(sys.stdin.buffer.read()) is None; assert db.get_profile()['name']=='Backup E2E'"],
        payload=snapshot_path.read_bytes())
    checks.append('real-sqlite-restore')
    run([*compose, 'restart', 'kaiwa'])
    wait_for_app(docker, container_id)
    verify_snapshot_bytes = run(['bash', str(source / 'export-backup.sh')], environment=environment)
    snapshot_path.write_bytes(verify_snapshot_bytes)
    verify_snapshot(snapshot_path)
    checks.append('survives-container-restart')

    missing_environment = {**environment, 'KAIWA_COMPOSE_PROJECT': environment['KAIWA_COMPOSE_PROJECT'] + '-absent'}
    for helper in ('backup.sh', 'export-backup.sh'):
        expect_refused(['bash', str(source / helper)], missing_environment)
    checks.append('no-matching-service-refused')
    run([*compose, 'up', '-d', '--scale', 'kaiwa=2'])
    for helper in ('backup.sh', 'export-backup.sh'):
        expect_refused(['bash', str(source / helper)], environment)
    checks.append('multiple-matching-services-refused')
    wrong_daemon = {**environment, 'KAIWA_DOCKER_HOST': 'unix://' + str(directory / 'absent.sock')}
    for helper in ('backup.sh', 'export-backup.sh'):
        expect_refused(['bash', str(source / helper)], wrong_daemon)
    checks.append('wrong-daemon-refused-without-fallback')
    return checks


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--evidence-dir', type=Path, required=True)
    arguments = parser.parse_args()
    image = os.environ.get('KAIWA_BACKUP_E2E_IMAGE')
    if not image:
        raise SystemExit('Set KAIWA_BACKUP_E2E_IMAGE to an already built image.')
    os.umask(0o077)
    arguments.evidence_dir.mkdir(parents=True, exist_ok=True)
    project = 'kaiwa-backup-e2e-' + uuid.uuid4().hex[:12]
    environment = {**os.environ, 'KAIWA_COMPOSE_PROJECT': project}
    environment.pop('DOCKER_CONTEXT', None)
    environment.pop('DOCKER_HOST', None)
    host = environment.get('KAIWA_DOCKER_HOST', 'unix:///var/run/docker.sock')
    docker = ['docker', '--host', host]
    outcome = {'scope': 'isolated Docker Compose; no production data', 'project': project, 'image': image}
    with tempfile.TemporaryDirectory(prefix='kaiwa-backup-e2e-') as temporary:
        directory = Path(temporary)
        main_file = directory / 'compose.yaml'
        distractor_file = directory / 'distractor.yaml'
        main_file.write_text(fixture(image))
        distractor_file.write_text(fixture(image, distractor=True))
        compose = [*docker, 'compose', '-p', project, '-f', str(main_file)]
        other_compose = [*docker, 'compose', '-p', project + '-other', '-f', str(distractor_file)]
        try:
            run([*other_compose, 'up', '-d'])
            run([*compose, 'up', '-d'])
            outcome['checks'] = exercise(docker, compose, environment, directory)
            outcome['result'] = 'passed'
        except Exception as error:
            outcome['result'] = 'failed'
            outcome['error'] = str(error)
            raise
        finally:
            for stack in (compose, other_compose):
                result = subprocess.run([*stack, 'down', '--volumes'], capture_output=True)
                if result.returncode:
                    outcome['result'] = 'failed'
                    outcome['cleanup_error'] = 'Could not remove an isolated test project'
            (arguments.evidence_dir / 'result.json').write_text(json.dumps(outcome, indent=2) + '\n')
    if outcome['result'] != 'passed':
        raise SystemExit(1)
    print('Backup E2E passed; sanitized evidence written to result.json.')


if __name__ == '__main__':
    main()
