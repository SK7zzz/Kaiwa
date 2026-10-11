#!/usr/bin/env python3
"""Check the deployed private ingress as root; retain only sanitized evidence.

Failure cases: missing/duplicate services, unexpected published ports, Docker
bindings without an actual listener, broken network separation, weaker container
hardening, public Funnel, wrong Serve target, invalid TLS, spoofed identity,
accepted CSRF, direct app access without the proxy secret, and proxy reachability
from app egress. Tool errors never count as successful authorization denials.

Run after deployment, before personal-data migration:
  sudo python3 deploy/check-tailscale-ingress.py --evidence-dir /private/evidence
No credentials, profile contents, raw Docker inspection, or response bodies are
printed or retained. Only an explicitly rejected empty profile PUT is attempted.
"""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import subprocess
import sys
from urllib.error import HTTPError
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener
import uuid


PROJECT = 'kaiwa-private-imwlmy'
HOST = 'rushia-1.tail7bb611.ts.net'
LOGIN = 'adonain.dev@gmail.com'
ORIGIN = f'https://{HOST}'
DOCKER = ['docker', '--host', 'unix:///var/run/docker.sock']
SERVICES = ('kaiwa', 'tailscale-proxy', 'voicevox')


class CheckFailure(RuntimeError):
    """An intentionally sanitized assertion failure."""


def require(condition, message):
    if not condition:
        raise CheckFailure(message)


def command(arguments, timeout=30):
    environment = {key: value for key, value in os.environ.items()
                   if not key.startswith('DOCKER_')}
    try:
        result = subprocess.run(arguments, capture_output=True, timeout=timeout,
                                env=environment, check=False)
    except (OSError, subprocess.TimeoutExpired) as error:
        raise CheckFailure('Required command unavailable or timed out') from error
    require(result.returncode == 0, f'Required command returned an error (exit {result.returncode})')
    return result.stdout


def docker_json(arguments):
    try:
        return json.loads(command(DOCKER + arguments))
    except (ValueError, UnicodeError) as error:
        raise CheckFailure('Docker returned invalid JSON') from error


def inspect_services():
    containers = {}
    for service in SERVICES:
        identifiers = command(DOCKER + ['ps', '--quiet', '--no-trunc', '--filter',
            f'label=com.docker.compose.project={PROJECT}', '--filter',
            f'label=com.docker.compose.service={service}', '--filter', 'status=running']).split()
        require(len(identifiers) == 1, f'{service}: expected exactly one running container')
        inspected = docker_json(['inspect', identifiers[0].decode('ascii')])
        require(len(inspected) == 1, 'Docker container inspection was ambiguous')
        containers[service] = inspected[0]
    return containers


def bindings(port_mapping):
    return {port: entries for port, entries in (port_mapping or {}).items() if entries}


def check_ports(containers):
    expected = {'8080/tcp': [{'HostIp': '127.0.0.1', 'HostPort': '18130'}]}
    for service, container in containers.items():
        published = expected if service == 'tailscale-proxy' else {}
        require(bindings(container['HostConfig'].get('PortBindings')) == published,
                f'{service}: unexpected configured published ports')
        require(bindings(container['NetworkSettings'].get('Ports')) == published,
                f'{service}: unexpected effective published ports')
        require(not container['HostConfig'].get('PublishAllPorts'),
                f'{service}: publish-all is enabled')


def check_hardening(containers):
    for service, user in (('kaiwa', '1000:1000'), ('tailscale-proxy', '101:101')):
        container = containers[service]
        host = container['HostConfig']
        require(host.get('ReadonlyRootfs') is True, f'{service}: root filesystem is writable')
        require(set(host.get('CapDrop') or []) == {'ALL'} and not host.get('CapAdd'),
                f'{service}: capabilities were not fully dropped')
        require(not host.get('Privileged'), f'{service}: privileged container')
        require('no-new-privileges:true' in (host.get('SecurityOpt') or []),
                f'{service}: no-new-privileges is missing')
        require(container['Config'].get('User') == user, f'{service}: unexpected runtime user')


def inspect_networks(containers):
    names = set().union(*(container['NetworkSettings']['Networks'] for container in containers.values()))
    inspected = docker_json(['network', 'inspect', *sorted(names)])
    networks = {}
    for network in inspected:
        labels = network.get('Labels') or {}
        require(labels.get('com.docker.compose.project') == PROJECT,
                'A service is connected to a foreign project network')
        role = labels.get('com.docker.compose.network')
        require(role not in networks, 'Duplicate Compose network role')
        networks[role] = network
    require(set(networks) == {'kaiwa-egress', 'kaiwa-speech', 'kaiwa-proxy', 'kaiwa-ingress'},
            'Unexpected network roles')
    return networks


