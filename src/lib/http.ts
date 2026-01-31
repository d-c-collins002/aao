/**
 * src/lib/http.ts
 * Minimal HTTP helpers for AAO (Node 18+ has global fetch)
 */

export type FetchJsonOptions = {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
};

export function basicAuth(username: string, password: string): string {
  const raw = `${username}:${password}`;
  const b64 = Buffer.from(raw, "utf-8").toString("base64");
  return `Basic ${b64}`;
}

function formatCause(e: unknown): string {
  const err = e as { cause?: unknown };
  const c = err?.cause;
  if (c instanceof Error) return `${c.name}: ${c.message}`;
  if (typeof c === "string") return c;
  if (c) return String(c);
  return "";
}

async function fetchWithTimeout(url: string, opts: FetchJsonOptions): Promise<Response> {
  const controller = new AbortController();
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const t = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      method: opts.method ?? "GET",
      headers: opts.headers,
      body: opts.body,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(t);
  }
}

export async function fetchText(url: string, opts: FetchJsonOptions = {}): Promise<string> {
  try {
    const res = await fetchWithTimeout(url, opts);
    const text = await res.text();

    if (!res.ok) {
      throw new Error(
        `HTTP ${res.status} ${res.statusText} for ${url}\n` +
          `Response (first 500 chars): ${text.slice(0, 500)}`
      );
    }

    return text;
  } catch (e) {
    const err = e as { message?: string };
    const cause = formatCause(e);
    throw new Error(
      `fetch failed\nurl=${url}\nmsg=${err?.message ?? String(e)}\n` + (cause ? `cause=${cause}` : `cause=`)
    );
  }
}

export async function fetchJson<T>(url: string, opts: FetchJsonOptions = {}): Promise<T> {
  const text = await fetchText(url, opts);
  try {
    return JSON.parse(text) as T;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(
      `Invalid JSON from ${url}: ${msg}\nResponse (first 500 chars): ${text.slice(0, 500)}`
    );
  }
}

/**
 * POST JSON and return response body as raw text (AgileTest authenticate returns a JWT string)
 */
export async function postJsonText(
  url: string,
  bodyObj: unknown,
  headers: Record<string, string> = {},
  timeoutMs = 30_000
): Promise<string> {
  return fetchText(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "*/*",
      ...headers,
    },
    body: JSON.stringify(bodyObj),
    timeoutMs,
  });
}
