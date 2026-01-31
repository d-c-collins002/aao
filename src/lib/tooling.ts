// packages/agiletest-automation-orchestrator/src/lib/tooling.ts
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { AaoConfig } from "./config.js";

export type ExecResult = { code: number; signal: NodeJS.Signals | null };

export type TemplateContext = {
  /**
   * Absolute workspace root (AAO_PROJECT_ROOT).
   */
  projectRootAbs: string;

  /**
   * Raw (possibly relative) configured paths.
   */
  testRootRel?: string;
  resultsDirRel?: string;
  coverageDirRel?: string;

  /**
   * Optional list expansion (used by executors for selected test files).
   * If provided, AAO will emit fully qualified absolute paths.
   */
  filesAbs?: string[];

  /**
   * Optional "match" token for templates that embed `{match}`.
   * (Example: `{expand:project-root/coverage-dir|{match}|,}`)
   */
  match?: string;

  tokenMap?: Record<string, string>;
};

function tokenizeCmdLine(expanded: string): { cmd: string; args: string[] } {
  // Minimal but practical tokenization:
  // - splits on whitespace when not inside double-quotes
  // - supports \" inside quoted strings
  const parts: string[] = [];
  let cur = "";
  let inQuotes = false;
  let escape = false;

  for (const ch of expanded) {
    if (escape) {
      cur += ch;
      escape = false;
      continue;
    }

    if (ch === "\\") {
      escape = true;
      continue;
    }

    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (!inQuotes && /\s/.test(ch)) {
      if (cur.length) {
        parts.push(cur);
        cur = "";
      }
      continue;
    }

    cur += ch;
  }

  if (cur.length) parts.push(cur);

  if (parts.length === 0) {
    throw new Error("formatCmd: expanded template produced an empty command");
  }

  return { cmd: parts[0], args: parts.slice(1) };
}

function walkFilesRecursive(dirAbs: string): string[] {
  const out: string[] = [];
  const stack: string[] = [dirAbs];

  while (stack.length) {
    const d = stack.pop()!;
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const ent of entries) {
      const full = path.join(d, ent.name);
      if (ent.isDirectory()) stack.push(full);
      else if (ent.isFile()) out.push(full);
    }
  }

  out.sort();
  return out;
}

function resolvePathExpr(expr: string, ctx: TemplateContext): string {
  const raw = expr.trim();
  if (!raw) throw new Error("expand: base expression is empty");

  if (path.isAbsolute(raw)) return raw;

  const segs = raw.split("/").filter(Boolean);
  const resolvedSegs = segs.map((s) => {
    if (s === "project-root") return ctx.projectRootAbs;
    if (s === "test-root") return ctx.testRootRel ?? "";
    if (s === "results-dir") return ctx.resultsDirRel ?? "";
    if (s === "coverage-dir") return ctx.coverageDirRel ?? "";
    return s;
  });

  const joined = path.join(...resolvedSegs);
  return path.isAbsolute(joined) ? joined : path.resolve(ctx.projectRootAbs, joined);
}

/**
 * Build a deterministic scalar token map from the resolved config.
 *
 * Token rule (as per README):
 * - Strip the top-level object name (project, producers, executors, consumers)
 * - Join remaining segments with "-"
 * - Keep lower-case
 */
export function buildScalarTokenMap(cfg: AaoConfig): Record<string, string> {
  const out: Record<string, string> = {};

  const visit = (node: unknown, p: string[]) => {
    if (node === null || node === undefined) return;

    if (Array.isArray(node)) return;

    if (typeof node === "object") {
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        visit(v, [...p, k]);
      }
      return;
    }

    const [top, ...rest] = p;
    if (!top || rest.length === 0) return;

    const token = rest.join("-").toLowerCase();
    out[token] = String(node);
  };

  visit(cfg as unknown, []);
  return out;
}

export function expandScalars(input: string, tokenMap: Record<string, string>): string {
  return input.replace(/\{([a-z0-9-]+)\}/gi, (m, token) => {
    const key = String(token).toLowerCase();
    return Object.prototype.hasOwnProperty.call(tokenMap, key) ? tokenMap[key] : m;
  });
}

export function formatEnv(
  env: Record<string, string> | undefined,
  cfg: AaoConfig,
): Record<string, string> {
  if (!env) return {};

  const tokenMap = buildScalarTokenMap(cfg);
  const out: Record<string, string> = {};

  for (const [name, rawVal] of Object.entries(env)) {
    const val = expandScalars(String(rawVal), tokenMap);

    if (!/^[A-Z_][A-Z0-9_]*$/.test(name)) {
      throw new Error(`Invalid env var name in config: "${name}"`);
    }

    if (val.includes("{expand:")) {
      throw new Error(`env value for "${name}" contains "{expand:...}", which is not supported`);
    }

    out[name] = val;
  }

  return out;
}

