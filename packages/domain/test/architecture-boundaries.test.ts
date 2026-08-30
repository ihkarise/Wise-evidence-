/**
 * Architecture boundary guards (CLAUDE.md §3–§4, ADR-017, ADR-019).
 *
 * These tests read the ACTUAL source of each package and assert the import
 * boundaries the architecture depends on. They protect real seams, not file
 * names:
 *
 *   - `packages/domain` is the portable core — it must depend on NOTHING
 *     (no sibling workspace package, no UI framework, no database driver), so it
 *     can be reused anywhere (docs/00, CLAUDE.md §4 "modular monolith").
 *   - `packages/ai` is provider- AND framework-independent (ADR-019). It may read
 *     the canonical VOCABULARIES from `@wise-evidence/database` (single source of
 *     truth), but it must not import a UI framework, a Supabase client, the web
 *     app, or any vendor AI SDK. Swapping providers is a configuration change.
 *   - The AI orchestrator depends only on the `AIProvider` INTERFACE — never a
 *     concrete provider or the registry — so it never learns which backend ran.
 *   - `packages/database` is the canonical data-access boundary; the AI layer sits
 *     ABOVE it (via the web coordinator), so the database must not import
 *     `@wise-evidence/ai` or a UI framework. This pins the dependency direction.
 *   - Public (non-admin) web routes read through the RLS-scoped `asAnon` executor
 *     and NEVER the RLS-bypassing `asService` executor (docs/26, ADR-014).
 *
 * The scan is deliberately import-level. Behavioural rules (no efficacy/combined
 * score, AI never writes canonical data, anon sees only PUBLISHED) are locked by
 * the database/stats/search/ai-security suites; this file guards the seams that
 * keep those behaviours structurally possible.
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

/** Repo root = four levels up from packages/domain/test/. */
const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

const CODE_EXTS = [".ts", ".tsx", ".astro"];

/** Recursively collect source files under `absDir`, excluding test files. */
function collectFiles(absDir: string, exts: readonly string[]): string[] {
  if (!existsSync(absDir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(absDir, { withFileTypes: true })) {
    const full = join(absDir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      out.push(...collectFiles(full, exts));
      continue;
    }
    if (entry.name.endsWith(".test.ts") || entry.name.endsWith(".spec.ts")) continue;
    if (exts.some((e) => entry.name.endsWith(e))) out.push(full);
  }
  return out;
}

function read(rel: string): string {
  return readFileSync(join(REPO_ROOT, rel), "utf8");
}

/** Extract every module specifier from static/dynamic imports and re-exports. */
function importSpecifiers(source: string): string[] {
  const specs: string[] = [];
  const patterns = [
    /\bfrom\s+["']([^"']+)["']/g, // import … from "x" / export … from "x"
    /\bimport\s+["']([^"']+)["']/g, // bare import "x"
    /\bimport\(\s*["']([^"']+)["']\s*\)/g, // dynamic import("x")
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(source)) !== null) specs.push(m[1]);
  }
  return specs;
}

/** Collect specifiers from every source file in a package's src directory. */
function packageSpecifiers(pkgRel: string): { file: string; specs: string[] }[] {
  const abs = join(REPO_ROOT, pkgRel);
  return collectFiles(abs, CODE_EXTS).map((f) => ({
    file: f.slice(REPO_ROOT.length),
    specs: importSpecifiers(readFileSync(f, "utf8")),
  }));
}

const UI_FRAMEWORKS = ["astro", "react", "react-dom", "@astrojs/"];
const SUPABASE = ["@supabase/"];
const DB_DRIVERS = ["pg", "postgres", "@electric-sql/pglite"];
/** Concrete vendor AI SDKs — the whole point of ADR-019 is to avoid these. */
const VENDOR_AI_SDKS = [
  "openai",
  "@anthropic-ai/",
  "@google/generative-ai",
  "@google/genai",
  "cohere-ai",
  "ollama",
  "@mistralai/",
];

/** True when `spec` is (or is a subpath of) one of `bad`. */
function matchesAny(spec: string, bad: readonly string[]): boolean {
  return bad.some((b) => (b.endsWith("/") ? spec.startsWith(b) : spec === b || spec === `${b}`));
}

