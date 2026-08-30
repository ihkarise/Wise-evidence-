/**
 * Architecture-boundary guards (M7.1; docs/30, ADR-020 design intent).
 *
 * These tests read the discovery package's own source and prove the LOCKED
 * boundaries structurally, so a future edit cannot quietly cross them:
 *
 *   - AI boundary:   discovery does NOT import @wise-evidence/ai (or a vendor AI SDK)
 *   - Web boundary:  no Astro / React / Supabase / web-UI imports
 *   - DB boundary:   no @wise-evidence/database import; no canonical-write SQL
 *   - Fetch boundary: no generic network primitive is imported/exposed
 *   - Secret shape:  a SourceDescriptor cannot carry a secret-shaped field
 *
 * The guard scans NON-test source files only (test files legitimately mention
 * forbidden tokens in assertions like this one).
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { MOCK_SOURCE_DESCRIPTOR } from "./descriptor.js";

const SRC_DIR = fileURLToPath(new URL(".", import.meta.url));

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      out.push(...sourceFiles(full));
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
      out.push(full);
    }
  }
  return out;
}

const FILES = sourceFiles(SRC_DIR);

/** Import specifiers that must never appear in a `from "..."` clause. */
const FORBIDDEN_IMPORTS: readonly RegExp[] = [
  /@wise-evidence\/ai/, // AI boundary — discovery must not depend on AI
  /@wise-evidence\/database/, // DB boundary — discovery writes nothing canonical
  /@wise-evidence\/metadata/, // stay narrow — only @wise-evidence/domain is allowed
  /\bastro\b/,
  /\breact\b/,
  /react-dom/,
  /@supabase\//,
  /\bopenai\b/,
  /@anthropic-ai\//,
  /node:http\b/,
  /node:https\b/,
  /node:net\b/,
  /\bundici\b/,
  // No HTML scraping / browser automation (M7.2 is structured-API only).
  /\bcheerio\b/,
  /\bpuppeteer\b/,
  /\bplaywright\b/,
  /\bjsdom\b/,
];

/** Extract the specifier from every static/dynamic import and re-export. */
function importSpecifiers(source: string): string[] {
  const specs: string[] = [];
  const re =
    /(?:import|export)[\s\S]*?from\s*["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    specs.push(m[1] ?? m[2] ?? "");
  }
  return specs;
}

describe("discovery architecture boundary", () => {
  it("scans a non-empty set of source files", () => {
    expect(FILES.length).toBeGreaterThan(5);
  });

  it("imports nothing from AI, database, web, or vendor SDKs", () => {
    const offenders: string[] = [];
    for (const file of FILES) {
      const specs = importSpecifiers(readFileSync(file, "utf8"));
      for (const spec of specs) {
        if (FORBIDDEN_IMPORTS.some((re) => re.test(spec))) {
          offenders.push(`${file.replace(SRC_DIR, "")}: ${spec}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("only depends on @wise-evidence/domain among workspace packages", () => {
    const workspaceImports = new Set<string>();
    for (const file of FILES) {
      for (const spec of importSpecifiers(readFileSync(file, "utf8"))) {
        if (spec.startsWith("@wise-evidence/")) workspaceImports.add(spec);
      }
    }
    expect([...workspaceImports]).toEqual(["@wise-evidence/domain"]);
  });

  it("exposes no generic network primitive (no fetch/http client is imported)", () => {
    for (const file of FILES) {
      const src = readFileSync(file, "utf8");
      expect(src).not.toMatch(/globalThis\.fetch/);
      expect(src).not.toMatch(/new\s+XMLHttpRequest/);
      expect(src).not.toMatch(/require\(\s*["']https?["']\s*\)/);
    }
  });

  it("contains no canonical-write SQL for research/publication/classification", () => {
    const banned = /insert\s+into\s+(research_study|publication|classification|study_)/i;
    for (const file of FILES) {
      expect(readFileSync(file, "utf8")).not.toMatch(banned);
    }
  });

  it("a SourceDescriptor carries no secret-shaped field", () => {
    const keys = Object.keys(MOCK_SOURCE_DESCRIPTOR);
    for (const key of keys) {
      expect(key).not.toMatch(/secret|api[-_]?key|token|password|authorization|credential/i);
    }
  });

  it("keeps Crossref-specific code from leaking into the generic contracts", () => {
    // Only the registry (registration) and the barrel (re-export) may reference
    // the crossref adapter; the generic contract/types/normalize/host files must
    // not import it.
    const allowed = new Set(["/registry.ts", "/index.ts"]);
    for (const file of FILES) {
      const rel = file.replace(SRC_DIR, "");
      if (rel.startsWith("/crossref/") || allowed.has(rel)) continue;
      for (const spec of importSpecifiers(readFileSync(file, "utf8"))) {
        expect(spec).not.toMatch(/crossref/i);
      }
    }
  });
});
