#!/usr/bin/env python3
"""Exercise the actual shell backup downloader with a synthetic SSH endpoint.

Designed before the portability fix: BSD chmod rejecting --, spaces/dashes in
paths, partial output followed by SSH failure, invalid/incomplete/corrupt SQLite,
and symlink destinations. No production connection or personal data is used.
Run on macOS or Linux with --evidence-dir outside the repository.
"""
import argparse
import json
import os
from pathlib import Path
import platform
import sqlite3
import stat
import subprocess
import sys
import tempfile


TABLES = ('profile', 'sessions', 'vocab', 'personal_memories',
          'companion_messages', 'memory_context_state')
SSH_FIXTURE = '''#!/usr/bin/env python3
import os
from pathlib import Path
import sys
expected = ['-T', '-i', os.environ['KAIWA_SSH_IDENTITY'], '-o', 'BatchMode=yes',
            '-o', 'IdentitiesOnly=yes', '-o', 'ConnectTimeout=10', 'admin@fixture',
            'sudo -n /usr/local/libexec/kaiwa-export-backup.sh']
if sys.argv[1:] != expected:
    raise SystemExit(97)
Path(os.environ['KAIWA_TEST_INVOKED']).write_text('invoked')
sys.stdout.buffer.write(Path(os.environ['KAIWA_TEST_SNAPSHOT']).read_bytes())
sys.stdout.buffer.flush()
raise SystemExit(int(os.environ.get('KAIWA_TEST_SSH_EXIT', '0')))
'''


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def snapshot(path, tables):
    with sqlite3.connect(path) as database:
        for table in tables:
            database.execute(f'CREATE TABLE {table} (value TEXT)')
            database.execute(f'INSERT INTO {table} VALUES (?)', ('synthetic-only',))


def fixtures(directory):
    fixture_bin = directory / 'fixture bin'
    fixture_bin.mkdir()
    executable = fixture_bin / 'ssh'
    executable.write_text(SSH_FIXTURE)
    executable.chmod(0o755)
    valid = directory / 'complete.db'
    snapshot(valid, TABLES)
    incomplete = directory / 'incomplete.db'
    snapshot(incomplete, TABLES[:-1])
    corrupt = directory / 'corrupt.db'
    corrupt.write_bytes(valid.read_bytes()[:512])
    invalid = directory / 'invalid.db'
    invalid.write_bytes(b'not a SQLite snapshot\n')
    return fixture_bin, {'valid': valid, 'incomplete': incomplete,
                         'corrupt': corrupt, 'invalid': invalid}


def invoke(script, case, fixture_bin, snapshot_path):
    environment = os.environ.copy()
    environment.update({'PATH': str(fixture_bin) + os.pathsep + environment['PATH'],
        'KAIWA_SSH_IDENTITY': str(case['cwd'] / '-synthetic identity'),
        'KAIWA_SSH_TARGET': 'admin@fixture',
        'KAIWA_TEST_INVOKED': str(case['cwd'] / 'ssh-invoked'),
        'KAIWA_TEST_SNAPSHOT': str(snapshot_path),
        'KAIWA_TEST_SSH_EXIT': str(case.get('ssh_exit', 0))})
    return subprocess.run(['bash', str(script), case['argument']], cwd=case['cwd'],
                          env=environment, capture_output=True, timeout=20, check=False)


def check_success(destination):
    require(stat.S_IMODE(destination.stat().st_mode) == 0o700, 'Backup directory is not 0700')
    published = list(destination.iterdir())
    require(len(published) == 1 and published[0].name.startswith('kaiwa-rushia-')
            and published[0].suffix == '.db', 'Expected exactly one published SQLite backup')
    require(stat.S_IMODE(published[0].stat().st_mode) == 0o600, 'Backup file is not 0600')
    with sqlite3.connect(published[0].as_uri() + '?mode=ro', uri=True) as database:
        require(database.execute('PRAGMA integrity_check').fetchone()[0] == 'ok',
                'Published SQLite snapshot failed integrity check')
        for table in TABLES:
            require(database.execute(f'SELECT value FROM {table}').fetchall() == [('synthetic-only',)],
                    'Published SQLite snapshot did not preserve synthetic records')


def run_case(script, directory, fixture, specification):
    fixture_bin, snapshots = fixture
    case = dict(specification)
    case['cwd'] = directory / case['name']
    case['cwd'].mkdir()
    destination = case['cwd'] / case.get('path', 'private backups')
    case['argument'] = destination.name if case.get('relative') else str(destination)
    if case.get('symlink'):
        target = case['cwd'] / 'external'
        target.mkdir()
        destination.symlink_to(target, target_is_directory=True)
    result = invoke(script, case, fixture_bin, snapshots[case.get('snapshot', 'valid')])
    invoked = (case['cwd'] / 'ssh-invoked').exists()
    require(invoked is not case.get('symlink', False), 'SSH fixture did not reach the expected boundary')
    if case.get('success'):
        require(result.returncode == 0, 'Valid snapshot download failed')
        check_success(destination)
        return
    require(result.returncode != 0, 'Unsafe or failed download was accepted')
    require(not list(destination.iterdir()), 'Failed download left a published or temporary file')
    require(not result.stdout, 'Rejected download printed success output')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--evidence-dir', type=Path, required=True)
    arguments = parser.parse_args()
    os.umask(0o077)
    arguments.evidence_dir.mkdir(parents=True, exist_ok=True)
    script = Path(__file__).resolve().with_name('pull-backup.sh')
    cases = [
        {'name': 'absolute-spaces', 'success': True},
        {'name': 'relative-spaces', 'relative': True, 'success': True},
        {'name': 'relative-leading-dash', 'path': '-private backups', 'relative': True, 'success': True},
        {'name': 'ssh-partial-output-error', 'ssh_exit': 255},
        {'name': 'invalid-header', 'snapshot': 'invalid'},
        {'name': 'incomplete-schema', 'snapshot': 'incomplete'},
        {'name': 'corrupt-snapshot', 'snapshot': 'corrupt'},
        {'name': 'symlink-directory', 'symlink': True},
    ]
    outcome = {'platform': platform.system(), 'scope': 'synthetic SSH and temporary SQLite only',
               'procedure': 'python3 deploy/check-pull-backup.py --evidence-dir <private-directory>',
               'checks': []}
    with tempfile.TemporaryDirectory(prefix='kaiwa-pull-backup-e2e-') as temporary:
        directory = Path(temporary)
        fixture = fixtures(directory)
        for case in cases:
            check = {'name': case['name']}
            try:
                run_case(script, directory, fixture, case)
                check['result'] = 'passed'
            except Exception as error:
                check.update(result='failed', error=str(error) if isinstance(error, RuntimeError)
                             else type(error).__name__)
            outcome['checks'].append(check)
    outcome['result'] = 'passed' if all(check['result'] == 'passed' for check in outcome['checks']) else 'failed'
    (arguments.evidence_dir / 'result.json').write_text(json.dumps(outcome, indent=2) + '\n')
    print(json.dumps(outcome, indent=2))
    return 0 if outcome['result'] == 'passed' else 1


if __name__ == '__main__':
    sys.exit(main())
