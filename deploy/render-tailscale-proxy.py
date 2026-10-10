#!/usr/bin/env python3
"""Prepare private host files for the Tailscale Serve -> nginx -> Kaiwa path.

Run as root. Existing valid credentials are reused, never rotated implicitly.
Rendered configuration and credentials are never printed.
"""
import argparse
import os
from pathlib import Path
import re
import secrets
import stat
import tempfile

SECRET_MARKER = '__KAIWA_PROXY_SECRET__'


def prepare_directory(directory: Path) -> None:
    if directory.is_symlink():
        raise ValueError('The private destination must not be a symbolic link.')
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    if not directory.is_dir() or directory.stat().st_uid != 0:
        raise ValueError('The private destination must be a root-owned directory.')
    os.chown(directory, 0, 0)
    os.chmod(directory, 0o700)


def read_existing_secret(path: Path) -> str:
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(descriptor, 'r', encoding='ascii') as secret_file:
        metadata = os.fstat(secret_file.fileno())
        if not stat.S_ISREG(metadata.st_mode) or metadata.st_uid != 0 or metadata.st_nlink != 1:
            raise ValueError('Existing credentials must be a root-owned regular file.')
        secret = secret_file.read(67).removesuffix('\n')
        if not re.fullmatch(r'[0-9a-f]{64}', secret):
            raise ValueError('Existing credentials do not contain a valid 256-bit secret.')
        os.fchown(secret_file.fileno(), 0, 1000)
        os.fchmod(secret_file.fileno(), 0o440)
    return secret


def load_or_create_secret(directory: Path) -> str:
    path = directory / 'proxy-secret'
    try:
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    except FileExistsError:
        return read_existing_secret(path)
    secret = secrets.token_hex(32)
    with os.fdopen(descriptor, 'w', encoding='ascii') as secret_file:
        secret_file.write(secret + '\n')
        secret_file.flush()
        os.fsync(secret_file.fileno())
        os.fchown(secret_file.fileno(), 0, 1000)
        os.fchmod(secret_file.fileno(), 0o440)
    return secret


def write_private_config(directory: Path, rendered_config: str) -> None:
    descriptor, temporary_path = tempfile.mkstemp(prefix='.proxy-', dir=directory)
    try:
        with os.fdopen(descriptor, 'w', encoding='utf-8') as config_file:
            config_file.write(rendered_config)
            config_file.flush()
            os.fsync(config_file.fileno())
            os.fchown(config_file.fileno(), 0, 101)
            os.fchmod(config_file.fileno(), 0o440)
        os.replace(temporary_path, directory / 'proxy.conf')
    finally:
        Path(temporary_path).unlink(missing_ok=True)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory', type=Path, default=Path('/etc/kaiwa/tailscale'))
    parser.add_argument('--template', type=Path,
                        default=Path(__file__).resolve().with_name('tailscale-proxy.conf.example'))
    arguments = parser.parse_args()
    if os.geteuid() != 0:
        raise SystemExit('Run the private proxy renderer as root.')
    os.umask(0o077)
    try:
        template = arguments.template.read_text(encoding='utf-8')
        if template.count(SECRET_MARKER) != 1:
            raise ValueError('The proxy template requires exactly one secret marker.')
        prepare_directory(arguments.directory)
        secret = load_or_create_secret(arguments.directory)
        write_private_config(arguments.directory, template.replace(SECRET_MARKER, secret))
    except (OSError, ValueError) as error:
        # OS exceptions may quote file contents supplied to APIs; keep errors generic.
        raise SystemExit('Could not prepare private proxy files; check destination, template and permissions.') from error


if __name__ == '__main__':
    main()
