#!/usr/bin/env sh
set -eu

MSB_BIN="${MSB_BIN:-/root/.microsandbox/bin/msb}"
IMAGE="${MSB_OPENCODE_IMAGE:-ghcr.io/anomalyco/opencode:latest}"
SANDBOX_NAME="${MSB_OPENCODE_NAME:-opencode-msb-smoke}"

if [ ! -x "$MSB_BIN" ]; then
  echo "msb binary not found: $MSB_BIN" >&2
  exit 1
fi

"$MSB_BIN" rm "$SANDBOX_NAME" >/dev/null 2>&1 || true

"$MSB_BIN" run \
  --name "$SANDBOX_NAME" \
  --replace \
  --cpus 1 \
  --memory 1G \
  --pull if-missing \
  "$IMAGE" \
  -- opencode --version
