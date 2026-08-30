/**
 * Source host / URL policy for discovery (M7.1; docs/16 §8, ADR-020 design).
 *
 * Discovery deliberately exposes NO generic "fetch any URL" helper. A source may
 * only ever talk to hosts its `SourceDescriptor` allow-lists, over HTTPS unless
 * a permitted local endpoint is explicitly allowed. This module is the single
 * gate that enforces that policy; a future networked adapter (M7.2 Crossref)
 * MUST route every request URL through `assertUrlAllowed()` before fetching.
 *
 * The heuristics mirror the AI base-URL policy (ADR-019, packages/ai/config.ts)
 * so the two subsystems agree on what "private/loopback" means. This is a
 * config-time gate, not full DNS resolution; production must also pin allowed
 * hosts at the network layer.
 *
 * Framework-independent: no Astro, React, Supabase, web, or AI imports; no I/O.
 */
import { DiscoveryError } from "./errors.js";
import type { SourceDescriptor } from "./descriptor.js";

/**
 * Heuristic private/loopback host detector. Covers localhost, IPv4
 * loopback/private/link-local ranges, IPv6 loopback, and `.local`/`.internal`
 * names. Not exhaustive — a coarse policy gate.
 */
export function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  if (h.endsWith(".local") || h.endsWith(".internal")) return true;
  if (h === "::1" || h === "[::1]") return true;
  if (h === "0.0.0.0") return true;
  const v4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const a = Number(v4[1]);
    const b = Number(v4[2]);
    if (a === 127) return true; // loopback
    if (a === 10) return true; // private
    if (a === 192 && b === 168) return true; // private
    if (a === 172 && b >= 16 && b <= 31) return true; // private
    if (a === 169 && b === 254) return true; // link-local
  }
  return false;
}

/**
 * Is `host` permitted by an allow-list? A host matches an entry when it equals
 * it or is a sub-domain of it (`api.crossref.org` matches `crossref.org`).
 * Comparison is case-insensitive. An empty allow-list matches nothing.
 */
export function isHostAllowed(host: string, allowedHosts: readonly string[]): boolean {
  const h = host.toLowerCase();
  return allowedHosts.some((allowed) => {
    const a = allowed.toLowerCase();
    return h === a || h.endsWith(`.${a}`);
  });
}

/**
 * Validate a candidate request URL against a descriptor's policy, returning the
 * parsed `URL` on success. Throws a typed `DiscoveryError` on any violation:
 *
 *   - not a well-formed URL, or embeds credentials  → FORBIDDEN_SOURCE
 *   - non-http(s) scheme                            → FORBIDDEN_SOURCE
 *   - http where the descriptor requires https      → FORBIDDEN_SOURCE
 *   - host not on the descriptor allow-list         → FORBIDDEN_SOURCE
 *   - private/loopback host without opt-in           → FORBIDDEN_SOURCE
 *
 * The error message names only the host and scheme — never a query string,
 * header, or secret.
 */
export function assertUrlAllowed(rawUrl: string, descriptor: SourceDescriptor): URL {
  const deny = (reason: string): never => {
    throw new DiscoveryError("FORBIDDEN_SOURCE", `source '${descriptor.key}': ${reason}`, {
      source: descriptor.key,
    });
  };

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return deny("request URL is not a valid absolute URL");
  }
  if (url.username.length > 0 || url.password.length > 0) {
    return deny("request URL must not embed credentials");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return deny(`scheme '${url.protocol}' is not permitted (http/https only)`);
  }

  const host = url.hostname.toLowerCase();
  const isLocal = isPrivateHost(host);

  if (
    url.protocol === "http:" &&
    descriptor.requireHttps &&
    !(isLocal && descriptor.allowLocalNetwork)
  ) {
    return deny(`host '${host}' must be reached over https`);
  }
  if (isLocal && !descriptor.allowLocalNetwork) {
    return deny(`host '${host}' resolves to a private/loopback address, which is not permitted`);
  }
  if (!isHostAllowed(host, descriptor.allowedHosts)) {
    return deny(`host '${host}' is not on the allow-list for this source`);
  }
  return url;
}

/** Non-throwing variant: `true` when `assertUrlAllowed` would accept the URL. */
export function isUrlAllowed(rawUrl: string, descriptor: SourceDescriptor): boolean {
  try {
    assertUrlAllowed(rawUrl, descriptor);
    return true;
  } catch {
    return false;
  }
}
