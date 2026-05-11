import type { Logger } from "pino";

import type { ChannelName, Config } from "./config.js";
import type { BridgeStore } from "./db.js";
import type { MessageDeliveryResult, OutboundMessagePart } from "./media.js";
import type { MediaStore } from "./media-store.js";
import type { DirectoryPolicy } from "./bridge-directory.js";
import { type BridgeAdapter } from "./bridge-adapters.js";
import { TelegramPairingService, type TelegramPairingInput } from "./bridge-pairing.js";
import {
    createTelegramAdapter,
    invalidTelegramPeerIdError,
    isTelegramPeerId,
    normalizePairingCodeHash,
    normalizeTelegramAccess,
} from "./telegram.js";
import { createSlackAdapter } from "./slack.js";
import type { OpencodeInstance } from "./opencode-instance.js";

export type ChannelSendOptions = { kind?: "reply" | "system" | "tool"; display?: boolean };
export type ChannelIdentityAccess = { access: "public" | "private"; pairingCodeHash: string };

export abstract class Channel implements BridgeAdapter {
    abstract readonly key: string;
    abstract readonly name: ChannelName;
    abstract readonly identityId: string;
    abstract readonly maxTextLength: number;

    constructor(protected readonly instance: OpencodeInstance) {}

    abstract start(): Promise<void>;
    abstract stop(): Promise<void>;
    abstract sendText(peerId: string, text: string): Promise<void>;

    sendMessage?(peerId: string, message: { parts: OutboundMessagePart[] }): Promise<MessageDeliveryResult>;
    sendFile?(peerId: string, filePath: string, caption?: string): Promise<void>;
    sendTyping?(peerId: string): Promise<void>;

    handlePairing?(_input: TelegramPairingInput): Promise<"continue" | "handled">;

    resolveIdentityAccess(): ChannelIdentityAccess | undefined {
        return undefined;
    }

    resolveIdentityDirectory(): string {
        return "";
    }

    shouldAutoBind(): boolean {
        return true;
    }

    validatePeerId(_peerId: string): void {}

    asAdapter(): BridgeAdapter {
        return this;
    }
}

export class AdapterChannel extends Channel {
    readonly key: string;
    readonly name: ChannelName;
    readonly identityId: string;
    readonly maxTextLength: number;
    readonly sendMessage?: BridgeAdapter["sendMessage"];
    readonly sendFile?: BridgeAdapter["sendFile"];
    readonly sendTyping?: BridgeAdapter["sendTyping"];

    constructor(instance: OpencodeInstance, protected readonly adapter: BridgeAdapter) {
        super(instance);
        this.key = adapter.key;
        this.name = adapter.name;
        this.identityId = adapter.identityId;
        this.maxTextLength = adapter.maxTextLength;
        this.sendMessage = adapter.sendMessage?.bind(adapter);
        this.sendFile = adapter.sendFile?.bind(adapter);
        this.sendTyping = adapter.sendTyping?.bind(adapter);
    }

    start(): Promise<void> {
        return this.adapter.start();
    }

    stop(): Promise<void> {
        return this.adapter.stop();
    }

    sendText(peerId: string, text: string): Promise<void> {
        return this.adapter.sendText(peerId, text);
    }
}

export type TelegramChannelDeps = {
    config: Config;
    logger: Logger;
    store: BridgeStore;
    mediaStore: MediaStore;
    directoryPolicy: DirectoryPolicy;
    identity: Config["telegramBots"][number];
    adapterKey(channel: ChannelName, identityId: string): string;
    handleInbound(message: unknown): Promise<void>;
    sendText(channel: ChannelName, identityId: string, peerId: string, text: string, options?: ChannelSendOptions): Promise<void>;
};

export class TelegramChannel extends AdapterChannel {
    private readonly pairing: TelegramPairingService;
    private readonly identity: Config["telegramBots"][number];

    constructor(instance: OpencodeInstance, deps: TelegramChannelDeps) {
        const base = createTelegramAdapter(
            deps.identity,
            deps.config,
            deps.logger,
            deps.handleInbound as any,
            deps.mediaStore,
        );
        super(instance, { ...base, key: deps.adapterKey("telegram", deps.identity.id) });
        this.identity = deps.identity;
        this.pairing = new TelegramPairingService({
            store: deps.store,
            logger: deps.logger,
            directoryPolicy: deps.directoryPolicy,
            resolveTelegramIdentityAccess: () => this.resolveIdentityAccess(),
            sendText: deps.sendText,
        });
    }

