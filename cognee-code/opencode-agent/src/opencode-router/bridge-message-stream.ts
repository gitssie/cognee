import type { Logger } from "pino";
import { Effect } from "effect";

import type { ClientHandle } from "./client-provider.js";

export type BridgeStreamEvent = Record<string, unknown>;
export type BridgeStreamListener = (event: BridgeStreamEvent) => void;

type StreamHandle = {
  stop(): void;
  addListener(sessionID: string, listener: BridgeStreamListener): () => void;
  dispatch(event: unknown): void;
};

export type BridgeMessageStream = StreamHandle & {
  start(input: {
    key: string;
    handle: ClientHandle;
    signal?: AbortSignal;
    context?: Record<string, unknown>;
  }): void;
};

export type BridgeMessageStreamDeps = {
  logger: Logger;
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

function extractSessionID(event: unknown): string | undefined {
  const eventObj = asRecord(event);
  const properties = asRecord(eventObj?.properties);
  const part = asRecord(properties?.part);
  const sessionID = properties?.sessionID ?? part?.sessionID;
  return typeof sessionID === "string" && sessionID.trim()
    ? sessionID
    : undefined;
}

function toStreamEvent(event: unknown): BridgeStreamEvent | undefined {
  const eventObj = asRecord(event);
  return eventObj ? eventObj : undefined;
}

export function createBridgeMessageStream(
  deps: BridgeMessageStreamDeps,
): BridgeMessageStream {
  const listeners = new Map<string, Set<BridgeStreamListener>>();
  const controllers = new Map<string, AbortController>();
  const running = new Map<string, Promise<void>>();

  const handle: StreamHandle = {
    stop() {
      for (const controller of controllers.values()) controller.abort();
      controllers.clear();
      running.clear();
      listeners.clear();
    },

    addListener(sessionID, listener) {
      let sessionListeners = listeners.get(sessionID);
      if (!sessionListeners) {
        sessionListeners = new Set();
        listeners.set(sessionID, sessionListeners);
      }
      sessionListeners.add(listener);
      return () => {
        sessionListeners.delete(listener);
        if (sessionListeners.size === 0) listeners.delete(sessionID);
      };
    },

    dispatch(event) {
      const streamEvent = toStreamEvent(event);
      if (!streamEvent) return;
      const sessionID = extractSessionID(streamEvent);
      const targets = sessionID
        ? [[sessionID, listeners.get(sessionID)] as const]
        : Array.from(listeners.entries());
      for (const [targetSessionID, targetListeners] of targets) {
        if (!targetListeners) continue;
        for (const listener of targetListeners) {
          try {
            listener(streamEvent);
          } catch (error) {
            deps.logger.warn(
              { error, sessionID: targetSessionID },
              "bridge stream listener failed",
            );
          }
        }
      }
    },
  };

  const stream: BridgeMessageStream = {
    ...handle,

    start(input) {
      if (running.has(input.key)) return;
      const controller = new AbortController();
      controllers.set(input.key, controller);
      input.signal?.addEventListener("abort", () => controller.abort(), {
        once: true,
      });
      running.set(
        input.key,
        Effect.runPromise(
          Effect.tryPromise(async () => {
            const events = await input.handle.client.global.event();
            deps.logger.info(input.context, "bridge stream connected");
            for await (const event of events.stream) {
              if (controller.signal.aborted) break;
              handle.dispatch(event);
            }
          }),
        )
          .catch((error) => {
            if (!controller.signal.aborted)
              deps.logger.warn(
                { error, ...input.context },
                "bridge stream failed",
              );
          })
          .finally(() => {
            controllers.delete(input.key);
            running.delete(input.key);
          }),
      );
    },
  };

  return stream;
}
