/**
 * SSEListener — single SSE connection with per-session fan-out.
 *
 * ## Effect-based reactive design (ReactiveSSEListener)
 *
 * ```
 * SubscriptionRef<Client | null>
 *        │ .changes (Stream)
 *        ▼
 *   Stream.switchMap ──► for each new client: open SSE, dispatch events
 *        │                 Stream.ensuring: close SSE on interruption
 *        ▼
 *   forkDetach'd fiber (runs for the lifetime of ReactiveSSEListener)
 * ```
 *
 * `Stream.switchMap` provides RxJS-switchMap semantics: whenever
 * `setClient(newClient)` is called, the Effect runtime automatically
 * interrupts the old SSE fiber and starts a new one — no manual cleanup
 * required.
 *
 * The subscriber registry (`sessionRef` Map + `globalRef` Set) is shared
 * across client swaps. Unsubscribe handles remain valid forever.
 *
 * ## SSE endpoint
 *
 * Uses `client.global.event()` — the workspace-unrouted global SSE stream.
 * This endpoint delivers events for all workspaces without requiring a
 * `?directory=` query parameter.
 *
 * Note: `client.event.subscribe({ directory })` is the workspace-routed
 * alternative, but requires opencode's WorkspaceRoutingMiddleware to be
 * active and the directory to match exactly. Use `global.event()` when
 * workspace routing is not needed or not reliably available.
 *
 * ## sessionID resolution
 *
 * Different event types embed sessionID at different paths:
 *  - Top-level `properties.sessionID` — most events
 *  - `properties.part.sessionID`      — message.part.updated
 *  - `properties.info.sessionID`      — message.updated
 */

import type { OpencodeClient, Event, GlobalEvent } from "@opencode-ai/sdk/v2";
import type { Logger } from "pino";
import { Effect, Stream, SubscriptionRef, Ref } from "effect";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type SSEEventListener = (event: Event) => void;

export type SSEListenerOptions = {
    client: OpencodeClient;
    /**
     * Used only for logging / debug context. The actual SSE connection uses
     * `client.global.event()` which does not require a directory parameter.
     */
    directory?: string;
    logger?: Logger;
    /** Milliseconds of inactivity before onIdle fires. 0 = disabled. */
    idleTtlMs?: number;
    onIdle?: () => void;
};

// ---------------------------------------------------------------------------
// SSEListener — a single, concrete SSE connection
// ---------------------------------------------------------------------------

/**
 * Manages one `client.event.subscribe()` connection and fans out events to
 * registered session / global listeners.
 */
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
        this.runLoop(ctrl).catch(() => {
            /* errors are logged inside */
        });
    }

    private eventCount = 0;

    private async runLoop(ctrl: AbortController): Promise<void> {
        const { client, logger, directory } = this.opts;
        try {
            logger?.info({ directory }, "SSEListener: connecting to global.event()");
            const result = await client.global.event();
            logger?.info({ directory, resultType: typeof result, hasStream: "stream" in (result ?? {}) }, "SSEListener: connected, streaming events");
            for await (const raw of result.stream) {
                if (ctrl.signal.aborted) break;
                this.eventCount++;
                // global.event() wraps each event as { directory, payload: Event }
                const event: Event = (raw as GlobalEvent)?.payload ?? raw as unknown as Event;
                if (event && typeof event === "object" && "type" in event) {
                    this.dispatch(event);
                }
            }
            logger?.info({ directory, totalEvents: this.eventCount }, "SSEListener: stream ended normally");
        } catch (err) {
            if (!ctrl.signal.aborted)
                logger?.warn({ err, directory, eventsReceived: this.eventCount }, "SSEListener: stream error");
        } finally {
            if (this.ctrl === ctrl) this.ctrl = undefined;
        }
    }

    /** Abort the connection and clear idle timer (leaves listener registrations intact). */
    stop(): void {
        this.ctrl?.abort();
        this.ctrl = undefined;
        if (this.idleTimer) {
            clearTimeout(this.idleTimer);
            this.idleTimer = undefined;
        }
    }

    /**
     * Subscribe to events for a specific sessionID.
     * Last-writer-wins for the same sessionID. Lazily starts the connection.
     * Returns an unsubscribe fn.
     */
    addListener(sessionID: string, listener: SSEEventListener): () => void {
        this.sessions.set(sessionID, listener);
        this.start();
        return () => {
            if (this.sessions.get(sessionID) === listener)
                this.sessions.delete(sessionID);
        };
    }

    /** Subscribe to ALL events. Lazily starts the connection. Returns unsubscribe fn. */
    addGlobalListener(listener: SSEEventListener): () => void {
        this.globalListeners.add(listener);
        this.start();
        return () => this.globalListeners.delete(listener);
    }

    private dispatch(event: Event): void {
        const props = event.properties;
        if (!props || typeof props !== "object") return;

        const part =
            "part" in props
                ? (props.part as Record<string, unknown> | undefined)
                : undefined;
        const info =
            "info" in props
                ? (props.info as Record<string, unknown> | undefined)
                : undefined;

        // Resolve sessionID from whichever property path the event uses
        let sessionID: string | undefined;
        if ("sessionID" in props) sessionID = props.sessionID as string;
        else if (part?.sessionID) sessionID = part.sessionID as string;
        else if (info?.sessionID) sessionID = info.sessionID as string;

        // Reset idle timer whenever the session is active
        if (event.type === "session.status" && "status" in props) {
            const status = props.status as { type: string };
            if (status.type !== "idle") this.resetIdle();
        }

        for (const fn of this.globalListeners) {
            try {
                fn(event);
            } catch {
                /* swallow */
            }
        }
        if (sessionID) {
            const fn = this.sessions.get(sessionID);
            if (fn)
                try {
                    fn(event);
                } catch {
                    /* swallow */
                }
        }
    }

    private resetIdle(): void {
        if (!this.opts.idleTtlMs) return;
        if (this.idleTimer) clearTimeout(this.idleTimer);
        this.idleTimer = setTimeout(() => {
            this.opts.logger?.info(
                { idleTtlMs: this.opts.idleTtlMs },
                "SSEListener: idle timeout",
            );
            this.opts.onIdle?.();
        }, this.opts.idleTtlMs);
    }
}

