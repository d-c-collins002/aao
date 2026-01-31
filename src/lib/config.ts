/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * src/lib/config.ts
 *
 * Canonical config loader + deep merge for AAO.
 *
 * Precedence (as implemented):
 *   1) defaults file (aao.defaults.json)
 *   2) environment variables (AAO_* mapped from known JSON paths)
 *   3) CLI overrides (not used right now, but kept as a hook)
 *
 * Notes:
 * - Defaults file location is resolved from the AAO package root so it works
 *   regardless of process.cwd().
 * - AAO_DEFAULTS_ROOT may override defaults location (document in README).
 * - AAO_PROJECT_ROOT may override project.root at runtime.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonArray;
export type JsonObject = { [k: string]: JsonValue };
export type JsonArray = JsonValue[];

export type EnvMap = Record<string, string>;

export type AgiletestProducerConfig = {
  "auth-base-url": string;
  "submit-base-url": string;
  "project-id": string;
  "client-id": string;
  "client-secret": string;
  timezone: string;
  "test-plan-keys"?: string;
  "nightly-test-plan-keys"?: string;
};

export type JiraProducerConfig = {
  "base-url": string;
  email: string;
  "api-token": string;
};

export type ProducersConfig = {
  agiletest: AgiletestProducerConfig;
  jira: JiraProducerConfig;
};

export type ExecutorConfig = {
  match?: string;
  cmd?: string;
  env?: EnvMap; // NEW
};

export type SonarConsumerConfig = {
  enabled?: boolean;
  "host-url"?: string;
  org?: string;
  "project-key"?: string;
  token?: string;
  cmd?: string;
  env?: EnvMap; // NEW
};

export type AaoConfig = {
  project: {
    "defaults-root": string;
    "project-root": string;
    "test-root": string;
    "results-dir": string;
    "coverage-dir": string;
  };
  producers: Partial<ProducersConfig>;
  executors: Record<string, ExecutorConfig>;
  consumers?: {
    sonar?: SonarConsumerConfig;
  };
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function toJsonValue(v: unknown, ctxPath = "<root>"): JsonValue {
  if (
    v === null ||
    typeof v === "string" ||
    typeof v === "number" ||
    typeof v === "boolean"
  ) {
    return v;
  }
  if (Array.isArray(v)) {
    return v.map((x, i) => toJsonValue(x, `${ctxPath}[${i}]`));
  }
  if (isPlainObject(v)) {
    const out: JsonObject = {};
    for (const [k, vv] of Object.entries(v)) {
      out[k] = toJsonValue(vv, `${ctxPath}.${k}`);
    }
    return out;
  }
  throw new Error(`Invalid JSON value at ${ctxPath}: ${String(v)}`);
}

export function deepMerge(a: JsonValue, b: JsonValue): JsonValue {
  // Arrays are replaced, not concatenated.
  if (Array.isArray(a) && Array.isArray(b)) return b;

  // Objects are merged recursively.
  if (isPlainObject(a) && isPlainObject(b)) {
    const out: JsonObject = { ...(a as any) };
    for (const [k, bv] of Object.entries(b)) {
      const bJson = toJsonValue(bv, k);
      if (k in out) out[k] = deepMerge(out[k], bJson);
      else out[k] = bJson;
    }
    return out;
  }

  // Primitives: b wins.
  return b;
}

export function readJsonFile(filePath: string): JsonObject {
  const raw = fs.readFileSync(filePath, "utf-8");
  const parsed: unknown = JSON.parse(raw);
  const json = toJsonValue(parsed, filePath);
  if (!isPlainObject(json)) {
    throw new Error(`Config must be a JSON object: ${filePath}`);
  }
  return json as JsonObject;
}

function packageRootDir(): string {
  // dist/lib/config.js -> dist/lib -> dist -> <pkgroot>
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "..", "..");
}

function resolveDefaultsPath(): string {
  const env = process.env.AAO_DEFAULTS_ROOT;
  if (env && env.trim().length > 0) {
    return path.isAbsolute(env) ? env : path.resolve(process.cwd(), env);
  }

  // Default: next to package.json/aao.defaults.json in the AAO package root
  return path.join(packageRootDir(), "aao.defaults.json");
}

export function loadDefaults(): JsonObject {
  const abs = resolveDefaultsPath();
  if (!fs.existsSync(abs)) {
    throw new Error(`aao.defaults.json not found at: ${abs} (set AAO_DEFAULTS_ROOT to override)`);
  }
  return readJsonFile(abs);
}

function stripTopLevel(jsonPath: string): string {
  const idx = jsonPath.indexOf(".");
  return idx >= 0 ? jsonPath.slice(idx + 1) : jsonPath;
}

function toEnvName(jsonPath: string): string {
  const stripped = stripTopLevel(jsonPath);
  return (
    "AAO_" +
    stripped
      .replaceAll(".", "_")
      .replaceAll("-", "_")
      .toUpperCase()
  );
}

function setPath(obj: JsonObject, jsonPath: string, value: JsonValue): void {
  const parts = jsonPath.split(".");
  let cur: JsonObject = obj;

  for (let i = 0; i < parts.length; i++) {
    const key = parts[i];
    const last = i === parts.length - 1;
    if (last) {
      cur[key] = value;
      return;
    }
    const existing = cur[key];
    if (existing && isPlainObject(existing)) {
      cur = existing as JsonObject;
    } else {
      const next: JsonObject = {};
      cur[key] = next;
      cur = next;
    }
  }
}

function flattenJsonPaths(obj: JsonValue, prefix = "", out: string[] = []): string[] {
  if (!isPlainObject(obj)) return out;
  for (const [k, v] of Object.entries(obj)) {
    const p = prefix ? `${prefix}.${k}` : k;
    out.push(p);
    flattenJsonPaths(v as JsonValue, p, out);
  }
  return out;
}

function applyEnvOverrides(base: JsonObject): JsonObject {
  const patched: JsonObject = {};
  const paths = flattenJsonPaths(base);

  for (const p of paths) {
    const envName = toEnvName(p);
    const raw = process.env[envName];
    if (raw === undefined) continue;

    let v: JsonValue = raw;
    if (raw === "true") v = true;
    else if (raw === "false") v = false;

    setPath(patched, p, v);
  }

  return patched;
}

export type LoadConfigOptions = {
  cliOverrides?: JsonObject;
};

export function loadConfig(opts: LoadConfigOptions = {}): AaoConfig {
  const defaults = loadDefaults();

  const envPatch = applyEnvOverrides(defaults);
  const merged01 = deepMerge(defaults, envPatch) as JsonObject;

  const cliPatch = opts.cliOverrides ?? {};
  const merged02 = deepMerge(merged01, cliPatch) as JsonObject;

  const pr = process.env.AAO_PROJECT_ROOT?.trim() ?? "";
  if (!pr) {
    throw new Error(
      [
        "Missing required environment variable: AAO_PROJECT_ROOT",
        "",
        "AAO does not derive your repo layout. Set AAO_PROJECT_ROOT to the workspace root.",
        "",
        'Example: export AAO_PROJECT_ROOT="/absolute/path/to/workspace"',
      ].join("\\n")
    );
  }

  if (!isPlainObject(merged02.project)) merged02.project = {};
  // Canonical key used by your config type:
  (merged02.project as JsonObject)["project-root"] = pr;

  return merged02 as unknown as AaoConfig;
}
