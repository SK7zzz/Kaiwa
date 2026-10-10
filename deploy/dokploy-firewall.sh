#!/usr/bin/env bash
# Persistent narrow rules for the private Dokploy panel and Swarm control plane.
# Does not alter the host's default policies or existing unrelated rules.
set -euo pipefail

configure_firewall() {
  local firewall_command="$1"
  local input_chain=KAIWA-DOKPLOY-IN
  local forward_chain=KAIWA-DOKPLOY-FWD

  "$firewall_command" -w -nL "$input_chain" >/dev/null 2>&1 \
    || "$firewall_command" -w -N "$input_chain"
  "$firewall_command" -w -F "$input_chain"
  "$firewall_command" -w -A "$input_chain" -i lo -j RETURN
  "$firewall_command" -w -A "$input_chain" -i tailscale0 -j RETURN
  "$firewall_command" -w -A "$input_chain" -p tcp -m multiport --dports 2377,7946,3000 -j DROP
  "$firewall_command" -w -A "$input_chain" -p udp -m multiport --dports 7946,4789 -j DROP
  "$firewall_command" -w -A "$input_chain" -j RETURN
  "$firewall_command" -w -C INPUT -j "$input_chain" >/dev/null 2>&1 \
    || "$firewall_command" -w -I INPUT 1 -j "$input_chain"

  "$firewall_command" -w -nL DOCKER-USER >/dev/null 2>&1 \
    || "$firewall_command" -w -N DOCKER-USER
  "$firewall_command" -w -nL "$forward_chain" >/dev/null 2>&1 \
    || "$firewall_command" -w -N "$forward_chain"
  "$firewall_command" -w -F "$forward_chain"
  "$firewall_command" -w -A "$forward_chain" -i lo -j RETURN
  "$firewall_command" -w -A "$forward_chain" -i tailscale0 -j RETURN
  # Docker DNAT precedes DOCKER-USER: inspect the original destination port.
  # Replies must remain possible; restricting ct direction avoids dropping them.
  "$firewall_command" -w -A "$forward_chain" -p tcp -m conntrack \
    --ctdir ORIGINAL --ctorigdstport 3000 -j DROP
  "$firewall_command" -w -A "$forward_chain" -j RETURN
  "$firewall_command" -w -C DOCKER-USER -j "$forward_chain" >/dev/null 2>&1 \
    || "$firewall_command" -w -I DOCKER-USER 1 -j "$forward_chain"
}

[[ "$(id -u)" == 0 ]] || { echo 'Run the Dokploy firewall as root.' >&2; exit 1; }
configure_firewall iptables
configure_firewall ip6tables