// ---------------------------------------------------------------------------
// ReactiveSSEListener — Effect-powered, client-swappable SSE subscription hub
// ---------------------------------------------------------------------------

export type ReactiveSSEListenerOptions = {
    directory?: string;
    logger?: Logger;
    idleTtlMs?: number;
    onIdle?: () => void;
};

type SessionRegistry = Map<string, SSEEventListener>;
type GlobalRegistry = Set<SSEEventListener>;

/**
 * A stable subscription hub whose underlying OpencodeClient can be replaced
 * at runtime without any disruption to existing listener handles.
 *
 * ### Effect internals
 *
 * - `clientRef`: `SubscriptionRef<OpencodeClient | null>` — the single source
 *   of truth for which client is active.
 * - `sessionRef` / `globalRef`: `Ref<Map|Set>` — subscriber registries
 *   shared across all client swaps.
 * - Background fiber: `SubscriptionRef.changes | Stream.switchMap` — creates
 *   a new SSEListener for each non-null client, and tears down the old one
 *   automatically when the client changes (RxJS-switchMap semantics).
 *
 * ### Usage
 *
 * ```ts
 * const hub = new ReactiveSSEListener({ directory, logger });
 *
 * // Add listeners at any time — survive client swaps
 * const unsub = hub.addListener(sessionID, onEvent);
 *
 * // When sandbox restarts and you get a new client:
 * hub.setClient(newClient);
 *
 * // Tear everything down:
 * hub.stop();
 * ```
 */
export class ReactiveSSEListener {
    private readonly clientRef: SubscriptionRef.SubscriptionRef<OpencodeClient | null>;
    private readonly sessionRef: Ref.Ref<SessionRegistry>;
    private readonly globalRef: Ref.Ref<GlobalRegistry>;
    /**
     * Plain JS field (not an Effect Ref) so reads/writes are always synchronous
     * and never subject to Effect fiber scheduling races.
     */
    private activeListener: SSEListener | null = null;
    private fiber: ReturnType<typeof Effect.runFork> | undefined;

    constructor(private readonly opts: ReactiveSSEListenerOptions) {
        this.clientRef = Effect.runSync(
            SubscriptionRef.make<OpencodeClient | null>(null),
        );
        this.sessionRef = Effect.runSync(Ref.make<SessionRegistry>(new Map()));
        this.globalRef = Effect.runSync(Ref.make<GlobalRegistry>(new Set()));

        // Fork the reactive SSE loop as a detached background fiber.
        this.fiber = Effect.runFork(this.reactiveLoop());
    }

    // -------------------------------------------------------------------------
    // Reactive core
    // -------------------------------------------------------------------------