def check_networks(containers, networks):
    expected = {'kaiwa': {'kaiwa-egress', 'kaiwa-speech', 'kaiwa-proxy'},
                'tailscale-proxy': {'kaiwa-ingress', 'kaiwa-proxy'},
                'voicevox': {'kaiwa-speech'}}
    for service, roles in expected.items():
        names = {networks[role]['Name'] for role in roles}
        require(set(containers[service]['NetworkSettings']['Networks']) == names,
                f'{service}: unexpected network attachments')
    for role, network in networks.items():
        require(network.get('Driver') == 'bridge', 'Unexpected network driver')
        require(network.get('Internal') is (role in {'kaiwa-proxy', 'kaiwa-speech'}),
                f'{role}: incorrect internal-network setting')
        allowed = {containers[service]['Id'] for service, roles in expected.items() if role in roles}
        require(set(network.get('Containers') or {}) == allowed,
                f'{role}: unexpected container network membership')


def contains_funnel(configuration):
    if not isinstance(configuration, dict):
        return False
    if any(value is True for value in (configuration.get('AllowFunnel') or {}).values()):
        return True
    return any(contains_funnel(value) for value in configuration.values() if isinstance(value, dict))


def check_serve():
    # Official schema: tailscale.com/ipn/serve.go, ServeConfig/Web/AllowFunnel.
    try:
        configuration = json.loads(command(['tailscale', 'serve', 'status', '--json']))
    except (ValueError, UnicodeError) as error:
        raise CheckFailure('Tailscale returned invalid Serve configuration') from error
    require(isinstance(configuration, dict), 'Tailscale Serve is not configured')
    require(not contains_funnel(configuration), 'Public Funnel is enabled')
    require(configuration.get('TCP', {}).get('443') == {'HTTPS': True},
            'Serve HTTPS 443 is not configured as expected')
    handlers = configuration.get('Web', {}).get(f'{HOST}:443', {}).get('Handlers')
    require(handlers == {'/': {'Proxy': 'http://127.0.0.1:18130'}},
            'Serve hostname or upstream differs from the private proxy')
    require(not configuration.get('Foreground'), 'Ephemeral Serve overrides are active')


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, new_url):
        return None


def request(url, headers=None, body=None):
    # Disable environment proxies; the default HTTPS handler verifies certificates.
    opener = build_opener(ProxyHandler({}), NoRedirect())
    query = Request(url, headers=headers or {}, data=body,
                    method='PUT' if body is not None else 'GET')
    try:
        with opener.open(query, timeout=15) as response:
            return response.status, response.read(2_000_001)
    except HTTPError as response:
        with response:
            return response.code, b''
    except OSError as error:
        raise CheckFailure('HTTP request failed at the transport or TLS layer') from error


def profile(headers=None):
    status, body = request(f'{ORIGIN}/api/profile', headers)
    require(status == 200, 'Authenticated HTTPS profile did not return 200')
    require(len(body) <= 2_000_000, 'Profile response exceeded the safety limit')
    try:
        decoded = json.loads(body)
    except (ValueError, UnicodeError) as error:
        raise CheckFailure('Profile response was not valid JSON') from error
    require(isinstance(decoded, dict), 'Profile response was not an object')
    return decoded


def check_https():
    before = profile()
    spoofed = profile({'Tailscale-User-Login': 'other@example.invalid',
                       'X-Kaiwa-Proxy-Secret': '0' * 64})
    require(spoofed == before, 'Spoofed client headers changed the profile response')
    status, _ = request(f'{ORIGIN}/api/profile',
                        {'Origin': 'https://foreign.example.invalid',
                         'Content-Type': 'application/json'}, b'{}')
    require(status == 403, 'Cross-origin profile mutation was not explicitly rejected')
    require(profile() == before, 'Profile changed during rejected cross-origin mutation')


def check_loopback():
    for headers in ({'Host': HOST}, {'Host': HOST, 'Tailscale-User-Login': 'other@example.invalid'}):
        status, _ = request('http://127.0.0.1:18130/api/profile', headers)
        require(status == 403, 'Loopback proxy accepted missing or foreign identity')


CONTAINER_CLIENT = r'''
import errno, json, socket, sys
from urllib.error import HTTPError
from urllib.request import Request, ProxyHandler, build_opener
app_ip, host, login, *proxy_ips = sys.argv[1:]
query = Request('http://' + app_ip + ':8130/api/profile',
                headers={'Host': host, 'Tailscale-User-Login': login})
try:
    with build_opener(ProxyHandler({})).open(query, timeout=5) as response:
        status = response.status
except HTTPError as response:
    status = response.code
    response.close()
if status != 403:
    raise SystemExit(11)
outcomes = []
for address in proxy_ips:
    try:
        connection = socket.create_connection((address, 8080), timeout=3)
    except TimeoutError:
        outcomes.append('timeout')
    except OSError as error:
        if error.errno not in {errno.ECONNREFUSED, errno.EHOSTUNREACH, errno.ENETUNREACH, errno.EACCES}:
            raise SystemExit(12)
        outcomes.append('denied')
    else:
        connection.close()
        raise SystemExit(13)
print(json.dumps({'directAppStatus': status, 'proxyIsolation': outcomes}))
'''


