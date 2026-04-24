export function addWildcardAllowFrom(allowFrom) {
  const next = (allowFrom ?? []).map((value) => String(value).trim()).filter(Boolean)
  if (!next.includes("*")) {
    next.push("*")
  }
  return next
}
