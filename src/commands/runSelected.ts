import path from "node:path";
import fs from "node:fs";
import { glob } from "glob";

import { loadConfig } from "../lib/config.js";
import { validateConfig } from "../lib/validateConfig.js";
import { formatCmd, formatEnv, runProcess, buildScalarTokenMap } from "../lib/tooling.js";
import { parseScriptHeader, isAutomationScript } from "../lib/header.js";
import { publishSonar } from "../sonar.js";

import { expandAgiletestPlan } from "./expandAgiletestPlan.js";
import { mergeJunit } from "./mergeJunit.js";
import { uploadAgiletest } from "./uploadAgiletest.js";

type ExecutorRule = { match?: string; cmd?: string };

export async function runSelected(): Promise<void> {
  const cfg = loadConfig();
  validateConfig(cfg);

  const rootAbs = path.resolve(cfg.project["project-root"]);
  const testRootAbs = path.resolve(rootAbs, cfg.project["test-root"]);
  const resultsDirAbs = path.resolve(rootAbs, cfg.project["results-dir"]);
  const coverageDirAbs = path.resolve(rootAbs, cfg.project["coverage-dir"]);

  fs.mkdirSync(resultsDirAbs, { recursive: true });
  fs.mkdirSync(coverageDirAbs, { recursive: true });

  const execBaseRel = path.dirname(cfg.project["test-root"]);

  const planKeysRaw = (cfg.producers?.agiletest?.["test-plan-keys"] ?? "").trim();
  const selected = planKeysRaw.length > 0;

  const allFiles = await glob("**/*", {
    cwd: testRootAbs,
    nodir: true,
    dot: false,
  });

  const absFiles = allFiles
    .map((p) => path.join(testRootAbs, p))
    .filter(isAutomationScript);

  let selectedTicketSet: Set<string> | null = null;

  if (selected) {
    const tcKeys = await expandAgiletestPlan({ testPlanKeys: planKeysRaw });
    selectedTicketSet = new Set(tcKeys);
    if (selectedTicketSet.size === 0) return;
  }

  const byType: Record<string, string[]> = {};

  for (const full of absFiles) {
    const rel = path.relative(testRootAbs, full);
    const h = parseScriptHeader(full);

    if (selectedTicketSet) {
      const ticket = (h.AGILETEST_TICKET ?? "").trim();
      if (!ticket || !selectedTicketSet.has(ticket)) continue;
    }

    const type =
      (h.TEST_TYPE ?? "").trim() ||
      classifyByRegex(cfg.executors, rel);

    if (!type) continue;

    const relFromRoot = path.relative(rootAbs, full);
    (byType[type] ??= []).push(relFromRoot);
  }

  const tokenMap = buildScalarTokenMap(cfg);

  const failures: Array<{ type: string; code: number }> = [];

  for (const type of Object.keys(cfg.executors)) {
    if (type === "manual") continue;
    const files = byType[type] ?? [];
    if (!files.length) continue;

    const ex = cfg.executors[type];
    if (!ex?.cmd) {
      throw new Error(`Executor "${type}" missing cmd`);
    }
    // Convert repo-relative file paths to absolute paths (Option C: fully qualified paths).
    // These are emitted into `{files}` and do not rely on working-directory assumptions.
    const filesAbs = files.map((relFromRoot) => path.resolve(rootAbs, relFromRoot));

    const { cmd, args } = formatCmd(ex.cmd, {
      projectRootAbs: rootAbs,
      testRootRel: cfg.project["test-root"],
      resultsDirRel: cfg.project["results-dir"],
      coverageDirRel: cfg.project["coverage-dir"],
      filesAbs,
      tokenMap,
    });


    const envOverride = formatEnv(ex.env, cfg);

    const res = await runProcess(cmd, args, rootAbs, envOverride);
    if (res.code !== 0) failures.push({ type, code: res.code });
  }

  await mergeJunit({
    resultsDir: resultsDirAbs,
    outFile: "junit-merged.xml",
  });

  await uploadAgiletest({
    resultsDirAbs: resultsDirAbs,
    junitFile: "junit-merged.xml",
  });

  await publishSonar({
    cfg,
    projectRootAbs: rootAbs,
    resultsDirAbs,
    coverageDirAbs,
    junitMergedFileName: "junit-merged.xml",
  });

  if (failures.length) {
    throw new Error(
      `One or more executors failed: ${failures
        .map((f) => `${f.type}=${f.code}`)
        .join(", ")}`
    );
  }
}

function classifyByRegex(
  executors: Record<string, ExecutorRule>,
  relPath: string
): string | null {
  for (const [k, rule] of Object.entries(executors)) {
    if (rule.match && new RegExp(rule.match).test(relPath)) return k;
  }
  return null;
}
