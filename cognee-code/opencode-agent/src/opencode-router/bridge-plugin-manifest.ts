import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { Logger } from "pino";

import type { Config, PluginOrigin } from "./config.js";

export type BridgePluginCandidate = {
  origin: PluginOrigin;
  targetPath: string;
  entryPath: string;
};

function isPathLikePluginSpec(spec: string): boolean {
  return spec.startsWith("file://") || spec.startsWith(".") || isAbsolute(spec) || /^[A-Za-z]:[\\/]/.test(spec);
}

function packageNameFromPluginSpec(spec: string): string {
  const trimmed = spec.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("@")) {
    const versionIndex = trimmed.indexOf("@", 1 + trimmed.indexOf("/"));
    return versionIndex > 0 ? trimmed.slice(0, versionIndex) : trimmed;
  }
  const versionIndex = trimmed.indexOf("@");
  return versionIndex > 0 ? trimmed.slice(0, versionIndex) : trimmed;
}

function pluginRuntimeDir(config: Config): string {
  return join(config.dataDir, "plugins");
}

function pluginRuntimePackageJson(config: Config): string {
  return join(pluginRuntimeDir(config), "package.json");
}

/**
 * Locate the bundled openclaw shim directory.
 * In source: vendor/opencode-router/src/../shims/openclaw
 * In dist:   vendor/opencode-router/dist/../shims/openclaw  (shims must be shipped alongside dist)
 */
function resolveOpenclaWShimDir(): string | undefined {
  try {
    const moduleDir = dirname(fileURLToPath(import.meta.url));
    const shimPath = resolve(moduleDir, "shims", "openclaw");
    if (existsSync(join(shimPath, "package.json"))) return shimPath;
  } catch {
    // import.meta.url unavailable
  }
  return undefined;
}

/**
 * Ensure the openclaw shim is symlinked into a given node_modules directory.
 */
function symlinkOpenclaWShimInto(nodeModulesDir: string, shimSrc: string): void {
  const shimDest = join(nodeModulesDir, "openclaw");
  if (existsSync(shimDest)) return;
  mkdirSync(nodeModulesDir, { recursive: true });
  try {
    // "junction" is a Windows directory symlink; on POSIX it falls back to regular symlink
    symlinkSync(shimSrc, shimDest, "junction");
  } catch {
    try {
      symlinkSync(shimSrc, shimDest);
    } catch {
      // ignore — symlink may already exist from a concurrent call or manual setup
    }
  }
}

/**
 * Ensure the openclaw shim is symlinked into the plugins runtime node_modules
 * so that dynamically-loaded plugins can resolve `openclaw/plugin-sdk/*`.
 */
function ensureOpenclaWShim(pluginsDir: string): void {
  const shimSrc = resolveOpenclaWShimDir();
  if (!shimSrc) return;
  symlinkOpenclaWShimInto(join(pluginsDir, "node_modules"), shimSrc);
}

/**
 * When a plugin is resolved from outside the plugins runtime dir (e.g. from the
 * project's own node_modules via a symlink), Bun/Node resolves imports from the
 * *real* package location — so `openclaw` must be visible from the nearest
 * node_modules ancestor of that real location.
 *
 * This function walks up from `packagePath` to find the first `node_modules`
 * directory and ensures the shim is placed there.
 */
