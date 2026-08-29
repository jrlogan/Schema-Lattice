// The standard tool error envelope from specs/mcp-tools.md § Error handling.

import { PublishError } from "../publish/errors.ts";

export type ToolErrorCode =
  | "not-found"
  | "invalid-parameter"
  | "duplicate-blocked"
  | "server-error"
  | "rate-limited";

export interface ToolError {
  error: {
    code: ToolErrorCode;
    message: string;
    details?: Record<string, unknown>;
  };
}

/** Gate rejections are the caller's fault; everything else is ours. */
const NOT_FOUND_CODES = new Set([
  "ERR_UNKNOWN_PARENT",
  "ERR_UNKNOWN_CONCEPT",
  "ERR_UNKNOWN_PARENT_CONTEXT",
  "ERR_UNKNOWN_CONTEXT",
]);

export function toToolError(err: unknown): ToolError {
  if (err instanceof PublishError) {
    return {
      error: {
        code: NOT_FOUND_CODES.has(err.code) ? "not-found" : "invalid-parameter",
        message: err.message,
        details: { latticeCode: err.code, ...(asObject(err.detail) ?? {}) },
      },
    };
  }
  if (err instanceof InvalidParameter) {
    return {
      error: { code: "invalid-parameter", message: err.message, details: err.details },
    };
  }
  if (err instanceof NotFound) {
    return { error: { code: "not-found", message: err.message, details: err.details } };
  }
  const message = err instanceof Error ? err.message : String(err);
  return { error: { code: "server-error", message } };
}

function asObject(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

export class InvalidParameter extends Error {
  constructor(message: string, public details?: Record<string, unknown>) {
    super(message);
    this.name = "InvalidParameter";
  }
}

export class NotFound extends Error {
  constructor(message: string, public details?: Record<string, unknown>) {
    super(message);
    this.name = "NotFound";
  }
}

export function isToolError(v: unknown): v is ToolError {
  return !!v && typeof v === "object" && "error" in (v as object);
}
