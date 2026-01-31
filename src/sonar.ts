import fs from "node:fs";
import path from "node:path";

import type { AaoConfig } from "./lib/config.js";
import { buildScalarTokenMap, formatCmd, formatEnv, runProcess } from "./lib/tooling.js";

type PublishSonarOpts = {
  cfg: AaoConfig;
  projectRootAbs: string;
  resultsDirAbs: string;
  coverageDirAbs: string;
  junitMergedFileName: string; // e.g. "junit-merged.xml"
};

export async function publishSonar(opts: PublishSonarOpts): Promise<void> {
  const { cfg, projectRootAbs } = opts;
  const sonar = cfg.consumers?.sonar;
  if (!sonar?.enabled) return;

  if (!sonar.cmd) {
    throw new Error("Sonar enabled but consumers.sonar.cmd is missing");
  }

  const tokenMap = buildScalarTokenMap(cfg);

  const { cmd, args } = formatCmd(sonar.cmd, {
    projectRootAbs,
    testRootRel: cfg.project["test-root"],
    resultsDirRel: cfg.project["results-dir"],
    coverageDirRel: cfg.project["coverage-dir"],
    tokenMap,
  });

  const env = formatEnv(sonar.env, cfg);

  console.log(`sonar: publish project=${sonar["project-key"]}`);

  const res = await runProcess(cmd, args, projectRootAbs, env);
  if (res.code !== 0) {
    throw new Error(`sonar-scanner failed with exit code ${res.code}`);
  }
}