describe("packages/domain is the portable core (depends on nothing)", () => {
  const files = packageSpecifiers("packages/domain/src");

  it("has source files to check", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("imports no sibling workspace package", () => {
    for (const { file, specs } of files) {
      for (const s of specs) {
        expect(s.startsWith("@wise-evidence/"), `${file} imports ${s}`).toBe(false);
      }
    }
  });

  it("imports no UI framework, Supabase client, or database driver", () => {
    const forbidden = [...UI_FRAMEWORKS, ...SUPABASE, ...DB_DRIVERS, ...VENDOR_AI_SDKS];
    for (const { file, specs } of files) {
      for (const s of specs) {
        expect(matchesAny(s, forbidden), `${file} imports ${s}`).toBe(false);
      }
    }
  });
});

describe("packages/ai is provider- and framework-independent (ADR-019)", () => {
  const files = packageSpecifiers("packages/ai/src");

  it("imports no UI framework or Supabase client", () => {
    const forbidden = [...UI_FRAMEWORKS, ...SUPABASE];
    for (const { file, specs } of files) {
      for (const s of specs) {
        expect(matchesAny(s, forbidden), `${file} imports ${s}`).toBe(false);
      }
    }
  });

  it("imports no vendor-specific AI SDK (provider chosen by config, not by code)", () => {
    for (const { file, specs } of files) {
      for (const s of specs) {
        expect(matchesAny(s, VENDOR_AI_SDKS), `${file} imports vendor SDK ${s}`).toBe(false);
      }
    }
  });

  it("depends on the web app or metadata package for nothing", () => {
    for (const { file, specs } of files) {
      for (const s of specs) {
        expect(
          s === "@wise-evidence/web" || s === "@wise-evidence/metadata",
          `${file} imports ${s}`,
        ).toBe(false);
      }
    }
  });

  it("only workspace dependency is the canonical vocabulary in @wise-evidence/database", () => {
    for (const { specs } of files) {
      for (const s of specs) {
        if (s.startsWith("@wise-evidence/")) {
          expect(s).toBe("@wise-evidence/database");
        }
      }
    }
  });
});

describe("the AI orchestrator is provider-agnostic", () => {
  const specs = importSpecifiers(read("packages/ai/src/orchestrator.ts"));

  it("imports no concrete provider and not the registry (only the AIProvider interface)", () => {
    for (const s of specs) {
      expect(s.includes("providers/"), `orchestrator imports concrete provider ${s}`).toBe(false);
      expect(s.includes("provider-registry"), `orchestrator imports registry ${s}`).toBe(false);
    }
  });

  it("obtains the provider type from ./types (the interface boundary)", () => {
    expect(specs).toContain("./types.js");
  });
});

describe("packages/database is the canonical boundary below AI", () => {
  const files = packageSpecifiers("packages/database/src");

  it("does not import @wise-evidence/ai (dependency direction is ai → database)", () => {
    for (const { file, specs } of files) {
      for (const s of specs) {
        expect(s.startsWith("@wise-evidence/ai"), `${file} imports ${s}`).toBe(false);
      }
    }
  });

  it("does not import a UI framework", () => {
    for (const { file, specs } of files) {
      for (const s of specs) {
        expect(matchesAny(s, UI_FRAMEWORKS), `${file} imports ${s}`).toBe(false);
      }
    }
  });
});

describe("server-only secrets are never exposed to the browser via PUBLIC_", () => {
  // Astro inlines ONLY `PUBLIC_`-prefixed env into client bundles. AI keys,
  // the service-role key, and any secret must therefore never be PUBLIC_
  // (CLAUDE.md AI rules; render.yaml SAFETY posture). Scan real config + source.
  const scanned = [
    ".env.example",
    "render.yaml",
    ...collectFiles(join(REPO_ROOT, "apps/web/src"), CODE_EXTS).map((f) =>
      f.slice(REPO_ROOT.length),
    ),
    ...collectFiles(join(REPO_ROOT, "packages"), [".ts"]).map((f) => f.slice(REPO_ROOT.length)),
  ];

  // A PUBLIC_-prefixed name that also names a secret/AI/service-role/key concept.
  const forbidden = /\bPUBLIC_[A-Z0-9_]*(AI|API_KEY|SERVICE_ROLE|SECRET|PRIVATE)[A-Z0-9_]*/;

  it("no AI key, service-role key, or secret is declared with a PUBLIC_ prefix", () => {
    for (const rel of scanned) {
      const src = read(rel);
      const m = src.match(forbidden);
      expect(m, `${rel} exposes a secret via ${m?.[0]}`).toBeNull();
    }
  });
});

describe("public web routes never use the RLS-bypassing service executor", () => {
  // Non-admin, non-API pages must read via asAnon (RLS-scoped anon path).
  const publicPages = [
    "apps/web/src/pages/index.astro",
    "apps/web/src/pages/methodology.astro",
    "apps/web/src/pages/research/index.astro",
    "apps/web/src/pages/research/[id].astro",
    "apps/web/src/pages/evidence/index.astro",
    "apps/web/src/pages/statistics/index.astro",
  ];

  for (const page of publicPages) {
    it(`${page} does not reference asService`, () => {
      const src = read(page);
      expect(/\basService\b/.test(src), `${page} references asService`).toBe(false);
    });
  }

  it("the public pages that touch the database use the anon executor", () => {
    const dbPages = [
      "apps/web/src/pages/research/index.astro",
      "apps/web/src/pages/research/[id].astro",
      "apps/web/src/pages/evidence/index.astro",
      "apps/web/src/pages/statistics/index.astro",
    ];
    for (const page of dbPages) {
      expect(/\basAnon\b/.test(read(page)), `${page} should use asAnon`).toBe(true);
    }
  });
});
