import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

/**
 * Standard error codes used across all API responses.
 */
export type ErrorCode =
  | "NOT_FOUND"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "VALIDATION_ERROR"
  | "RATE_LIMITED"
  | "INTERNAL_ERROR"
  | "CONFLICT";

/**
 * Returns a standardised JSON error response.
 *
 * Shape:
 * ```json
 * { "error": { "code": "NOT_FOUND", "message": "Agent not found" } }
 * ```
 */
export function errorResponse(
  c: Context,
  status: ContentfulStatusCode,
  code: ErrorCode,
  message: string,
) {
  return c.json({ error: { code, message } }, status);
}