def resolve_client_image(app, outcome):
    # Docker's containerd store can expose a config digest in container.Image,
    # while runnable image IDs and RepoDigests refer to the manifest/index.
    inspected = docker_json(['image', 'inspect', app['Config']['Image']])
    require(len(inspected) == 1, 'Client image inspection was ambiguous')
    image = inspected[0]
    references = image.get('RepoDigests') or []
    require(references and all(isinstance(reference, str) and
            re.fullmatch(r'[^\s@]+@sha256:[0-9a-f]{64}', reference) for reference in references),
            'No immutable locally available client image reference')
    reference = sorted(references)[0]
    outcome['containerImage'] = app['Image']
    outcome['imageIndexId'] = image['Id']
    outcome['clientImageReference'] = reference
    return reference


def cleanup_client(name):
    identifiers = command(DOCKER + ['ps', '--all', '--quiet', '--no-trunc',
                                   '--filter', f'name=^/{name}$']).split()
    require(len(identifiers) <= 1, 'Disposable client cleanup selection was ambiguous')
    if identifiers:
        command(DOCKER + ['rm', '--force', identifiers[0].decode('ascii')])


def check_direct_access(containers, networks, client_image):
    app = containers['kaiwa']
    proxy = containers['tailscale-proxy']
    egress = networks['kaiwa-egress']['Name']
    app_ip = app['NetworkSettings']['Networks'][egress]['IPAddress']
    proxy_ips = [attachment['IPAddress'] for attachment in proxy['NetworkSettings']['Networks'].values()]
    require(app_ip and len(proxy_ips) == 2 and all(proxy_ips), 'Missing container network addresses')
    name = f'kaiwa-ingress-check-{uuid.uuid4().hex}'
    arguments = DOCKER + ['run', '--rm', '--pull=never', '--name', name, '--network', egress,
        '--user', '1000:1000', '--read-only', '--cap-drop', 'ALL', '--security-opt',
        'no-new-privileges:true', '--pids-limit', '32', '--memory', '128m',
        '--entrypoint', 'python', client_image, '-c', CONTAINER_CLIENT,
        app_ip, HOST, LOGIN, *proxy_ips]
    try:
        outcome = json.loads(command(arguments, timeout=25))
    except CheckFailure as error:
        # Only remove this run's disposable client, including after a CLI timeout.
        try:
            cleanup_client(name)
        except CheckFailure as cleanup_error:
            raise CheckFailure(f'{error}; disposable client cleanup also failed') from cleanup_error
        raise
    except (ValueError, UnicodeError) as error:
        raise CheckFailure('Disposable client returned invalid JSON') from error
    require(outcome.get('directAppStatus') == 403, 'Direct app request was not rejected')
    isolation = outcome.get('proxyIsolation')
    require(isinstance(isolation, list) and len(isolation) == 2 and
            all(result in {'timeout', 'denied'} for result in isolation),
            'Proxy was reachable from the app egress network')


def exercise(outcome):
    containers = inspect_services()
    outcome['checks'].append('exact-running-production-services')
    client_image = resolve_client_image(containers['kaiwa'], outcome)
    check_ports(containers)
    outcome['checks'].append('configured-and-effective-private-port-bindings')
    check_hardening(containers)
    outcome['checks'].append('app-and-proxy-container-hardening')
    networks = inspect_networks(containers)
    check_networks(containers, networks)
    outcome['checks'].append('four-network-service-separation')
    check_serve()
    outcome['checks'].append('persistent-https-serve-without-funnel')
    check_https()
    outcome['checks'].extend(['verified-https-profile', 'client-spoof-overwritten',
                              'cross-origin-mutation-rejected-with-profile-unchanged'])
    check_loopback()
    outcome['checks'].append('loopback-missing-and-foreign-identity-rejected')
    check_direct_access(containers, networks, client_image)
    outcome['checks'].extend(['direct-app-without-secret-rejected',
                              'proxy-unreachable-from-app-egress'])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--evidence-dir', type=Path, required=True)
    arguments = parser.parse_args()
    require(os.geteuid() == 0, 'Run this deployed ingress check as root')
    os.umask(0o077)
    arguments.evidence_dir.mkdir(parents=True, exist_ok=True)
    outcome = {'project': PROJECT, 'origin': ORIGIN, 'dockerSocket': '/var/run/docker.sock',
               'startedAt': datetime.now(timezone.utc).isoformat(), 'checks': []}
    try:
        exercise(outcome)
        outcome['result'] = 'passed'
    except Exception as error:
        outcome['result'] = 'failed'
        outcome['error'] = str(error) if isinstance(error, CheckFailure) else type(error).__name__
    outcome['finishedAt'] = datetime.now(timezone.utc).isoformat()
    (arguments.evidence_dir / 'result.json').write_text(json.dumps(outcome, indent=2) + '\n')
    print(json.dumps({'result': outcome['result'], 'passedChecks': len(outcome['checks'])}))
    return 0 if outcome['result'] == 'passed' else 1


if __name__ == '__main__':
    sys.exit(main())
