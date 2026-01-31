import fs from "node:fs";
import path from "node:path";

export type ScriptHeader = Record<string, string>;

function stripQuotes(s: string): string {
  const t = s.trim();
  if (
    (t.startsWith('"') && t.endsWith('"')) ||
    (t.startsWith("'") && t.endsWith("'"))
  ) {
    return t.slice(1, -1);
  }
  return t;
}

function parseSuites(val: string): string {
  const t = val.trim();

  // TS style: ["@a", "@b"]
  if (t.startsWith("[") && t.endsWith("]")) {
    try {
      const parsed = JSON.parse(t) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.map((x) => String(x)).join(" ");
      }
    } catch {
      // fall through to raw
    }
  }

  // Markdown style: @a @b
  return stripQuotes(t).replace(/\s+/g, " ").trim();
}

/**
 * Reads the first N lines and parses header-ish declarations:
 *
 * Supports:
 *   KEY = value
 *   KEY=value
 *   export const KEY = "value";
 *   export const KEY = ["@a","@b"];
 *
 * The header can appear inside block comments (TS/JS) or HTML comments (MD).
 */
export function parseScriptHeader(filePath: string, maxLines = 80): ScriptHeader {
  const raw = fs.readFileSync(filePath, "utf-8");
  const lines = raw.split(/\r?\n/).slice(0, maxLines);

  const out: ScriptHeader = {};

  for (const line of lines) {
    // Trim typical comment prefixes.
    const cleaned = line
      .replace(/^\s*\/\*\*?/, "")
      .replace(/^\s*\*+/, "")
      .replace(/^\s*<!--/, "")
      .replace(/-->\s*$/, "")
      .trim();

    if (!cleaned) continue;

    // Accept either "KEY = value" or "export const KEY = value;"
    const m = cleaned.match(
      /^(?:export\s+const\s+)?([A-Z0-9_]+)\s*=\s*(.+?)\s*;?\s*$/
    );
    if (!m) continue;

    const key = m[1];
    const rawVal = m[2].trim();

    if (key === "SUITES") {
      out[key] = parseSuites(rawVal);
      continue;
    }

    // For normal string-ish values, strip quotes and trailing commas.
    out[key] = stripQuotes(rawVal.replace(/,\s*$/, "").trim());
  }

  return out;
}

export function isAutomationScript(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".md"].includes(ext);
}
