#!/usr/bin/env bash
# Build the plugin and copy it (plus deploy.sh) to the Legion Go.
# Then install on the device with:
#   ssh -t "$LEGION_HOST" 'sudo bash ~/legion-fan-stage/deploy.sh ~/legion-fan-stage'
set -euo pipefail
cd "$(dirname "$0")/.."
: "${LEGION_HOST:?set LEGION_HOST, e.g. LEGION_HOST=deck@legion-go.local}"
HOST="$LEGION_HOST"
# Extra ssh options, e.g. LEGION_SSH_OPTS="-o HostKeyAlias=legion-go.local"
read -r -a SSH_OPTS <<< "${LEGION_SSH_OPTS:-}"
NAME="Legion of Fans"

pnpm run build
STAGE="$(mktemp -d)"
mkdir -p "$STAGE/$NAME"
cp -R dist py_modules main.py plugin.json package.json LICENSE README.md "$STAGE/$NAME/"
rm -f "$STAGE/$NAME/dist/"*.map
find "$STAGE/$NAME" -name "__pycache__" -prune -exec rm -rf {} +

ssh ${SSH_OPTS[@]+"${SSH_OPTS[@]}"} "$HOST" 'rm -rf ~/legion-fan-stage && mkdir -p ~/legion-fan-stage'
scp -q ${SSH_OPTS[@]+"${SSH_OPTS[@]}"} -r "$STAGE/$NAME" "$HOST:legion-fan-stage/"
scp -q ${SSH_OPTS[@]+"${SSH_OPTS[@]}"} scripts/deploy.sh "$HOST:legion-fan-stage/"
rm -rf "$STAGE"
echo "Copiato su $HOST:~/legion-fan-stage"
