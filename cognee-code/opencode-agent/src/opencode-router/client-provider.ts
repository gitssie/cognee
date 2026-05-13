/**
 * OpenCodeClientProvider — abstract interface for obtaining OpenCode clients.
 */

import { OpencodeClient } from "@opencode-ai/sdk/v2";
import type { SSEListener } from "../sse-listener.js";

/** Session-scoped client handle. */
export interface ClientHandle {
    client: OpencodeClient;
    directory: string;
    sandboxId?: string;
    /** Shared SSE listener for this client (single connection, fan-out by sessionID). */
    sseListener: SSEListener;
    release(): Promise<void>;
}

export interface ProviderHealth {
    healthy: boolean;
    version?: string;
}

export interface ClientSessionContext {
    channel: string;
    identityId: string;
    peerKey: string;
    directory: string;
    sandboxId?: string | null;
}

export interface OpenCodeClientProvider {
    readonly kind?: "local" | "sandbox";
    getClientForDirectory(directory: string): Promise<ClientHandle>;
    getClientForSession(context: ClientSessionContext): Promise<ClientHandle>;
    getHealth(): Promise<ProviderHealth>;
    provisionFiles(
        sourcePaths: string[],
        targetDirectory: string,
        channel: string,
        identityId: string,
        peerKey: string,
    ): Promise<Map<string, string>>;
    shutdown(): Promise<void>;
}
