/**
 * SSEListener — single SSE connection with per-session fan-out.
 *
 * Responsibilities:
 *  - Maintain a single `client.global.event()` SSE connection.
 *  - Fan-out events to registered session listeners.
 *  - Manage an idle timer: reset on `session.status=running`, fire callback
 *    on expiry so the owner can tear down the sandbox.
 *  - `addListener(sessionID, fn)` — subscribe; returns an unsubscribe fn.
 *  - `stop()` — abort the connection and clear all listeners.
 */

import type { OpencodeClient, Event } from "@opencode-ai/sdk/v2";
import type { Logger } from "pino";

export type SSEEventListener = (event: Event) => void;

export type SSEListenerOptions = {
  client: OpencodeClient;
  logger?: Logger;
  /** Milliseconds of inactivity before onIdle is called. 0 = disabled. */
  idleTtlMs?: number;
  /** Called when the idle timer fires. */
  onIdle?: () => void;
};

export class SSEListener {
  private ctrl: AbortController | undefined;
  private idleTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly sessions = new Map<string, SSEEventListener>();
  private readonly globalListeners = new Set<SSEEventListener>();

  constructor(private readonly opts: SSEListenerOptions) {}

  /** Start the SSE connection (idempotent). */
  start(): void {
    if (this.ctrl) return;
    const ctrl = new AbortController();
    this.ctrl = ctrl;
    this.resetIdle();
    this.runLoop(ctrl).catch(() => {/* silenced; logged inside */});
  }

  private async runLoop(ctrl: AbortController): Promise<void> {
    const { client, logger } = this.opts;
    try {
      const result = await client.event.subscribe();
      logger?.debug("SSEListener: connected");
      for await (const event of result.stream) {
        if (ctrl.signal.aborted) break;
        this.dispatch(event);
      }
    } catch (err) {
      if (!ctrl.signal.aborted) logger?.warn({ err }, "SSEListener: stream error");
    } finally {
      if (this.ctrl === ctrl) this.ctrl = undefined;
    }
  }

  /** Stop the SSE connection and clear all state. */
  stop(): void {
    this.ctrl?.abort();
    this.ctrl = undefined;
    if (this.idleTimer) { clearTimeout(this.idleTimer); this.idleTimer = undefined; }
  }

  /** Subscribe to events for a specific sessionID. Last-writer-wins: a new
   *  listener replaces any previous one for the same sessionID. Lazily starts
   *  the SSE connection. Returns unsubscribe fn. */
  addListener(sessionID: string, listener: SSEEventListener): () => void {
    this.sessions.set(sessionID, listener);
    this.start(); // lazy start
    return () => {
      if (this.sessions.get(sessionID) === listener) this.sessions.delete(sessionID);
    };
  }

  /** Subscribe to ALL events regardless of sessionID. Lazily starts the SSE connection. Returns unsubscribe fn. */
  addGlobalListener(listener: SSEEventListener): () => void {
    this.globalListeners.add(listener);
    this.start(); // lazy start
    return () => this.globalListeners.delete(listener);
  }

  private dispatch(event: Event): void {

    const props = event.properties;
    const part = "part" in props ? (props.part as Record<string, unknown> | undefined) : undefined;
    const sessionID = ("sessionID" in props ? props.sessionID : part?.sessionID) as string | undefined;

    // Idle timer management: reset on any non-idle session status.
    if (event.type === "session.status" && "status" in props) {
      const status = props.status as { type: string };
      if (status.type !== "idle") this.resetIdle();
    }

    // Notify global listeners
    for (const fn of this.globalListeners) {
      try { fn(event); } catch { /* swallow */ }
    }

    // Notify session-specific listener
    if (sessionID) {
      const fn = this.sessions.get(sessionID);
      if (fn) try { fn(event); } catch { /* swallow */ }
    }
  }

  private resetIdle(): void {
    if (!this.opts.idleTtlMs) return;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      this.opts.logger?.info({ idleTtlMs: this.opts.idleTtlMs }, "SSEListener: idle timeout");
      this.opts.onIdle?.();
    }, this.opts.idleTtlMs);
  }
}
