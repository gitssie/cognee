import type { Event } from "@opencode-ai/sdk/v2";
import type { ClientHandle } from "./client-provider.js";

export type BridgeStreamEvent = Event;
export type BridgeStreamListener = (event: Event) => void;

export type ConsumeOptions = {
  promptAsync: () => Promise<unknown>;
  onText: (text: string) => Promise<void>;
  logger?: { info: (msg: string, data?: Record<string, unknown>) => void };
};

export type ConsumeOutcome =
  | { status: "done"; text: string }
  | { status: "error"; error: string; text: string };

export type BridgeMessageStream = {
  addListener(sessionID: string, handle: ClientHandle, listener: BridgeStreamListener): () => void;
  consumeSession(
    sessionID: string,
    handle: ClientHandle,
    options: ConsumeOptions,
  ): Promise<unknown>;
};

export function createBridgeMessageStream(): BridgeMessageStream {
  const sessions = new Map<string, () => void>(); // sessionID → unsub

  function ensureSession(sessionID: string, handle: ClientHandle, options: ConsumeOptions): void {
    if (sessions.has(sessionID)) return;

    const log = options.logger;
    log?.info("[stream] ensureSession: registering listener", { sessionID });

    const textByMessage = new Map<string, string[]>();

    const unsub = handle.sseListener.addListener(sessionID, (event) => {
      if (event.type === "message.part.updated") {
        const part = event.properties.part;
        if (part.type === "text" && typeof part.text === "string") {
          const chunks = textByMessage.get(part.messageID);
          if (chunks) chunks.push(part.text);
          else textByMessage.set(part.messageID, [part.text]);
        }
        return;
      }

      if (event.type === "message.updated") {
        const info = event.properties.info;
        if (info.role === "assistant" && info.finish && info.finish !== "tool-calls") {
          const text = (textByMessage.get(info.id) ?? []).join("\n");
          textByMessage.delete(info.id);
          log?.info("[stream] message.updated: assistant finish", { sessionID, messageID: info.id, textLen: text.length, finish: info.finish });
          if (text) options.onText(text).catch(() => {});
        }
        return;
      }

      if (event.type === "session.error") {
        const err = event.properties.error;
        const errMsg = (err && typeof err === "object" && "data" in err)
          ? String((err as { data: { message?: string } }).data?.message ?? "session error")
          : "session error";
        log?.info("[stream] session.error: cleaning up", { sessionID, errMsg });
        sessions.delete(sessionID);
        unsub();
        options.onText(`Error: ${errMsg}`).catch(() => {});
        return;
      }

      if (event.type === "session.idle") {
        log?.info("[stream] session.idle: cleaning up", { sessionID });
        sessions.delete(sessionID);
        unsub();
      }
    });

    sessions.set(sessionID, unsub);
    log?.info("[stream] ensureSession: listener registered", { sessionID });
  }

  return {
    addListener(sessionID, handle, listener) {
      return handle.sseListener.addListener(sessionID, listener);
    },

    consumeSession(sessionID, handle, options) {
      if (sessions.has(sessionID)) return options.promptAsync();
      ensureSession(sessionID, handle, options);
      return options.promptAsync();
    },
  };
}
