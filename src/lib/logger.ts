import { env } from "../env.js";

type Level = "debug" | "info" | "warn" | "error";

interface LogMeta {
  [key: string]: unknown;
}

function emit(level: Level, msg: string, meta?: LogMeta): void {
  if (level === "debug" && env.NODE_ENV === "production") return;
  const payload = {
    level,
    msg,
    time: new Date().toISOString(),
    ...meta,
  };
  const line = JSON.stringify(payload);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

function errorPayload(err: unknown): LogMeta {
  if (err instanceof Error) {
    return { errName: err.name, errMessage: err.message, stack: err.stack };
  }
  return { err };
}

export const logger = {
  debug: (msg: string, meta?: LogMeta) => emit("debug", msg, meta),
  info: (msg: string, meta?: LogMeta) => emit("info", msg, meta),
  warn: (msg: string, meta?: LogMeta) => emit("warn", msg, meta),
  error: (msg: string, err?: unknown, meta?: LogMeta) =>
    emit("error", msg, { ...errorPayload(err), ...meta }),
};