    resolveIdentityAccess(): ChannelIdentityAccess {
        const access = normalizeTelegramAccess(this.identity.access);
        if (access !== "private") return { access: "public", pairingCodeHash: "" };
        return { access: "private", pairingCodeHash: normalizePairingCodeHash(this.identity.pairingCodeHash) };
    }

    resolveIdentityDirectory(): string {
        return this.identity.directory?.trim() ?? "";
    }

    shouldAutoBind(): boolean {
        return this.resolveIdentityAccess().access !== "private";
    }

    validatePeerId(peerId: string): void {
        if (!isTelegramPeerId(peerId)) throw invalidTelegramPeerIdError();
    }

    handlePairing(input: TelegramPairingInput): Promise<"continue" | "handled"> {
        return this.pairing.handle(input);
    }
}

export type SlackChannelDeps = {
    config: Config;
    logger: Logger;
    mediaStore: MediaStore;
    identity: Config["slackApps"][number];
    adapterKey(channel: ChannelName, identityId: string): string;
    handleInbound(message: unknown): Promise<void>;
};

export class SlackChannel extends AdapterChannel {
    private readonly identity: Config["slackApps"][number];

    constructor(instance: OpencodeInstance, deps: SlackChannelDeps) {
        const base = createSlackAdapter(
            deps.identity,
            deps.config,
            deps.logger,
            deps.handleInbound as any,
            undefined,
            deps.mediaStore,
        );
        super(instance, { ...base, key: deps.adapterKey("slack", deps.identity.id) });
        this.identity = deps.identity;
    }

    resolveIdentityDirectory(): string {
        return this.identity.directory?.trim() ?? "";
    }
}

export class PluginChannel extends AdapterChannel {}

export class ChannelRegistry {
    private readonly channels = new Map<string, Channel>();

    set(channel: Channel): void {
        this.channels.set(channel.key, channel);
    }

    get(key: string): Channel | undefined {
        return this.channels.get(key);
    }

    getByIdentity(channel: ChannelName, identityId: string): Channel | undefined {
        return this.channels.get(`${channel}:${identityId}`);
    }

    has(key: string): boolean {
        return this.channels.has(key);
    }

    delete(key: string): boolean {
        return this.channels.delete(key);
    }

    keys(): IterableIterator<string> {
        return this.channels.keys();
    }

    values(): IterableIterator<Channel> {
        return this.channels.values();
    }

    knownChannelNames(): Set<string> {
        return new Set(Array.from(this.channels.values()).map((channel) => channel.name));
    }

    hasChannelName(name: string): boolean {
        return Array.from(this.channels.values()).some((channel) => channel.name === name);
    }

    resolveIdentityAccess(channel: ChannelName, identityId: string): ChannelIdentityAccess | undefined {
        return this.getByIdentity(channel, identityId)?.resolveIdentityAccess();
    }

    resolveIdentityDirectory(channel: ChannelName, identityId: string): string {
        return this.getByIdentity(channel, identityId)?.resolveIdentityDirectory() ?? "";
    }

    listIdentityConfigs(channel: ChannelName): Array<{ id: string; directory: string }> {
        return Array.from(this.channels.values())
            .filter((entry) => entry.name === channel)
            .map((entry) => ({ id: entry.identityId, directory: entry.resolveIdentityDirectory() }));
    }

    shouldAutoBind(channel: ChannelName, identityId: string): boolean {
        return this.getByIdentity(channel, identityId)?.shouldAutoBind() ?? true;
    }

    validatePeerId(channel: ChannelName, identityId: string, peerId: string): void {
        this.getByIdentity(channel, identityId)?.validatePeerId(peerId);
    }

    toAdapterMap(): Map<string, BridgeAdapter> {
        return new Map(Array.from(this.channels.entries()).map(([key, channel]) => [key, channel.asAdapter()]));
    }

    getPairingHandler(channel: ChannelName, identityId: string): Channel["handlePairing"] | undefined {
        return this.channels.get(`${channel}:${identityId}`)?.handlePairing;
    }

    handlePairing(channel: ChannelName, identityId: string, input: TelegramPairingInput): Promise<"continue" | "handled"> {
        const handler = this.getPairingHandler(channel, identityId);
        if (!handler) throw new Error(`No ${channel}/${identityId} channel registered for pairing`);
        return handler.call(this.channels.get(`${channel}:${identityId}`), input);
    }
}
