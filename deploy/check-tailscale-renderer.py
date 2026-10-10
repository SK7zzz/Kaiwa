#!/usr/bin/env python3
"""Exercise the real root-only renderer in temporary directories, without Docker.

Failure cases were written before the renderer: invalid/reused secrets,
symlinks, foreign ownership, malformed templates, and leaked/private output.
No secret values or rendered configuration are retained in the report.
"""
import argparse
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import tempfile


def invoke(renderer, directory, template=None):
    command = [sys.executable, str(renderer), '--directory', str(directory)]
    if template is not None:
        command.extend(['--template', str(template)])
    return subprocess.run(command, capture_output=True)


def require_refusal(result):
    if result.returncode == 0 or result.stdout:
        raise RuntimeError('Unsafe renderer input was not refused quietly')


def exercise(renderer, directory):
    destination = directory / 'private'
    result = invoke(renderer, destination)
    if result.returncode or result.stdout:
        raise RuntimeError('Renderer failed or emitted private output')
    secret_path = destination / 'proxy-secret'
    config_path = destination / 'proxy.conf'
    secret = secret_path.read_text().strip()
    if not re.fullmatch(r'[0-9a-f]{64}', secret):
        raise RuntimeError('Renderer did not generate a 256-bit secret')
    if secret not in config_path.read_text() or '__KAIWA_PROXY_SECRET__' in config_path.read_text():
        raise RuntimeError('Rendered proxy and app secret do not match')
    for path, mode, group in ((destination, 0o700, 0), (secret_path, 0o440, 1000), (config_path, 0o440, 101)):
        metadata = path.stat()
        if metadata.st_uid != 0 or metadata.st_gid != group or stat.S_IMODE(metadata.st_mode) != mode:
            raise RuntimeError('A private renderer output has incorrect ownership or permissions')
    repeated = invoke(renderer, destination)
    if repeated.returncode or repeated.stdout or secret_path.read_text().strip() != secret:
        raise RuntimeError('Re-running the renderer changed credentials or leaked output')
    if secret.encode() in repeated.stderr:
        raise RuntimeError('Renderer leaked credentials to stderr')

    secret_path.write_text('invalid\n')
    require_refusal(invoke(renderer, destination))
    secret_path.unlink()
    secret_path.symlink_to(directory / 'external-secret')
    require_refusal(invoke(renderer, destination))

    linked_directory = directory / 'linked'
    linked_directory.symlink_to(destination, target_is_directory=True)
    require_refusal(invoke(renderer, linked_directory))
    foreign_directory = directory / 'foreign'
    foreign_directory.mkdir()
    os.chown(foreign_directory, 1000, 1000)
    require_refusal(invoke(renderer, foreign_directory))

    for index, content in enumerate(('no marker', '__KAIWA_PROXY_SECRET__ __KAIWA_PROXY_SECRET__')):
        template_path = directory / f'invalid-template-{index}'
        template_path.write_text(content)
        unused_directory = directory / f'unused-{index}'
        require_refusal(invoke(renderer, unused_directory, template_path))
        if unused_directory.exists():
            raise RuntimeError('Invalid template created private state before validation')
    return ['private-secret-and-config', 'idempotent-secret', 'invalid-secret-refused',
            'secret-symlink-refused', 'directory-symlink-refused', 'foreign-owner-refused',
            'invalid-template-refused-before-write']


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--evidence-dir', type=Path, required=True)
    arguments = parser.parse_args()
    if os.geteuid() != 0:
        raise SystemExit('Run this isolated renderer check as root.')
    os.umask(0o077)
    arguments.evidence_dir.mkdir(parents=True, exist_ok=True)
    renderer = Path(__file__).resolve().with_name('render-tailscale-proxy.py')
    outcome = {'scope': 'temporary private renderer outputs; no production files'}
    try:
        with tempfile.TemporaryDirectory(prefix='kaiwa-renderer-e2e-') as temporary:
            outcome['checks'] = exercise(renderer, Path(temporary))
        outcome['result'] = 'passed'
    except Exception as error:
        outcome['result'] = 'failed'
        outcome['error'] = str(error)
        raise
    finally:
        (arguments.evidence_dir / 'result.json').write_text(json.dumps(outcome, indent=2) + '\n')


if __name__ == '__main__':
    main()
