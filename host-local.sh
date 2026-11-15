#!/usr/bin/env bash
# Backup hosting: run ΑΝΑΣΑ from this laptop when the Vercel site is down or over its free limits.
#
#   ./host-local.sh            # laptop server + public https link (needs cloudflared)
#   ./host-local.sh --lan      # laptop server for devices on the same Wi-Fi only
#   ./host-local.sh --pull     # first copy the gardens from Vercel's Redis into garden.json
#
# The laptop must stay awake while people play. Ctrl+C stops everything.
set -euo pipefail
cd "$(dirname "$0")"
PORT="${PORT:-8000}"
MODE=tunnel
for a in "$@"; do
  case "$a" in
    --lan) MODE=lan ;;
    --pull) python3 tools/pull_vercel_gardens.py ;;
    *) echo "unknown option: $a" >&2; exit 2 ;;
  esac
done

if [[ $MODE == lan ]]; then
  ip=$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<NF;i++) if($i=="src") print $(i+1)}')
  echo "Friends on this Wi-Fi open:  http://${ip:-<this-laptop-ip>}:${PORT}"
  echo "If they can't connect:      sudo firewall-cmd --add-port=${PORT}/tcp"
  echo "(Mic/Bluetooth sensing needs https, so it only works on this laptop in LAN mode.)"
  exec python3 serve.py --host 0.0.0.0 --port "$PORT"
fi

if ! command -v cloudflared >/dev/null; then
  echo "cloudflared is not installed. Install it (Fedora):"
  echo "  sudo dnf install -y https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-x86_64.rpm"
  echo "or run:  ./host-local.sh --lan"
  exit 1
fi

python3 serve.py --port "$PORT" &
SERVER=$!
trap 'kill $SERVER 2>/dev/null' EXIT
sleep 1
echo "Starting a public https link. Share the https://….trycloudflare.com address it prints below."
echo "Invite links made on the laptop site use that address automatically."
cloudflared tunnel --url "http://localhost:${PORT}"
