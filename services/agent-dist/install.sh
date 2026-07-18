#!/bin/sh
# Installs the self-hosted node agent on a Linux server as a systemd service.
# The agent manages Docker containers for the panel and enrolls itself using a
# one-time join token, then keeps a persistent TLS identity + daemon token.
#
# Usage (as root):
#   PANEL_URL=https://panel.example JOIN_TOKEN=xxxx \
#     BIN_URL=https://panel.example/api/v1/node-agent/bin/linux-amd64 sh install.sh
#
# Env:
#   PANEL_URL       (required) control-plane base URL
#   JOIN_TOKEN      (required) one-time enrollment token from the panel
#   BIN_URL         URL to download the agent binary (or place ./selfhosted-agent)
#   AGENT_PORT      HTTPS port the agent listens on          (default 8443)
#   AGENT_NETWORK   default Docker network for deployments   (default bridge)
#   AGENT_PANEL_INSECURE  set to 1 if the panel uses a self-signed cert
#                         (only honored when AGENT_DEV=1 is also set)
#   AGENT_DEV       set to 1 to allow insecure dev kill-switches   (default 0)
#   INSTALL_DIR     where to place the binary                (default /usr/local/bin)
set -e

[ -n "$PANEL_URL" ]  || { echo "ERROR: set PANEL_URL" >&2; exit 1; }
[ -n "$JOIN_TOKEN" ] || { echo "ERROR: set JOIN_TOKEN" >&2; exit 1; }
AGENT_PORT="${AGENT_PORT:-8443}"
AGENT_NETWORK="${AGENT_NETWORK:-bridge}"
INSTALL_DIR="${INSTALL_DIR:-/usr/local/bin}"
STATE_DIR="/var/lib/selfhosted-agent"
BIN="$INSTALL_DIR/selfhosted-agent"

if [ "$(id -u)" != "0" ]; then
  echo "ERROR: run as root (needs Docker access + systemd)" >&2; exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: Docker is required on this node. Install Docker first." >&2; exit 1
fi

if [ -n "$BIN_URL" ]; then
  echo ">> downloading $BIN_URL"
  if command -v curl >/dev/null 2>&1; then curl -fsSL "$BIN_URL" -o "$BIN"
  else wget -qO "$BIN" "$BIN_URL"; fi
elif [ -f "./selfhosted-agent" ]; then
  cp ./selfhosted-agent "$BIN"
else
  echo "ERROR: set BIN_URL or place ./selfhosted-agent next to this script" >&2; exit 1
fi
chmod +x "$BIN"

mkdir -p "$STATE_DIR" "$STATE_DIR/builds"
chmod 700 "$STATE_DIR"

cat > /etc/selfhosted-agent.env <<EOF
PANEL_URL=$PANEL_URL
JOIN_TOKEN=$JOIN_TOKEN
AGENT_PORT=$AGENT_PORT
AGENT_NETWORK=$AGENT_NETWORK
AGENT_STATE_DIR=$STATE_DIR
AGENT_WORKDIR=$STATE_DIR/builds
AGENT_PANEL_INSECURE=${AGENT_PANEL_INSECURE:-0}
AGENT_DEV=${AGENT_DEV:-0}
EOF
chmod 600 /etc/selfhosted-agent.env

cat > /etc/systemd/system/selfhosted-agent.service <<EOF
[Unit]
Description=Self-hosted node agent
After=network-online.target docker.service
Wants=network-online.target
Requires=docker.service

[Service]
EnvironmentFile=/etc/selfhosted-agent.env
ExecStart=$BIN
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now selfhosted-agent
echo ">> installed. status:"
systemctl --no-pager status selfhosted-agent || true
