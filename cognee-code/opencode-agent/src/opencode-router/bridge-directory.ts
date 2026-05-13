import { isAbsolute, join, resolve } from "node:path";
import type { ChannelName, Config } from "./config.js";
import { parseDirectoryStrategy } from "./config.js";
import { provisionPeerDirectory } from "./directory.js";
import { isWithinWorkspaceRootPath, normalizeScopedDirectoryPath } from "./path-scope.js";
import type { OpenCodeClientProvider } from "./client-provider.js";
import type { Logger } from "pino";

export type ScopedDirectoryResult = { ok: true; directory: string } | { ok: false; error: string };

export type DirectoryPolicy = {
    defaultDirectory: string;
    workspaceRoot: string;
    normalizeDirectory(input: string): string;
    isDangerousRootDirectory(directory: string): boolean;
    resolveIdentityDirectory(channel: ChannelName, identityId: string): string;
    resolveScopedDirectory(input: string): ScopedDirectoryResult;
    provisionPolicyDirectory(input: {
        channel: ChannelName;
        identityId: string;
        peerId: string;
        bindingDirectory?: string | null;
    }): Promise<{ identityDirectory: string; policyDirectory: string }>;
};

export function createDirectoryPolicy(input: {
    config: Config;
    workspaceRoot: string;
    logger: Logger;
    provider?: OpenCodeClientProvider;
    platform?: NodeJS.Platform;
    defaultDirectory?: string;
}): DirectoryPolicy {
    const platform = input.platform ?? process.platform;
    const sandboxEnabled = input.provider?.kind === "sandbox";
    const defaultDirectory = input.defaultDirectory ?? (sandboxEnabled ? "/workspace" : "");
    const normalizeDirectory = (value: string) => normalizeScopedDirectoryPath(value, platform);
    const workspaceRootNormalized = normalizeDirectory(input.workspaceRoot);

    const isWithinWorkspaceRoot = (candidate: string) =>
        isWithinWorkspaceRootPath({ workspaceRoot: input.workspaceRoot, candidate, platform });

    const resolveIdentityDirectory = (channel: ChannelName, identityId: string): string => {
        const id = identityId.trim();
        if (!id) return "";
        return input.config.channels.find((c) => c.channel === channel && c.id === id)?.directory?.trim() ?? "";
    };

    return {
        defaultDirectory,
        workspaceRoot: input.workspaceRoot,
        normalizeDirectory,
        isDangerousRootDirectory(dir: string) {
            const normalized = dir.trim();
            if (!normalized) return true;
            if (platform !== "win32") return normalized === "/";
            return /^[a-zA-Z]:\/?$/.test(normalized.replace(/\\/g, "/"));
        },
        resolveIdentityDirectory,
        resolveScopedDirectory(value: string): ScopedDirectoryResult {
            const trimmed = value.trim();
            if (!trimmed) return { ok: false, error: "Directory is required." };
            if (sandboxEnabled) {
                return { ok: true, directory: normalizeDirectory("/workspace") };
            }
            const resolved = resolve(isAbsolute(trimmed) ? trimmed : join(input.workspaceRoot, trimmed));
            if (!isWithinWorkspaceRoot(resolved)) {
                return { ok: false, error: `Directory must stay within workspace root: ${workspaceRootNormalized}` };
            }
            return { ok: true, directory: normalizeDirectory(resolved) };
        },
        async provisionPolicyDirectory({ channel, identityId, peerId, bindingDirectory }) {
            if (sandboxEnabled) {
                return { identityDirectory: "/workspace", policyDirectory: "" };
            }
            const identityDirStr = resolveIdentityDirectory(channel, identityId);
            const identityStrategy = parseDirectoryStrategy(identityDirStr);
            const identityDirectory = identityStrategy?.mode === "static" ? identityStrategy.path : "";
            let policyDirectory = "";
            if (!bindingDirectory?.trim() && !identityDirectory) {
                const strategy =
                    (identityStrategy?.mode === "per-peer" ? identityStrategy : null) ??
                    parseDirectoryStrategy(input.config.opencodeDirectory?.trim());
                if (strategy?.mode === "per-peer") {
                    policyDirectory = await provisionPeerDirectory(strategy, peerId, input.config.dataDir, input.logger);
                    input.logger.info({ channel, identityId, peerId, policyDirectory }, "directory-policy: provisioned peer directory");
                }
            }
            return { identityDirectory, policyDirectory };
        },
    };
}
