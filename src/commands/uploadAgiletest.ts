// src/commands/uploadAgiletest.ts
import fs from "node:fs";
import path from "node:path";

import { loadConfig } from "../lib/config.js";
import { validateConfig } from "../lib/validateConfig.js";
import { getAgiletestBases, getAgiletestJwt } from "../lib/agiletestAuth.js";

type UploadAgiletestOpts = {
  resultsDirAbs: string;      // absolute path to results dir
  junitFile: string;          // filename inside resultsDirAbs
};

function parsePlanKeys(raw: string): string[] {
  return raw
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function uploadAgiletest(opts: UploadAgiletestOpts): Promise<void> {
  const cfg = loadConfig();
  validateConfig(cfg);

  const producers = cfg.producers!;
  const at = producers.agiletest!;

  const projectId = String(at["project-id"] ?? "").trim();

  const junitPath = path.join(opts.resultsDirAbs, opts.junitFile);

  if (!fs.existsSync(junitPath) || fs.statSync(junitPath).size === 0) {
    throw new Error(`[AAO][uploadAgiletest] Combined JUnit not found or empty: ${junitPath}`);
  }

  const { authBase, submitBase } = getAgiletestBases(cfg);

  const jwt = await getAgiletestJwt(cfg);

  // Attach plan keys if provided (selected mode)
  const planKeysRaw = String(at["test-plan-keys"] ?? "").trim();
  const planKeys = parsePlanKeys(planKeysRaw);

  const url = new URL("/ds/test-executions/junit", submitBase);
  url.searchParams.set("projectKey", projectId);

  // Swagger describes `testPlanKeys` as array[string], so send repeated params:
  // ...&testPlanKeys=SWIM-66&testPlanKeys=SWIM-68 :contentReference[oaicite:2]{index=2}
  for (const k of planKeys) url.searchParams.append("testPlanKeys", k);

  const xml = fs.readFileSync(junitPath);

  const res = await fetch(url.toString(), {
    method: "POST",
    headers: {
      Authorization: `JWT ${jwt}`,
      "Content-Type": "application/xml",
      Accept: "application/json",
    },
    body: xml,
  });

  const body = await res.text();
  if (!res.ok) {
    // eslint-disable-next-line no-console
    console.error(`[AAO][uploadAgiletest] Upload failed (HTTP ${res.status}). Body:\n${body}`);
    throw new Error(`[AAO][uploadAgiletest] Upload failed: HTTP ${res.status}`);
  }

  // eslint-disable-next-line no-console
  console.log(`Successfully uploaded results to Agiletest`);
}
