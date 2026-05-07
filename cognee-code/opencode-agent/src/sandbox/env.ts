import { OPENCODE_XDG_ENV } from "./workspace";
import type { ProviderSecret } from "./types";

export const SANDBOX_TIMEZONE = "Asia/Shanghai";

export function buildSandboxEnvironment(
  password: string,
  secrets: ProviderSecret[],
): Record<string, string> {
  const env: Record<string, string> = {
    ...OPENCODE_XDG_ENV,
    OPENCODE_SERVER_USERNAME: "opencode",
    OPENCODE_SERVER_PASSWORD: password,
    OPENCODE_DISABLE_AUTOUPDATE: "true",
    OPENCODE_DISABLE_MODELS_FETCH: "true",
    OPENCODE_DISABLE_EXTERNAL_SKILLS: "true",
    OPENCODE_ENABLE_QUESTION_TOOL: "false",
    OPENCODE_ENABLE_EXA: "true",
    TZ: SANDBOX_TIMEZONE,
  };

  for (const secret of secrets) {
    if (secret.value) env[secret.envName] = secret.value;
  }

  return env;
}
