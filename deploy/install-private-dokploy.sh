#!/usr/bin/env bash
# Fresh, manual Dokploy installation on Rushia. Review before running as root.
# Intentionally never resets a Swarm, removes volumes, installs Traefik, or
# touches ado's rootless daemon. Versions/digests are explicit operator inputs.
set -euo pipefail
umask 0077

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
swarm_pool="${DOKPLOY_SWARM_POOL:-172.30.0.0/16}"
tailscale_ipv4=""

fail() { echo "$1" >&2; exit 1; }
root_docker() { docker --host unix:///var/run/docker.sock "$@"; }

validate_image_pin() {
  [[ "$1" =~ ^[a-zA-Z0-9][a-zA-Z0-9._:/-]*@sha256:[a-f0-9]{64}$ ]] \
    || fail 'Every Dokploy/Postgres/proxy image must include a verified sha256 digest.'
}

validate_commands() {
  local required_command
  for required_command in docker systemctl tailscale iptables ip6tables openssl python3 ip ss install; do
    command -v "$required_command" >/dev/null || fail "Missing command: $required_command"
  done
}

validate_image_inputs() {
  [[ -n "${DOKPLOY_IMAGE:-}" && -n "${DOKPLOY_POSTGRES_IMAGE:-}" && -n "${DOKPLOY_PROXY_IMAGE:-}" ]] \
    || fail 'Set DOKPLOY_IMAGE, DOKPLOY_POSTGRES_IMAGE and DOKPLOY_PROXY_IMAGE.'
  validate_image_pin "$DOKPLOY_IMAGE"
  validate_image_pin "$DOKPLOY_POSTGRES_IMAGE"
  validate_image_pin "$DOKPLOY_PROXY_IMAGE"
}

validate_host() {
  [[ "$(id -u)" == 0 && "$(uname -s)" == Linux ]] || fail 'Run this installer on Linux as root.'
  [[ ! -f /.dockerenv ]] || fail 'Run on the host, not in a container.'
  [[ "${DOKPLOY_START_ROOTFUL_DOCKER:-}" == 1 ]] \
    || fail 'Set DOKPLOY_START_ROOTFUL_DOCKER=1 after reviewing rootful Docker coexistence.'
  validate_commands
  validate_image_inputs
  [[ -f "$script_dir/dokploy-firewall.sh" && -f "$script_dir/dokploy-private-proxy.conf" ]] \
    || fail 'The firewall and proxy configuration must accompany this installer.'
  tailscale_ipv4="$(tailscale ip -4)"
  [[ "$tailscale_ipv4" != *$'\n'* ]] || fail 'Expected one Tailscale IPv4 address.'
  [[ -z "$(ss -H -ltn 'sport = :3000')" ]] || fail 'Port 3000 is already in use; preserve its owner.'
}

validate_networks_and_daemon() {
  python3 - "$tailscale_ipv4" "$swarm_pool" <<'PY'
import ipaddress
import json
from pathlib import Path
import subprocess
import sys

address = ipaddress.ip_address(sys.argv[1])
if address not in ipaddress.ip_network('100.64.0.0/10'):
    raise SystemExit('The panel must bind to a Tailscale IPv4 address.')
pool = ipaddress.ip_network(sys.argv[2], strict=True)
if pool.version != 4 or pool.prefixlen > 24 or not pool.is_private:
    raise SystemExit('Choose a private IPv4 Swarm address pool with /24 subnets.')
routes = json.loads(subprocess.check_output(['ip', '-j', '-4', 'route', 'show', 'table', 'all']))
for route in routes:
    destination = route.get('dst', 'default')
    if destination != 'default' and pool.overlaps(ipaddress.ip_network(destination, strict=False)):
        raise SystemExit('The requested Swarm pool overlaps an existing host route.')
configuration_file = Path('/etc/docker/daemon.json')
configuration = json.loads(configuration_file.read_text()) if configuration_file.exists() else {}
if configuration.get('data-root', '/var/lib/docker') != '/var/lib/docker':
    raise SystemExit('A custom rootful data-root needs a separate inventory before installation.')
if any(not host.startswith('unix://') for host in configuration.get('hosts', [])):
    raise SystemExit('Refusing a rootful daemon configured with a TCP API listener.')
if configuration.get('firewall-backend', 'iptables') != 'iptables' or configuration.get('iptables', True) is False:
    raise SystemExit('This firewall recipe requires Docker with its iptables backend enabled.')
containers = Path('/var/lib/docker/containers')
if containers.exists() and any(containers.iterdir()):
    raise SystemExit('Existing rootful containers need review; starting Docker could restart them.')
PY
}

install_firewall() {
  install -d -m 0750 /etc/dokploy
  install -m 0750 "$script_dir/dokploy-firewall.sh" /usr/local/sbin/kaiwa-dokploy-firewall
  install -m 0644 "$script_dir/dokploy-private-proxy.conf" /etc/dokploy/private-proxy.conf
  cat > /etc/systemd/system/kaiwa-dokploy-firewall.service <<'UNIT'
[Unit]
Description=Restrict the private Dokploy panel and Swarm ports to Tailscale
Before=docker.service
After=network-pre.target
Wants=network-pre.target

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/kaiwa-dokploy-firewall
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
UNIT
  systemctl daemon-reload
  systemctl enable --now kaiwa-dokploy-firewall.service
}

start_rootful_docker() {
  # Explicit socket selection avoids the caller's rootless Docker context.
  unset DOCKER_HOST DOCKER_CONTEXT DOCKER_TLS_VERIFY DOCKER_CERT_PATH
  systemctl unmask containerd.service docker.service docker.socket
  python3 - <<'PY'
import subprocess
unit = subprocess.check_output(['systemctl', 'show', '--property=ExecStart', '--value', 'docker.service'])
if b'tcp://' in unit:
    raise SystemExit('Refusing a Docker systemd unit configured with a TCP API listener.')
PY
  systemctl enable --now containerd.service docker.socket docker.service
  [[ "$(root_docker info --format '{{.Swarm.LocalNodeState}}')" == inactive ]] \
    || fail 'An existing Swarm must be reviewed; this installer never leaves or resets it.'
  [[ -z "$(root_docker ps -aq)" ]] || fail 'Rootful containers already exist; refusing changes.'
  local resource_name
  for resource_name in dokploy dokploy-postgres; do
    if root_docker volume inspect "$resource_name" >/dev/null 2>&1; then
      fail "Existing volume $resource_name requires review; refusing to overwrite it."
    fi
  done
}

initialize_swarm() {
  # Swarm prints a join credential on success, so never forward its stdout.
  root_docker swarm init --advertise-addr "$tailscale_ipv4" \
    --listen-addr "$tailscale_ipv4:2377" --data-path-addr "$tailscale_ipv4" \
    --default-addr-pool "$swarm_pool" --default-addr-pool-mask-length 24 >/dev/null
  root_docker network create --driver overlay --attachable --opt encrypted \
    --label dev.adonain.kaiwa.dokploy-bootstrap=true dokploy-network >/dev/null
  openssl rand -hex 32 | root_docker secret create dokploy_postgres_password - >/dev/null
  openssl rand -hex 32 | root_docker secret create dokploy_auth_secret - >/dev/null
}

create_services() {
  root_docker pull "$DOKPLOY_POSTGRES_IMAGE" >/dev/null
  root_docker pull "$DOKPLOY_IMAGE" >/dev/null
  root_docker pull "$DOKPLOY_PROXY_IMAGE" >/dev/null
  root_docker service create --name dokploy-postgres --constraint node.role==manager \
    --label dev.adonain.kaiwa.dokploy-bootstrap=true --network dokploy-network \
    --env POSTGRES_USER=dokploy --env POSTGRES_DB=dokploy \
    --secret source=dokploy_postgres_password,target=/run/secrets/postgres_password \
    --env POSTGRES_PASSWORD_FILE=/run/secrets/postgres_password \
    --mount type=volume,source=dokploy-postgres,target=/var/lib/postgresql/data \
    --limit-memory 512M --restart-condition any --restart-delay 5s \
    --log-driver json-file --log-opt max-size=10m --log-opt max-file=3 \
    "$DOKPLOY_POSTGRES_IMAGE" >/dev/null

  # No Swarm publish: only the separate, Tailscale-bound proxy can reach the UI.
  root_docker service create --name dokploy --replicas 1 --constraint node.role==manager \
    --label dev.adonain.kaiwa.dokploy-bootstrap=true --network dokploy-network \
    --mount type=bind,source=/var/run/docker.sock,target=/var/run/docker.sock \
    --mount type=bind,source=/etc/dokploy,target=/etc/dokploy \
    --mount type=volume,source=dokploy,target=/root/.docker \
    --secret source=dokploy_postgres_password,target=/run/secrets/postgres_password \
    --secret source=dokploy_auth_secret,target=/run/secrets/dokploy_auth_secret \
    --env POSTGRES_PASSWORD_FILE=/run/secrets/postgres_password \
    --env BETTER_AUTH_SECRET_FILE=/run/secrets/dokploy_auth_secret \
    --env RELEASE_TAG=latest --update-parallelism 1 --update-order stop-first \
    --limit-memory 2G --restart-condition any --restart-delay 5s \
    --log-driver json-file --log-opt max-size=10m --log-opt max-file=3 \
    "$DOKPLOY_IMAGE" >/dev/null

  root_docker run -d --name dokploy-private-proxy --restart unless-stopped \
    --network dokploy-network --publish "$tailscale_ipv4:3000:3000/tcp" \
    --label dev.adonain.kaiwa.dokploy-bootstrap=true --user 101:101 \
    --read-only --cap-drop ALL --security-opt no-new-privileges:true \
    --tmpfs /tmp:rw,noexec,nosuid,size=32m,mode=1777 \
    --mount type=bind,source=/etc/dokploy/private-proxy.conf,target=/etc/nginx/nginx.conf,readonly \
    --memory 128m --pids-limit 64 --log-opt max-size=10m --log-opt max-file=3 \
    "$DOKPLOY_PROXY_IMAGE" nginx -g 'daemon off;' >/dev/null
}

validate_host
validate_networks_and_daemon
install_firewall
start_rootful_docker
initialize_swarm
create_services
printf 'Dokploy services created. Pending readiness/access checks and owner registration: http://%s:3000\n' "$tailscale_ipv4"
