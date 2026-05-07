/**
 * OpenCodeClientProvider — abstract interface for obtaining OpenCode clients.
 *
 * The bridge depends on this interface, not on the concrete deployment model
 * (shared server or per-user microsandbox VMs).
 *
 * Uses an opaque client handle to avoid coupling to specific SDK versions
 * that may differ between the root and vendor node_modules.
 */

/** Session-scoped client handle. */
export interface ClientHandle {
  /** Use this client for session operations (prompt, abort, compact, etc.). */
  client: any; // OpencodeClient — opaque to avoid cross-node_modules type mismatch
  /** Release the handle when done. */
  release(): Promise<void>;
}

/** Provider-level health status. */
export interface ProviderHealth {
  healthy: boolean;
  version?: string;
}

/**
 * Provider of OpenCode clients.
 *
 * Implementations:
 * - SharedServerProvider (classic mode)
 * - SandboxClientProvider (per-user microsandbox)
 */
export interface OpenCodeClientProvider {
  /** Obtain a client for a specific session identified by channel/identity/peer. */
  getClientForSession(
    channel: string,
    identityId: string,
    peerKey: string,
    directory: string,
  ): Promise<ClientHandle>;

  /** Synchronous client for a known directory (shared server only). */
  getClientForDirectory(directory: string): any; // OpencodeClient

  /** Get provider-level health. */
  getHealth(): Promise<ProviderHealth>;

  /** Subscribe to events for a directory (may be no-op in sandbox mode). */
  ensureEventSubscription(directory: string): void;

  /**
   * Provision files into a workspace directory so the OpenCode client inside
   * can access them (read, process, attach to prompts).
   *
   * Classic mode: moves files to the local target directory.
   * Sandbox mode:  syncs/copies files into the VM's workspace host mount.
   *
   * @returns Map of sourcePath → accessiblePath inside the workspace.
   */
  provisionFiles(
    sourcePaths: string[],
    targetDirectory: string,
    channel: string,
    identityId: string,
    peerKey: string,
  ): Promise<Map<string, string>>;

  /** Shut down the provider and release resources. */
  shutdown(): Promise<void>;
}