function ensureOpenclaWShimForPackage(packagePath: string): void {
  const shimSrc = resolveOpenclaWShimDir();
  if (!shimSrc) return;
  // Resolve symlinks so we find the real package location.
  let realPath = packagePath;
  try {
    realPath = realpathSync(packagePath);
  } catch {
    // ignore — use as-is
  }
  // realPath is something like /project/node_modules/@wecom/wecom-openclaw-plugin
  // Walk up to find the node_modules root (/project/node_modules)
  let current = dirname(realPath);
  for (let i = 0; i < 6; i++) {
    if (current.endsWith("node_modules") || dirname(current).endsWith("node_modules")) {
      // current is inside node_modules — the node_modules dir to install into is
      // the top-level node_modules that contains this package tree
      const parts = current.split(/[\\/]/);
      const nmIdx = parts.lastIndexOf("node_modules");
      if (nmIdx >= 0) {
        const nodeModulesDir = parts.slice(0, nmIdx + 1).join("/") || "/";
        symlinkOpenclaWShimInto(nodeModulesDir, shimSrc);
        return;
      }
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
}

function ensurePluginRuntime(config: Config): string {
  const dir = pluginRuntimeDir(config);
  mkdirSync(dir, { recursive: true });
  const packageJsonPath = pluginRuntimePackageJson(config);
  if (!existsSync(packageJsonPath)) {
    writeFileSync(
      packageJsonPath,
      JSON.stringify(
        {
          name: "opencode-router-plugin-runtime",
          private: true,
          type: "module",
        },
        null,
        2,
      ) + "\n",
      "utf-8",
    );
  }
  ensureOpenclaWShim(dir);
  return dir;
}

function resolveExportValue(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  for (const key of ["import", "default", "node"]) {
    const nested = (value as Record<string, unknown>)[key];
    if (typeof nested === "string" && nested.trim()) return nested.trim();
  }
  return undefined;
}

function resolvePluginEntryPath(targetPath: string): string {
  if (!existsSync(targetPath)) {
    throw new Error(`Plugin target not found: ${targetPath}`);
  }
  const stats = statSync(targetPath);
  if (!stats.isDirectory()) return targetPath;

  const packageJsonPath = join(targetPath, "package.json");
  if (existsSync(packageJsonPath)) {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as Record<string, unknown>;
    const exportsField = packageJson.exports;
    if (exportsField && typeof exportsField === "object" && !Array.isArray(exportsField)) {
      const rootExport = resolveExportValue((exportsField as Record<string, unknown>)["."]);
      if (rootExport) return resolve(targetPath, rootExport);
    }
    const main = typeof packageJson.main === "string" ? packageJson.main.trim() : "";
    if (main) return resolve(targetPath, main);
  }

  for (const file of ["index.js", "index.mjs", "index.cjs"]) {
    const entryPath = join(targetPath, file);
    if (existsSync(entryPath)) return entryPath;
  }

  throw new Error(`Plugin directory ${targetPath} is missing a loadable entry`);
}

function resolveInstalledPackagePath(config: Config, packageName: string): string | undefined {
  const packageDir = join(pluginRuntimeDir(config), "node_modules", ...packageName.split("/"));
  if (existsSync(join(packageDir, "package.json"))) {
    return packageDir;
  }

  const packageJsonPath = pluginRuntimePackageJson(config);
  const runtimeRequire = createRequire(packageJsonPath);
  try {
    const resolvedEntry = runtimeRequire.resolve(packageName);
    let currentDir = dirname(resolvedEntry);
    for (let i = 0; i < 4; i += 1) {
      if (existsSync(join(currentDir, "package.json"))) {
        return currentDir;
      }
      const parentDir = dirname(currentDir);
      if (parentDir === currentDir) break;
      currentDir = parentDir;
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function commandAvailable(command: string): boolean {
  const result = spawnSync(command, ["--version"], { stdio: "ignore" });
  return result.status === 0;
}

function installPackagePlugin(config: Config, spec: string, logger?: Logger): void {
  const dir = ensurePluginRuntime(config);
  const commands: Array<{ command: string; args: string[] }> = [];

  if (commandAvailable("bun")) {
    commands.push({ command: "bun", args: ["add", "--ignore-scripts", spec] });
  }
  if (commandAvailable("npm")) {
    commands.push({ command: "npm", args: ["install", "--ignore-scripts", spec] });
  }
  if (commandAvailable("pnpm")) {
    commands.push({ command: "pnpm", args: ["add", "--ignore-scripts", spec] });
  }

  let lastError = "No supported package manager found";
  for (const item of commands) {
    logger?.info({ spec, command: item.command, pluginDir: dir }, "installing router plugin dependency");
    const result = spawnSync(item.command, item.args, { cwd: dir, encoding: "utf8" });
    if (result.status === 0) return;
    lastError = [result.stderr, result.stdout].filter(Boolean).join("\n").trim() || `${item.command} exited with ${result.status}`;
  }

  throw new Error(`Failed to install plugin ${spec}: ${lastError}`);
}

function resolvePluginTargetPath(config: Config, spec: string, logger?: Logger): string {
  if (isPathLikePluginSpec(spec)) {
    const resolved = isAbsolute(spec) ? spec : resolve(dirname(config.configPath), spec);
    if (!existsSync(resolved)) {
      throw new Error(`Plugin path not found: ${spec}`);
    }
    const stats = statSync(resolved);
    return stats.isDirectory() ? resolved : resolved;
  }

  const packageName = packageNameFromPluginSpec(spec);
  if (!packageName) {
    throw new Error(`Invalid plugin spec: ${spec}`);
  }

  const installed = resolveInstalledPackagePath(config, packageName);
  if (installed) return installed;

  installPackagePlugin(config, spec, logger);
  const resolvedPath = resolveInstalledPackagePath(config, packageName);
  if (resolvedPath) return resolvedPath;
  throw new Error(`Plugin package could not be resolved after install: ${spec}`);
}

export async function discoverBridgePluginCandidates(config: Config, logger?: Logger): Promise<BridgePluginCandidate[]> {
  if (config.plugins.enabled === false) return [];

  const candidates: BridgePluginCandidate[] = [];
  const seen = new Set<string>();
  for (const origin of config.pluginOrigins) {
    try {
      const targetPath = resolvePluginTargetPath(config, origin.spec, logger);
      // Ensure the openclaw shim is reachable from the plugin's real location
      // (important when the plugin lives outside the plugins runtime dir).
      ensureOpenclaWShimForPackage(targetPath);
      const entryPath = resolvePluginEntryPath(targetPath);
      const dedupeKey = `${origin.spec}::${entryPath}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      candidates.push({ origin, targetPath, entryPath });
    } catch {
      // ignore invalid candidates and keep loading the rest
    }
  }
  return candidates;
}

export async function loadBridgePluginModule(entryPath: string): Promise<any> {
  const loaded = await import(entryPath);
  return loaded && typeof loaded === "object" && "default" in loaded ? loaded.default : loaded;
}
