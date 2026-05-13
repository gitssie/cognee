import type { ProviderSecret } from "./types";

export const SANDBOX_TIMEZONE = "Asia/Shanghai";

export function buildSandboxEnvironment(
    secrets: ProviderSecret[],
): Record<string, string> {
    const env: Record<string, string> = {
        OPENCODE_DISABLE_AUTOUPDATE: "true",
        OPENCODE_DISABLE_MODELS_FETCH: "true",
        OPENCODE_DISABLE_LSP_DOWNLOAD: "true",
        OPENCODE_EXPERIMENTAL_HTTPAPI: "true",
        OPENCODE_DISABLE_EXTERNAL_SKILLS: "true",
        OPENCODE_ENABLE_QUESTION_TOOL: "false",
        OPENCODE_ENABLE_EXA: "true",
        TZ: SANDBOX_TIMEZONE,
    };

    for (const secret of secrets) {
        if (secret.value) env[secret.envName] = secret.value;
    }

    // NOTE: The current CubeAPI version does NOT forward envs into the
    // container process. Auth keys and config are written as files via
    // ensureWorkspaceFilesEffect after the sandbox starts.

    return env;
}
