import { createHash } from "node:crypto";
import type { Logger } from "pino";
import type { ChannelName } from "./config.js";
import type { BridgeStore } from "./db.js";
import type { DirectoryPolicy } from "./bridge-directory.js";

export type TelegramPairingInput = {
    identityId: string;
    peerKey: string;
    peerId: string;
    text: string;
    bindingDirectory?: string;
    sessionDirectory?: string;
};

export type TelegramPairingServiceDeps = {
    store: BridgeStore;
    logger: Logger;
    directoryPolicy: DirectoryPolicy;
    resolveTelegramIdentityAccess(identityId: string): { access: "public" | "private"; pairingCodeHash: string };
    sendText(channel: ChannelName, identityId: string, peerId: string, text: string, options?: { kind?: "system" | "reply" | "tool" }): Promise<void>;
};

export class TelegramPairingService {
    constructor(private readonly deps: TelegramPairingServiceDeps) {}

    async handle(input: TelegramPairingInput): Promise<"continue" | "handled"> {
        const access = this.deps.resolveTelegramIdentityAccess(input.identityId);
        if (access.access !== "private") return "continue";

        const hasKnownBinding = Boolean(input.bindingDirectory?.trim() || input.sessionDirectory?.trim());
        if (hasKnownBinding) return "continue";

        const pairingCode = extractPairingCodeFromCommand(input.text);
        if (!pairingCode) {
            await this.send(input, "This Telegram bot is private. Ask your OpenWork host for the pairing code, then send /pair <code>.");
            return "handled";
        }

        if (!access.pairingCodeHash) {
            await this.send(input, "This Telegram bot is private but missing a pairing code. Ask your OpenWork host to reconnect it.");
            return "handled";
        }

        if (hashPairingCode(pairingCode) !== access.pairingCodeHash) {
            await this.send(input, "Invalid pairing code. Try again with /pair <code>.");
            return "handled";
        }

        const identityDirectory = this.deps.directoryPolicy.resolveIdentityDirectory("telegram", input.identityId);
        const boundDirectoryCandidate = identityDirectory || this.deps.directoryPolicy.defaultDirectory;
        const hasExplicitBinding = Boolean(identityDirectory);
        if (!boundDirectoryCandidate || (!hasExplicitBinding && this.deps.directoryPolicy.isDangerousRootDirectory(boundDirectoryCandidate))) {
            await this.send(input, "No workspace directory configured for this identity. Ask your OpenWork host to set it, or reply with /dir <path>.");
            return "handled";
        }

        const scopedBound = this.deps.directoryPolicy.resolveScopedDirectory(boundDirectoryCandidate);
        if (!scopedBound.ok) {
            await this.send(input, scopedBound.error);
            return "handled";
        }

        const boundDirectory = scopedBound.directory;
        await this.deps.store.upsertBinding("telegram", input.identityId, input.peerKey, boundDirectory);
        await this.deps.store.clearSession("telegram", input.identityId, input.peerKey, boundDirectory);
        this.deps.logger.info({ channel: "telegram", identityId: input.identityId, peerId: input.peerKey, directory: boundDirectory }, "telegram private identity paired");
        await this.send(input, "Pairing successful. This chat is now linked to your worker.");
        return "handled";
    }

    private send(input: TelegramPairingInput, text: string): Promise<void> {
        return this.deps.sendText("telegram", input.identityId, input.peerId, text, { kind: "system" });
    }
}

export function extractPairingCodeFromCommand(text: string): string {
    const trimmed = text.trim();
    const match = trimmed.match(/^\/pair(?:@[A-Za-z0-9_]+)?\s+(.+)$/i);
    if (!match?.[1]) return "";
    return normalizePairingCodeValue(match[1]);
}

export function normalizePairingCodeValue(value: string): string {
    return value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function hashPairingCode(value: string): string {
    return createHash("sha256").update(normalizePairingCodeValue(value)).digest("hex");
}
