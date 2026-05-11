import type { Logger } from "pino";

import type { OpenCodeClientProvider } from "./client-provider.js";
import { startHealthServer, type HealthHandlers, type HealthSnapshot } from "./health.js";
import type { BridgeRuntimeState } from "./bridge-runtime.js";

export type BridgeHealthControllerOptions = {
    provider: OpenCodeClientProvider;
    state: BridgeRuntimeState;
    opencodeUrl: string;
    getChannels: () => Record<string, boolean>;
    logger: Logger;
    port?: number;
    disabled?: boolean;
    handlers?: HealthHandlers;
    fastIntervalMs?: number;
    slowIntervalMs?: number;
};

export class BridgeHealthController {
    private intervalMs: number;
    private timer: NodeJS.Timeout | null = null;
    private stopServer: (() => void) | null = null;

    constructor(private readonly options: BridgeHealthControllerOptions) {
        this.intervalMs = options.fastIntervalMs ?? 1_000;
    }

    async start(): Promise<void> {
        await this.refresh();
        this.schedule();
        if (!this.options.disabled && this.options.port) {
            this.stopServer = await startHealthServer(
                this.options.port,
                () => this.snapshot(),
                this.options.logger,
                this.options.handlers ?? {},
            );
        }
    }

    stop(): void {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
        if (this.stopServer) {
            this.stopServer();
            this.stopServer = null;
        }
    }

    async refresh(): Promise<void> {
        const health = await this.options.provider.getHealth();
        this.options.state.health.healthy = health.healthy;
        this.options.state.health.version = health.version ?? "provider";

        const slow = this.options.slowIntervalMs ?? 30_000;
        if (health.healthy && this.intervalMs !== slow) {
            this.intervalMs = slow;
            this.schedule();
        }
    }

    snapshot(): HealthSnapshot {
        const { state } = this.options;
        const lastInboundAt = state.activity.lastInboundAt;
        const lastOutboundAt = state.activity.lastOutboundAt;
        return {
            ok: state.health.healthy,
            opencode: {
                url: this.options.opencodeUrl,
                healthy: state.health.healthy,
                version: state.health.version,
            },
            channels: this.options.getChannels(),
            config: {
                groupsEnabled: state.groupsEnabled,
            },
            activity: {
                dayStart: state.activity.dayStart,
                inboundToday: state.activity.inboundToday,
                outboundToday: state.activity.outboundToday,
                ...(typeof lastInboundAt === "number" ? { lastInboundAt } : {}),
                ...(typeof lastOutboundAt === "number" ? { lastOutboundAt } : {}),
                ...(typeof lastInboundAt === "number" || typeof lastOutboundAt === "number"
                    ? { lastMessageAt: Math.max(lastInboundAt ?? 0, lastOutboundAt ?? 0) }
                    : {}),
            },
        };
    }

    private schedule(): void {
        if (this.timer) clearInterval(this.timer);
        this.timer = setInterval(() => {
            void this.refresh().catch((error) => {
                this.options.logger.warn({ error }, "health refresh failed");
            });
        }, this.intervalMs);
        this.timer.unref?.();
    }
}
