import type { Config } from "./config.js";
import type { ClientHandle, ClientSessionContext, OpenCodeClientProvider, ProviderHealth } from "./client-provider.js";

export type OpencodeInstanceKind = "local" | "sandbox";

export type OpencodeSession = ClientSessionContext & {
    peerId?: string;
    sessionID?: string;
};

export abstract class OpencodeInstance {
    constructor(
        readonly kind: OpencodeInstanceKind,
        protected readonly provider: OpenCodeClientProvider,
        protected readonly config: Config,
    ) {}

    getClient(session: OpencodeSession): Promise<ClientHandle> {
        return this.provider.getClientForSession(session);
    }

    getWorkspaceDirectory(_session?: Partial<OpencodeSession>): string {
        return this.config.opencodeDirectory;
    }

    provisionFiles(sourcePaths: string[], session: OpencodeSession): Promise<Map<string, string>> {
        return this.provider.provisionFiles(
            sourcePaths,
            session.directory,
            session.channel,
            session.identityId,
            session.peerKey,
        );
    }

    getHealth(): Promise<ProviderHealth> {
        return this.provider.getHealth();
    }

    shutdown(): Promise<void> {
        return this.provider.shutdown();
    }
}

export class LocalOpencodeInstance extends OpencodeInstance {
    constructor(provider: OpenCodeClientProvider, config: Config) {
        super("local", provider, config);
    }
}

export class SandboxOpencodeInstance extends OpencodeInstance {
    constructor(provider: OpenCodeClientProvider, config: Config) {
        super("sandbox", provider, config);
    }

    getWorkspaceDirectory(): string {
        return "/workspace";
    }
}

export function createOpencodeInstance(input: {
    provider: OpenCodeClientProvider;
    config: Config;
    sandboxEnabled?: boolean;
}): OpencodeInstance {
    return input.sandboxEnabled ? new SandboxOpencodeInstance(input.provider, input.config) : new LocalOpencodeInstance(input.provider, input.config);
}
