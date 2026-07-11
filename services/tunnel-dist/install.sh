#!/bin/sh
# Installs the public-side reverse-tunnel server on a Linux VDS as a systemd
# service. The VDS only relays bytes to your panel — no Docker, no app config.
#
# Usage (as root):
#   TUNNEL_TOKEN=xxxx BIN_URL=https://panel.example/api/tunnels/bin/linux-amd64 \
#     sh install.sh
#
# Env:
#   TUNNEL_TOKEN    (required) shared auth token (from the panel)
#   TUNNEL_CONTROL  control listen addr            (default :7000)
#   TUNNEL_PORTS    public ports to relay          (default 443)
#   BIN_URL         URL to download the server binary (optional if ./tunnel-server exists)
#   INSTALL_DIR     where to place the binary       (default /usr/local/bin)
set -e

[ -n "$TUNNEL_TOKEN" ] || { echo "ERROR: set TUNNEL_TOKEN" >&2; exit 1; }
TUNNEL_CONTROL="${TUNNEL_CONTROL:-:7000}"
TUNNEL_PORTS="${TUNNEL_PORTS:-443}"
INSTALL_DIR="${INSTALL_DIR:-/usr/local/bin}"
BIN="$INSTALL_DIR/selfhosted-tunnel-server"

if [ "$(id -u)" != "0" ]; then
  echo "ERROR: run as root (needs systemd + privileged ports)" >&2; exit 1
fi

if [ -n "$BIN_URL" ]; then
  echo ">> downloading $BIN_URL"
  if command -v curl >/dev/null 2>&1; then curl -fsSL "$BIN_URL" -o "$BIN"
  else wget -qO "$BIN" "$BIN_URL"; fi
elif [ -f "./tunnel-server" ]; then
  cp ./tunnel-server "$BIN"
else
  echo "ERROR: set BIN_URL or place ./tunnel-server next to this script" >&2; exit 1
fi
chmod +x "$BIN"

cat > /etc/systemd/system/selfhosted-tunnel.service <<EOF
[Unit]
Description=Self-hosted reverse tunnel server
After=network-online.target
Wants=network-online.target

[Service]
Environment=TUNNEL_TOKEN=$TUNNEL_TOKEN
Environment=TUNNEL_CONTROL=$TUNNEL_CONTROL
Environment=TUNNEL_PORTS=$TUNNEL_PORTS
ExecStart=$BIN
Restart=always
RestartSec=2
# Allow binding 80/443 without running as full root.
AmbientCapabilities=CAP_NET_BIND_SERVICE
NoNewPrivileges=true
DynamicUser=true

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now selfhosted-tunnel
echo ">> installed. status:"
systemctl --no-pager status selfhosted-tunnel || true
