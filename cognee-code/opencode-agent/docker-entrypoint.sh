#!/bin/sh
set -eu

AUTH_DIR="${OPENCODE_AUTH_DIR:-/root/.local/share/opencode}"
AUTH_FILE="$AUTH_DIR/auth.json"
MSB_HOME_DEFAULT="/home/opencode-agent"
MSB_BIN="${MSB_PATH:-/root/.microsandbox/bin/msb}"
MSB_LIB_DIR="${MSB_LIB_DIR:-/root/.microsandbox/lib}"

if [ "${OPENCODE_SANDBOX_ENABLED:-}" = "true" ] || [ "${OPENCODE_SANDBOX_ENABLED:-}" = "1" ]; then
  if [ ! -x "$MSB_BIN" ]; then
    echo "msb binary not mounted: $MSB_BIN" >&2
    echo "Run the container with: --network host --privileged --device /dev/kvm -v /home/opencode-agent:/home/opencode-agent" >&2
    exit 1
  fi

  export MSB_PATH="$MSB_BIN"
  export LD_LIBRARY_PATH="$MSB_LIB_DIR${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
  export HOME="${MSB_HOME:-$MSB_HOME_DEFAULT}"
  export OPENCODE_ROUTER_ROOT_DIR="${OPENCODE_ROUTER_ROOT_DIR:-$HOME/.opencode-router}"
fi

mkdir -p "$AUTH_DIR"

if [ -n "${OPENCODE_AUTH_JSON:-}" ]; then
  printf '%s\n' "$OPENCODE_AUTH_JSON" > "$AUTH_FILE"
elif [ ! -f "$AUTH_FILE" ]; then
  bun --eval '
    const { mkdirSync, writeFileSync } = require("node:fs");
    const authDir = process.env.OPENCODE_AUTH_DIR || "/root/.local/share/opencode";
    const authFile = `${authDir}/auth.json`;
    const auth = {};

    if (process.env.KIMI_FOR_CODING_API_KEY) {
      auth["kimi-for-coding"] = { type: "api", key: process.env.KIMI_FOR_CODING_API_KEY };
    }
    if (process.env.DEEPSEEK_API_KEY) {
      auth.deepseek = { type: "api", key: process.env.DEEPSEEK_API_KEY };
    }

    if (Object.keys(auth).length > 0) {
      mkdirSync(authDir, { recursive: true });
      writeFileSync(authFile, `${JSON.stringify(auth, null, 2)}\n`, "utf8");
    }
  '
fi

exec "$@"
