export type ChannelPlugin<T = unknown> = T

export type OpenClawPluginApi = {
  id: string
  name: string
  version?: string
  description?: string
  source: string
  config: Record<string, unknown>
  pluginConfig?: Record<string, unknown>
  runtime: Record<string, unknown>
  logger: {
    debug?: (message: string) => void
    info: (message: string) => void
    warn: (message: string) => void
    error: (message: string) => void
  }
  registerTool: (tool: unknown, opts?: { name?: string; names?: string[]; optional?: boolean }) => void
  registerHook: (events: string | string[], handler: unknown, opts?: unknown) => void
  registerHttpRoute: (params: unknown) => void
  registerChannel: (registration: unknown) => void
  registerGatewayMethod: (method: string, handler: unknown) => void
  registerCli: (registrar: unknown, opts?: { commands?: string[] }) => void
  registerService: (service: unknown) => void
  registerProvider: (provider: unknown) => void
  registerCommand: (command: unknown) => void
  registerContextEngine: (id: string, factory: unknown) => void
  resolvePath: (input: string) => string
  on: (hookName: string, handler: unknown, opts?: { priority?: number }) => void
}

export declare function emptyPluginConfigSchema(): {
  safeParse(value: unknown): { success: true; data?: unknown } | { success: false; error: { issues: Array<{ path: Array<string | number>; message: string }> } }
  jsonSchema: Record<string, unknown>
}