    /**
     * The main reactive loop.
     *
     * `SubscriptionRef.changes` emits the current value immediately, then on
     * every subsequent `set`. `Stream.switchMap` ensures that when a new client
     * arrives, the previous `sseStream` fiber is interrupted before the new one
     * starts — clean lifecycle with no overlap.
     */
    private reactiveLoop(): Effect.Effect<void> {
        return Stream.runDrain(
            SubscriptionRef.changes(this.clientRef).pipe(
                Stream.switchMap((client) =>
                    client === null
                        ? Stream.never // no client → park the stream, keep fiber alive
                        : this.sseStream(client),
                ),
            ),
        );
    }

    /**
     * A stream that represents one live SSE connection for `client`.
     *
     * It never emits values (all side-effects happen inside `SSEListener`), but
     * it stays alive as long as the connection is open. When `switchMap`
     * interrupts it (because a new client arrived), `Stream.ensuring` runs the
     * finalizer which cleanly shuts down the `SSEListener`.
     */
    private sseStream(client: OpencodeClient): Stream.Stream<never> {
        const {
            directory: dir,
            logger: log,
            idleTtlMs: ttl,
            onIdle: idle,
        } = this.opts;
        const self = this;
        const { sessionRef, globalRef } = this;

        const acquire = Effect.gen(function* () {
            const sessions = yield* Ref.get(sessionRef);
            const globals = yield* Ref.get(globalRef);

            const listener = new SSEListener({
                client,
                directory: dir,
                logger: log,
                idleTtlMs: ttl,
                onIdle: idle,
            });

            // Register all existing subscribers onto the new SSEListener.
            for (const [sessionID, fn] of sessions)
                listener.addListener(sessionID, fn);
            for (const fn of globals) listener.addGlobalListener(fn);

            // Eagerly start the SSE connection — global.event() streaming
            // begins immediately rather than lazily on first addListener.
            listener.start();

            // Synchronously update the plain-JS activeListener field.
            // This is safe to do from inside the Effect fiber because JS is
            // single-threaded — no other code runs concurrently.
            self.activeListener = listener;

            log?.debug(
                {
                    directory: dir,
                    sessions: sessions.size,
                    globals: globals.size,
                },
                "ReactiveSSEListener: new client, SSE started, listeners re-registered",
            );

            return listener;
        });

        return Stream.fromEffect(acquire).pipe(
            Stream.flatMap((listener) =>
                (Stream.never as Stream.Stream<never>).pipe(
                    Stream.ensuring(
                        Effect.sync(() => {
                            listener.stop();
                            if (self.activeListener === listener)
                                self.activeListener = null;
                            log?.debug(
                                { directory: dir },
                                "ReactiveSSEListener: SSE stopped (client swapped or hub stopped)",
                            );
                        }),
                    ),
                ),
            ),
        );
    }

    // -------------------------------------------------------------------------
    // Public API
    // -------------------------------------------------------------------------

    /**
     * Replace the active OpencodeClient.
     * Pass `null` to tear down the current connection without starting a new one.
     */
    setClient(client: OpencodeClient | null): void {
        Effect.runFork(SubscriptionRef.set(this.clientRef, client));
    }

    /**
     * Subscribe to events for a specific session.
     * The returned unsubscribe fn is stable across client swaps.
     */
    addListener(sessionID: string, listener: SSEEventListener): () => void {
        // 1. Persist in registry for future sseStream re-registrations.
        Effect.runFork(
            Ref.update(this.sessionRef, (m) => {
                m.set(sessionID, listener);
                return m;
            }),
        );
        // 2. Register immediately on the currently active SSEListener (plain JS
        //    field — always up-to-date, no fiber scheduling race).
        this.activeListener?.addListener(sessionID, listener);

        return () => {
            Effect.runFork(
                Ref.update(this.sessionRef, (m) => {
                    m.delete(sessionID);
                    return m;
                }),
            );
        };
    }

    addGlobalListener(listener: SSEEventListener): () => void {
        Effect.runFork(
            Ref.update(this.globalRef, (s) => {
                s.add(listener);
                return s;
            }),
        );
        this.activeListener?.addGlobalListener(listener);

        return () => {
            Effect.runFork(
                Ref.update(this.globalRef, (s) => {
                    s.delete(listener);
                    return s;
                }),
            );
        };
    }

    /**
     * Tear down: stops the background fiber (which interrupts the current
     * SSEListener via `Stream.ensuring`) and clears all registries.
     */
    stop(): void {
        // Setting client to null parks the switchMap stream; the fiber's own
        // interruption will fire the ensuring finalizer.
        Effect.runFork(SubscriptionRef.set(this.clientRef, null));
        // Clear subscriber registries
        Effect.runFork(
            Effect.all([
                Ref.set(this.sessionRef, new Map()),
                Ref.set(this.globalRef, new Set()),
            ]),
        );
    }
}
