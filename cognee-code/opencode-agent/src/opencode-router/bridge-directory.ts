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
    input.logger.debug({ workspaceRoot: input.workspaceRoot, workspaceRootNormalized, sandboxEnabled }, "directory-policy: created");

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
            input.logger.debug({ value, trimmed, workspaceRoot: input.workspaceRoot }, "directory-policy: resolveScopedDirectory called");
            if (!trimmed) return { ok: false, error: "Directory is required." };
            if (sandboxEnabled) {
                return { ok: true, directory: normalizeDirectory("/workspace") };
            }
            const resolved = resolve(isAbsolute(trimmed) ? trimmed : join(input.workspaceRoot, trimmed));
            const within = isWithinWorkspaceRoot(resolved);
            input.logger.debug({ trimmed, resolved, within, workspaceRoot: input.workspaceRoot }, "directory-policy: resolveScopedDirectory check");
            if (!within) {
                return { ok: false, error: `Directory must stay within workspace root: ${workspaceRootNormalized}` };
            }
            return { ok: true, directory: normalizeDirectory(resolved) };
        },
        async provisionPolicyDirectory({ channel, identityId, peerId, bindingDirectory }) {
            input.logger.debug({ channel, identityId, peerId, bindingDirectory, sandboxEnabled }, "directory-policy: provisionPolicyDirectory called");
            if (sandboxEnabled) {
                return { identityDirectory: "/workspace", policyDirectory: "" };
            }
            // In directory mode, "/workspace" is a stale sandbox binding — ignore it.
            const effectiveBindingDir = input.config.mode === "directory" && bindingDirectory?.trim() === "/workspace"
                ? ""
                : bindingDirectory;
            const identityDirStr = resolveIdentityDirectory(channel, identityId);
            const identityStrategy = parseDirectoryStrategy(identityDirStr);
            const identityDirectory = identityStrategy?.mode === "static" ? identityStrategy.path : "";
            let policyDirectory = "";
            if (!effectiveBindingDir?.trim() && !identityDirectory) {
                let strategy =
                    (identityStrategy?.mode === "per-peer" ? identityStrategy : null) ??
                    parseDirectoryStrategy(input.config.opencodeDirectory?.trim());
                // In directory mode, override the per-peer root with config.directory.workspaceRoot
                // so that user directories are created under /work/ instead of the router's data dir.
                if (strategy?.mode === "per-peer" && input.config.mode === "directory") {
                    input.logger.debug({ originalRoot: strategy.root, overrideRoot: input.config.directory.workspaceRoot }, "directory-policy: overriding per-peer root");
                    strategy = { mode: "per-peer", root: input.config.directory.workspaceRoot };
                }
                if (strategy?.mode === "per-peer") {
                    policyDirectory = await provisionPeerDirectory(strategy, peerId, input.config.dataDir, input.logger);
                    input.logger.info({ channel, identityId, peerId, policyDirectory }, "directory-policy: provisioned peer directory");
                }
            }
            input.logger.debug({ identityDirectory, policyDirectory }, "directory-policy: provisionPolicyDirectory result");
            return { identityDirectory, policyDirectory };
        },
    };
}
