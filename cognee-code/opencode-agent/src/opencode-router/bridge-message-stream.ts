/**
 * bridge-message-stream — per-session SSE consumer with client-side prompt queue.
 *
 * ## Design
 *
 * opencode 서버는 세션이 busy 상태일 때 `promptAsync` 를 호출하면 `BusyError (HTTP 400)` 를 반환합니다.
 * 따라서 클라이언트 측에서 큐를 관리해야 합니다:
 *
 * - 세션이 idle → 즉시 `promptAsync` 호출 + SSE 대기
 * - 세션이 busy → pending 큐에 추가 (promptAsync 호출 안 함)
 * - `session.idle` 도달 → 큐에서 다음 prompt 꺼내서 처리
 *
 * ```
 * handle.sseListener  ─────────────────────────────────────────
 *   (영구 등록, session.idle 도달 시 해제)
 *                            │  SSE 이벤트
 *                            ↓
 *                     Queue.unbounded<Event>()   ← 세션당 1개
 *                            │
 *                     Stream.fromQueue
 *                            │ takeUntil(idle|error)
 *                            ↓
 *                     응답 대기 Fiber
 *                            │ 완료 시 → pending 큐 처리
 *                            ↓
 *                     (다음 prompt 있으면 자동 처리)
 * ```
 */

import { Effect, Queue, Stream, Fiber } from "effect";
import type { Event } from "@opencode-ai/sdk/v2";
import type { ClientHandle } from "./client-provider.js";

export type BridgeStreamEvent = Event;
export type BridgeStreamListener = (event: Event) => void;

export type ConsumeOptions = {
  promptAsync: () => Promise<unknown>;
  onText: (text: string) => Promise<void>;
  logger?: { info: (msg: string, data?: Record<string, unknown>) => void };
};

export type BridgeMessageStream = {
  addListener(sessionID: string, handle: ClientHandle, listener: BridgeStreamListener): () => void;
  consumeSession(
    sessionID: string,
    handle: ClientHandle,
    options: ConsumeOptions,
  ): Promise<unknown>;
};

/** Returns true when this event signals the end of a session's turn. */
function isTerminalEvent(event: Event): boolean {
  if (event.type === "session.idle") return true;
  if (event.type === "session.error") return true;
  if (event.type === "session.status") {
    const status = (event.properties as { status?: { type?: string } }).status;
    if (status?.type === "idle") return true;
  }
  return false;
}

/** Per-session state. */
type SessionState = {
  handle: ClientHandle;
  queue: Queue.Queue<Event>;
  unsub: () => void;
  /** Whether a response is currently being awaited. */
  busy: boolean;
  /** Prompts waiting to be sent once the session becomes idle. */
  pending: ConsumeOptions[];
  /** The currently active response-wait fiber. */
  activeFiber: ReturnType<typeof Effect.runFork> | null;
};

export function createBridgeMessageStream(): BridgeMessageStream {
  const sessions = new Map<string, SessionState>();

  function cleanupSession(sessionID: string, state: SessionState, log: ConsumeOptions["logger"]): void {
    if (sessions.get(sessionID) !== state) return;
    state.unsub();
    Effect.runFork(Queue.shutdown(state.queue));
    sessions.delete(sessionID);
    state.busy = false;
    state.activeFiber = null;
  }

  /** Ensure the per-session queue and SSE listener are registered (idempotent). */
  function ensureSession(sessionID: string, handle: ClientHandle, log: ConsumeOptions["logger"]): SessionState {
    const existing = sessions.get(sessionID);
    if (existing) return existing;

    const queue = Effect.runSync(Queue.unbounded<Event>());
    const unsub = handle.sseListener.addListener(sessionID, (event) => {
      Effect.runFork(Queue.offer(queue, event));
    });

    const state: SessionState = { handle, queue, unsub, busy: false, pending: [], activeFiber: null };
    sessions.set(sessionID, state);
    return state;
  }

  /** Start sending a prompt and waiting for the response. */
  function startTurn(sessionID: string, state: SessionState, options: ConsumeOptions): void {
    const log = options.logger;
    state.busy = true;

    const textByMessage = new Map<string, string[]>();

    const waitEffect = Stream.runForEach(
      Stream.fromQueue(state.queue).pipe(
        Stream.takeUntil(isTerminalEvent),
      ),
      (event) => Effect.promise(async () => {
        if (event.type === "message.part.updated") {
          const part = event.properties.part;
          if (part.type === "text" && typeof (part as { text?: unknown }).text === "string") {
            const messageID = (part as { messageID?: string }).messageID;
            if (messageID) {
              const text = (part as { text: string }).text;
              const chunks = textByMessage.get(messageID);
              if (chunks) chunks.push(text);
              else textByMessage.set(messageID, [text]);
            }
          }
          return;
        }

        if (event.type === "message.updated") {
          const info = event.properties.info;
          const finish = (info as { finish?: string }).finish;
          if (info.role === "assistant" && finish && finish !== "tool-calls") {
            const chunks = textByMessage.get(info.id) ?? [];
            const text = chunks.join("");
            textByMessage.delete(info.id);
            log?.info("[stream] message.updated: assistant finish", {
              sessionID,
              messageID: info.id,
              finish,
              textLen: text.length,
            });
            if (text) await options.onText(text);
          }
          return;
        }

        if (event.type === "session.error") {
          const err = event.properties.error;
          const errMsg = (err && typeof err === "object" && "data" in err)
            ? String((err as { data: { message?: string } }).data?.message ?? "session error")
            : "session error";
          log?.info("[stream] session.error", { sessionID, errMsg });
          await options.onText(`Error: ${errMsg}`);
        }
      }),
    ).pipe(
      Effect.tap(() => Effect.sync(() => {
        log?.info("[stream] turn complete", { sessionID, pendingCount: state.pending.length });
        // session.idle reached — clean up and process next pending prompt (if any).
        const next = state.pending.shift();
        cleanupSession(sessionID, state, log);
        if (next) {
          // Re-register the session for the next turn using the stored handle.
          const newState = ensureSession(sessionID, state.handle, next.logger);
          startTurn(sessionID, newState, next);
        }
      })),
    );

    const fiber = Effect.runFork(waitEffect);
    state.activeFiber = fiber;

    // Fire the prompt now that the listener is ready.
    void options.promptAsync().catch(() => {});
  }

  return {
    addListener(sessionID, handle, listener) {
      return handle.sseListener.addListener(sessionID, listener);
    },

    consumeSession(sessionID, handle, options) {
      const log = options.logger;
      const state = ensureSession(sessionID, handle, log);

      if (state.busy) {
        // Session is currently processing a previous prompt.
        // Queue this one — it will be sent when the current turn completes.
        log?.info("[stream] consumeSession: session busy, queuing prompt", {
          sessionID,
          pendingCount: state.pending.length + 1,
        });
        state.pending.push(options);
        return Promise.resolve();
      }

      startTurn(sessionID, state, options);
      return Promise.resolve();
    },
  };
}
