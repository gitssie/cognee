/**
 * Workspace initialization capability — part of the opencode-router layer.
 * Subscribes to workspace.init and seeds AGENTS.md / TOOLS.md / MEMORY.md
 * into newly created workspace directories.
 *
 * This is an effect Layer that depends on EventBus.
 */

import { Effect, Layer, Ref } from "effect";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { EventBus, WorkspaceInit } from "../events";

import agentsMd from "./workspace-template/AGENTS.txt";
import toolsMd from "./workspace-template/TOOLS.txt";
import memoryMd from "./workspace-template/MEMORY.txt";

export const WorkspaceInitLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const bus = yield* EventBus;
    const initialized = yield* Ref.make(new Set<string>());

    yield* bus.on(WorkspaceInit, ({ properties }) =>
      Effect.gen(function* () {
        const { workspaceHostPath, identity } = properties;

        const seen = yield* Ref.get(initialized);
        if (seen.has(identity)) return;
        yield* Ref.set(initialized, new Set(seen).add(identity));

        mkdirSync(workspaceHostPath, { recursive: true });
        const seeded = [
          seedIfMissing(`${workspaceHostPath}/AGENTS.md`, agentsMd),
          seedIfMissing(`${workspaceHostPath}/TOOLS.md`, toolsMd),
          seedIfMissing(`${workspaceHostPath}/MEMORY.md`, memoryMd),
        ].filter(Boolean);

        console.log(
          `[workspace-init] Initialized ${workspaceHostPath} (${identity}); ` +
          `created=${seeded.join(",") || "none"}`,
        );
      }),
    );
  }),
);

function seedIfMissing(path: string, content: string): string | null {
  if (existsSync(path)) return null;
  writeFileSync(path, content);
  return path.split("/").pop() ?? path;
}
