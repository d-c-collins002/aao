export type NeedSpec = string | { name: string; hint?: string };

export class EnvError extends Error {
  public missing: NeedSpec[];

  constructor(message: string, missing: NeedSpec[]) {
    super(message);
    this.missing = missing;
  }
}

function isSet(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

export function needAll(
  specs: NeedSpec[],
  opts?: { header?: string; alsoPrintPresent?: string[] }
): Record<string, string> {
  const header = opts?.header ?? "Missing required environment variables:";
  const missing: NeedSpec[] = [];
  const values: Record<string, string> = {};

  for (const s of specs) {
    const name = typeof s === "string" ? s : s.name;
    const v = process.env[name];
    if (!isSet(v)) missing.push(s);
    else values[name] = v.trim();
  }

  if (missing.length) {
    const lines: string[] = [];
    lines.push(header);
    for (const m of missing) {
      if (typeof m === "string") lines.push(`  - ${m}`);
      else lines.push(`  - ${m.name}${m.hint ? ` (${m.hint})` : ""}`);
    }

    if (opts?.alsoPrintPresent?.length) {
      const present = opts.alsoPrintPresent.filter((n) => isSet(process.env[n]));
      if (present.length) {
        lines.push("");
        lines.push("Present:");
        for (const p of present) lines.push(`  - ${p}`);
      }
    }

    throw new EnvError(lines.join("\n"), missing);
  }

  return values;
}

export function requireEnv(key: string): string {
  const v = process.env[key];
  if (!isSet(v)) {
    throw new EnvError(`Missing required environment variable: ${key}`, [key]);
  }
  return v.trim();
}

export function requireEnvMany(keys: string[]): Record<string, string> {
  const missing = keys.filter((k) => !isSet(process.env[k]));
  if (missing.length) {
    throw new EnvError(
      `Missing required environment variables:\n  ${missing.join("\n  ")}`,
      missing
    );
  }
  const out: Record<string, string> = {};
  for (const k of keys) out[k] = String(process.env[k]).trim();
  return out;
}
