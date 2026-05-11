import { join, resolve } from "node:path";

import type { Config } from "./config.js";
import { MediaStore } from "./media-store.js";

export type BridgePaths = {
    routerRoot: string;
    workspaceRoot: string;
    mediaRoot: string;
};

export type BridgeRuntimeDeps = {
    paths?: Partial<BridgePaths>;
    mediaStore?: MediaStore;
};

export type BridgeRuntime = {
    paths: BridgePaths;
    mediaStore: MediaStore;
    state: BridgeRuntimeState;
};

export type BridgeRuntimeState = {
    groupsEnabled: boolean;
    health: {
        healthy: boolean;
        version?: string;
    };
    activity: {
        dayStart: number;
        inboundToday: number;
        outboundToday: number;
        lastInboundAt?: number;
        lastOutboundAt?: number;
    };
    recordInboundActivity(now?: number): void;
    recordOutboundActivity(now?: number): void;
    setGroupsEnabled(enabled: boolean): void;
};

function startOfToday(now: number): number {
    const day = new Date(now);
    day.setHours(0, 0, 0, 0);
    return day.getTime();
}

export function createBridgeRuntimeState(input: {
    groupsEnabled: boolean;
    now?: number;
}): BridgeRuntimeState {
    const state: BridgeRuntimeState = {
        groupsEnabled: input.groupsEnabled,
        health: {
            healthy: false,
        },
        activity: {
            dayStart: startOfToday(input.now ?? Date.now()),
            inboundToday: 0,
            outboundToday: 0,
        },
        recordInboundActivity(now = Date.now()) {
            ensureActivityDay(state, now);
            state.activity.inboundToday += 1;
            state.activity.lastInboundAt = now;
        },
        recordOutboundActivity(now = Date.now()) {
            ensureActivityDay(state, now);
            state.activity.outboundToday += 1;
            state.activity.lastOutboundAt = now;
        },
        setGroupsEnabled(enabled: boolean) {
            state.groupsEnabled = enabled;
        },
    };
    return state;
}

function ensureActivityDay(state: BridgeRuntimeState, now: number): void {
    const nextDayStart = startOfToday(now);
    if (nextDayStart === state.activity.dayStart) return;
    state.activity.dayStart = nextDayStart;
    state.activity.inboundToday = 0;
    state.activity.outboundToday = 0;
    delete state.activity.lastInboundAt;
    delete state.activity.lastOutboundAt;
}

export function createBridgePaths(
    config: Pick<Config, "dataDir">,
    overrides?: Partial<BridgePaths>,
): BridgePaths {
    const routerRoot = overrides?.routerRoot ?? resolve(config.dataDir, "..");
    const workspaceRoot = overrides?.workspaceRoot ?? resolve(routerRoot, "workspaces");
    const mediaRoot = overrides?.mediaRoot ?? join(workspaceRoot, ".opencode-router", "media");

    return {
        routerRoot,
        workspaceRoot,
        mediaRoot,
    };
}

export async function createBridgeRuntime(
    config: Pick<Config, "dataDir">,
    deps?: BridgeRuntimeDeps,
): Promise<BridgeRuntime> {
    const paths = createBridgePaths(config, deps?.paths);
    const mediaStore = deps?.mediaStore ?? new MediaStore(paths.mediaRoot);
    const state = createBridgeRuntimeState({
        groupsEnabled: Boolean((config as { groupsEnabled?: boolean }).groupsEnabled),
    });
    await mediaStore.ensureReady();
    return { paths, mediaStore, state };
}
