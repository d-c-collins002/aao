import fs from "node:fs";
import path from "node:path";
import { glob } from "glob";
import { loadConfig } from "../lib/config.js";
import { validateConfig } from "../lib/validateConfig.js";
import { parseScriptHeader, isAutomationScript } from "../lib/header.js";
import { toCsvRow } from "../lib/csv.js";

type ListTestsOpts = {
  out?: string; // output csv path, relative to repo root if not absolute
};

export async function listTests(opts: ListTestsOpts): Promise<void> {
  const cfg = loadConfig();
  validateConfig(cfg);

  const rootAbs = path.resolve(cfg.project["project-root"]);
  const testRootAbs = path.resolve(rootAbs, cfg.project["test-root"]);
  const resultsDirAbs = path.resolve(rootAbs, cfg.project["results-dir"]);
  fs.mkdirSync(resultsDirAbs, { recursive: true });

  const outPath = opts.out
    ? (path.isAbsolute(opts.out) ? opts.out : path.resolve(rootAbs, opts.out))
    : path.resolve(resultsDirAbs, "tests-index.csv");

  const files = await glob("**/*", { cwd: testRootAbs, nodir: true, dot: false });
  const absFiles = files.map((p: string) => path.join(testRootAbs, p)).filter(isAutomationScript);

  const cols = ["TEST_ID", "TEST_TYPE", "TEST_TITLE", "AGILETEST_TICKET", "TC_ID", "TC_DESC", "SUITES", "FILE"];
  const rows: string[] = [toCsvRow(cols)];

  for (const full of absFiles) {
    const rel = path.relative(testRootAbs, full);
    const h = parseScriptHeader(full);

    if (!h.TEST_TYPE && !h.AGILETEST_TICKET && !h.TC_ID) continue;

    rows.push(
      toCsvRow([
        h.AGILETEST_TICKET || h.TC_ID || "",
        h.TEST_TYPE || "",
        h.TEST_TITLE || "",
        h.AGILETEST_TICKET || "",
        h.TC_ID || "",
        h.TC_DESC || "",
        h.SUITES || "",
        rel,
      ])
    );
  }

  fs.writeFileSync(outPath, rows.join("\n") + "\n", "utf-8");
  // eslint-disable-next-line no-console
  console.log(`list-tests: wrote ${rows.length - 1} rows to ${outPath}`);
}
