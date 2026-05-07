export { emptyPluginConfigSchema } from "./core.js"
export { DEFAULT_ACCOUNT_ID, normalizeAccountId, normalizeOptionalAccountId } from "./account-id.js"
export { addWildcardAllowFrom } from "./setup.js"

export function formatPairingApproveHint(channelId) {
  return `Approve via: openclaw pairing list ${channelId} / openclaw pairing approve ${channelId} <code>`
}

export function buildAccountScopedDmSecurityPolicy(params) {
  const resolvedAccountId = params.accountId ?? params.fallbackAccountId ?? DEFAULT_ACCOUNT_ID
  const channelConfig = params.cfg?.channels?.[params.channelKey]
  const useAccountPath = Boolean(channelConfig?.accounts?.[resolvedAccountId])
  const basePath = useAccountPath
    ? `channels.${params.channelKey}.accounts.${resolvedAccountId}.`
    : `channels.${params.channelKey}.`
  const allowFromPath = `${basePath}${params.allowFromPathSuffix ?? ""}`
  const policyPath = params.policyPathSuffix != null ? `${basePath}${params.policyPathSuffix}` : undefined

  return {
    policy: params.policy ?? params.defaultPolicy ?? "pairing",
    allowFrom: params.allowFrom ?? [],
    policyPath,
    allowFromPath,
    approveHint: params.approveHint ?? formatPairingApproveHint(params.approveChannelId ?? params.channelKey),
    normalizeEntry: params.normalizeEntry,
  }
}
