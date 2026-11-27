/**
 * Minimal leveled logger.
 *
 * IMPORTANT: When this server runs over the stdio MCP transport, stdout is
 * reserved exclusively for JSON-RPC protocol messages. All log output must be
 * written to stderr, otherwise it will corrupt the protocol stream.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function resolveLevel(): LogLevel {
  const raw = (process.env.LOG_LEVEL ?? "info").toLowerCase();
  if (raw === "debug" || raw === "info" || raw === "warn" || raw === "error") {
    return raw;
  }
  return "info";
}

const activeLevel = resolveLevel();

function shouldLog(level: LogLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[activeLevel];
}

function write(level: LogLevel, message: string, meta?: unknown): void {
  if (!shouldLog(level)) return;
  const timestamp = new Date().toISOString();
  const prefix = `[${timestamp}] [${level.toUpperCase()}] [jira-mcp]`;
  if (meta !== undefined) {
    // eslint-disable-next-line no-console
    console.error(prefix, message, meta);
  } else {
    // eslint-disable-next-line no-console
    console.error(prefix, message);
  }
}

export const logger = {
  debug: (message: string, meta?: unknown) => write("debug", message, meta),
  info: (message: string, meta?: unknown) => write("info", message, meta),
  warn: (message: string, meta?: unknown) => write("warn", message, meta),
  error: (message: string, meta?: unknown) => write("error", message, meta),
};
