/**
 * Small server helpers for API routes: body parsing, JSON responses, and
 * mapping ServiceError reasons to HTTP status codes.
 */
import { ServiceError, type ServiceErrorReason } from "@wise-evidence/database";

/** Parse a request body as form-encoded or JSON into a flat string map. */
export async function parseBody(request: Request): Promise<Record<string, string>> {
  const type = request.headers.get("content-type") ?? "";
  if (type.includes("application/json")) {
    const raw = (await request.json()) as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw)) {
      if (v != null) out[k] = String(v);
    }
    return out;
  }
  const form = await request.formData();
  const out: Record<string, string> = {};
  for (const [k, v] of form.entries()) {
    out[k] = typeof v === "string" ? v : "";
  }
  return out;
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** 303 redirect (POST → GET) back to a page after a form submission. */
export function seeOther(location: string): Response {
  return new Response(null, { status: 303, headers: { location } });
}

const STATUS_BY_REASON: Record<ServiceErrorReason, number> = {
  forbidden: 403,
  "not-found": 404,
  "invalid-input": 400,
  duplicate: 409,
  "invalid-state": 409,
  "precondition-failed": 422,
  "demo-protected": 422,
};

/** Convert a thrown error into a safe HTTP response (never leaks internals). */
export function errorResponse(error: unknown): Response {
  if (error instanceof ServiceError) {
    return json({ error: error.message, reason: error.reason }, STATUS_BY_REASON[error.reason]);
  }
  return json({ error: "internal error" }, 500);
}

/** Redirect back to a page with a flash message in the query string. */
export function backWithMessage(base: string, kind: "ok" | "error", message: string): Response {
  const sep = base.includes("?") ? "&" : "?";
  return seeOther(`${base}${sep}${kind}=${encodeURIComponent(message)}`);
}
