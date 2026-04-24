export const DEFAULT_ACCOUNT_ID = "default"

const VALID_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/i
const INVALID_CHARS_RE = /[^a-z0-9_-]+/g
const LEADING_DASH_RE = /^-+/g
const TRAILING_DASH_RE = /-+$/g
const BLOCKED = new Set(["__proto__", "constructor", "prototype"])

function canonicalizeAccountId(value) {
  if (VALID_ID_RE.test(value)) {
    return value.toLowerCase()
  }

  return value
    .toLowerCase()
    .replace(INVALID_CHARS_RE, "-")
    .replace(LEADING_DASH_RE, "")
    .replace(TRAILING_DASH_RE, "")
    .slice(0, 64)
}

export function normalizeAccountId(value) {
  const trimmed = String(value ?? "").trim()
  if (!trimmed) {
    return DEFAULT_ACCOUNT_ID
  }

  const normalized = canonicalizeAccountId(trimmed)
  if (!normalized || BLOCKED.has(normalized)) {
    return DEFAULT_ACCOUNT_ID
  }

  return normalized
}

export function normalizeOptionalAccountId(value) {
  const trimmed = String(value ?? "").trim()
  if (!trimmed) {
    return undefined
  }

  const normalized = canonicalizeAccountId(trimmed)
  if (!normalized || BLOCKED.has(normalized)) {
    return undefined
  }

  return normalized
}
