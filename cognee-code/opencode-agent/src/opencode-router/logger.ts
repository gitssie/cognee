import fs from "node:fs";
import path from "node:path";

import pino from "pino";

const IS_DEV = process.env.NODE_ENV !== "production";

/**
 * Create a unified pino logger that writes to:
 *   1. stdout — pino-pretty in dev, raw JSON in production
 *   2. A log file (pino-pretty format, async — non-blocking) if logFile is given
 *
 * All log entries carry `service: "opencode-agent"` in the base object so
 * every line is machine-searchable without post-processing.
 */
export function createLogger(level: string, options?: { logFile?: string }) {
  const base = { service: "opencode-agent" };

  const prettyOptions = {
    colorize: false,
    translateTime: "SYS:yyyy-mm-dd HH:MM:ss",
    ignore: "pid,hostname,service",
    singleLine: true,
  };

  const streams: pino.StreamEntry[] = [
    // stdout — human-readable in dev, raw JSON in prod
    IS_DEV
      ? {
          level: level as pino.Level,
          stream: (pino as any).transport({
            target: "pino-pretty",
            options: { ...prettyOptions, colorize: true },
          }),
        }
      : { level: level as pino.Level, stream: process.stdout },
  ];

  if (options?.logFile) {
    fs.mkdirSync(path.dirname(options.logFile), { recursive: true });
    streams.push({
      level: level as pino.Level,
      stream: (pino as any).transport({
        target: "pino-pretty",
        options: { ...prettyOptions, colorize: false, destination: options.logFile, append: true, mkdir: true },
      }),
    });
  }

  return pino(
    {
      level,
      base,
      timestamp: pino.stdTimeFunctions.isoTime,
    },
    (pino as any).multistream(streams, { dedupe: false }),
  );
}
