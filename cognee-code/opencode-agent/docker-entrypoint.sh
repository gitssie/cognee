#!/bin/sh
set -eu

AUTH_DIR="${OPENCODE_AUTH_DIR:-/root/.local/share/opencode}"
AUTH_FILE="$AUTH_DIR/auth.json"

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
