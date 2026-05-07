export type { OpenClawPluginApi, ChannelPlugin } from "./core.d.ts"
export { emptyPluginConfigSchema } from "./core.js"
export { DEFAULT_ACCOUNT_ID, normalizeAccountId, normalizeOptionalAccountId } from "./account-id.js"
export { addWildcardAllowFrom } from "./setup.js"
export declare function formatPairingApproveHint(channelId: string): string
export declare function buildAccountScopedDmSecurityPolicy(params: {
  cfg: Record<string, any>
  channelKey: string
  accountId?: string | null
  fallbackAccountId?: string | null
  policy?: string | null
  allowFrom?: Array<string | number> | null
  defaultPolicy?: string
  allowFromPathSuffix?: string
  policyPathSuffix?: string
  approveChannelId?: string
  approveHint?: string
  normalizeEntry?: (raw: string) => string
}): {
  policy: string
  allowFrom: Array<string | number>
  policyPath?: string
  allowFromPath: string
  approveHint: string
  normalizeEntry?: (raw: string) => string
}