function scalarReplace(input: string, ctx: TemplateContext): string {
  let out = input;

  if (ctx.tokenMap) out = expandScalars(out, ctx.tokenMap);

  out = out.replaceAll("{project-root}", ctx.projectRootAbs);

  if (ctx.testRootRel !== undefined) out = out.replaceAll("{test-root}", ctx.testRootRel);
  if (ctx.resultsDirRel !== undefined) out = out.replaceAll("{results-dir}", ctx.resultsDirRel);
  if (ctx.coverageDirRel !== undefined) out = out.replaceAll("{coverage-dir}", ctx.coverageDirRel);

  // Back-compat token
  out = out.replaceAll("{root}", ctx.projectRootAbs);

  if (ctx.match !== undefined) out = out.replaceAll("{match}", ctx.match);

  if (out.includes("{files}")) {
    if (!ctx.filesAbs) {
      throw new Error('formatCmd: template used "{files}" but no filesAbs were provided');
    }
    const filesStr = ctx.filesAbs.map((f) => `"${f}"`).join(" ");
    out = out.replaceAll("{files}", filesStr);
  }

  return out;
}

function expandMacro(template: string, ctx: TemplateContext): string {
  let out = template;

  while (true) {
    const start = out.indexOf("{expand:");
    if (start < 0) break;
    const end = out.indexOf("}", start);
    if (end < 0) {
      throw new Error(`formatCmd: unterminated {expand:...} macro in: ${out}`);
    }

    const inside = out.slice(start + "{expand:".length, end);
    const parts = inside.split("|");
    if (parts.length !== 3) {
      throw new Error(
        `formatCmd: expand macro must have 3 pipe-delimited parts: {expand:<base>|<match>|<sep>}. Got: {expand:${inside}}`
      );
    }

    const baseExprRaw = parts[0].trim();
    const matchRaw = parts[1].trim();
    const sep = parts[2]; // do not trim; caller controls separator

    const baseExpr = scalarReplace(baseExprRaw, ctx);
    const matchExpr = scalarReplace(matchRaw, ctx);

    const baseAbs = resolvePathExpr(baseExpr, ctx);
    const re = new RegExp(matchExpr);

    const files = walkFilesRecursive(baseAbs).filter((abs) => {
      const rel = path.relative(baseAbs, abs);
      return re.test(rel);
    });

    const joined = files.join(sep);
    out = out.slice(0, start) + joined + out.slice(end + 1);
  }

  return out;
}

export function formatCmd(template: string, ctx: TemplateContext): { cmd: string; args: string[] } {
  const afterExpand = expandMacro(template, ctx);
  const expanded = scalarReplace(afterExpand, ctx);
  return tokenizeCmdLine(expanded);
}

function formatSpawnError(err: unknown, cmd: string, args: string[], cwd: string): Error {
  const e = err as NodeJS.ErrnoException;
  const code = e?.code ? String(e.code) : "UNKNOWN";
  const msg = e?.message ? String(e.message) : String(err);

  const pathEnv = process.env.PATH ?? "";
  const hint =
    code === "ENOENT"
      ? `\nHINT: "${cmd}" was not found on PATH. Ensure it is installed and available in this step.\nPATH=${pathEnv}`
      : "";

  return new Error(
    [
      `runProcess: spawn failed`,
      `code=${code}`,
      `cwd=${cwd}`,
      `cmd=${cmd}`,
      `args=${JSON.stringify(args)}`,
      `message=${msg}`,
      hint,
    ].join("\n")
  );
}

export async function runProcess(
  cmd: string,
  args: string[],
  cwd: string,
  envOverride?: Record<string, string>
): Promise<ExecResult> {
  // Always log the invocation (but never values of env overrides).
  // Keep this outside try/catch so it never disappears due to early throws.
  console.log(
    `runProcess: cwd=${cwd}\n` +
      `runProcess: cmd=${cmd}\n` +
      `runProcess: args=${JSON.stringify(args)}\n` +
      `runProcess: envOverrideKeys=${JSON.stringify(envOverride ? Object.keys(envOverride) : [])}`
  );

  return await new Promise((resolve, reject) => {
    const p = spawn(cmd, args, {
      cwd,
      stdio: "inherit",
      shell: false,
      env: envOverride ? { ...process.env, ...envOverride } : process.env,
    });

    p.on("error", (err) => reject(formatSpawnError(err, cmd, args, cwd)));
    p.on("close", (code, signal) => resolve({ code: code ?? 1, signal }));
  });
}
