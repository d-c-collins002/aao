// src/lib/agiletestAuth.ts
import { postJsonText } from "./http.js";
import type { AaoConfig } from "./config.js";

type JwtCacheKey = string;

let cached: { key: JwtCacheKey; jwt: string } | null = null;

function stripTrailingSlashes(s: string): string {
  return s.replace(/\/+$/, "");
}

export function getAgiletestBases(cfg: AaoConfig): { authBase: string; submitBase: string } {
  const at = cfg.producers.agiletest as any;

  const authBase = stripTrailingSlashes(String(at["auth-base-url"] ?? "").trim());
  const submitBase = stripTrailingSlashes(String(at["submit-base-url"] ?? "").trim());

  return { authBase, submitBase };
}

export async function getAgiletestJwt(cfg: AaoConfig): Promise<string> {
  const producers = cfg.producers!;
  const at = producers.agiletest!;

  const clientId = String(at["client-id"] ?? "").trim();
  const clientSecret = String(at["client-secret"] ?? "").trim();

  const { authBase } = getAgiletestBases(cfg);
  const cacheKey: JwtCacheKey = `${authBase}::${clientId}`;

  if (cached && cached.key === cacheKey && cached.jwt.trim().length > 0) {
    return cached.jwt;
  }

  const url = new URL("/api/apikeys/authenticate", authBase).toString();
  const jwtRaw = await postJsonText(url, { clientId, clientSecret });

  const jwt = jwtRaw.trim();
  if (!jwt) throw new Error("[AAO][agiletestAuth] authenticate returned empty token");

  cached = { key: cacheKey, jwt };
  return jwt;
}
