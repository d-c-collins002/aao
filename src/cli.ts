#!/usr/bin/env node
import { Command } from "commander";
import { runSelected } from "./commands/runSelected.js";


const program = new Command();

program
  .name("aao")
  .description("AgileTest Automation Orchestrator (AAO)")
  .version("0.1.1")
  .option(
    "--test-plan-keys <keys>",
    'Space-separated Jira Test Plan keys (e.g. "SWIM-64 SWIM-66")'
  );

// Single-command CLI:
// `aao` means "run tests". Selection is driven by config/env only:
// - if producers.agiletest.test-plan-keys (or AAO_AGILETEST_TEST_PLAN_KEYS) is set -> selected mode
// - else -> all mode
program.action(async () => {
  const opts = program.opts<{ testPlanKeys?: string }>();

  // Minimal contract: CLI flag overrides env/config by setting the env var
  // that already maps to producers.agiletest.test-plan-keys per README.
  if (opts.testPlanKeys && opts.testPlanKeys.trim().length > 0) {
    process.env.AAO_AGILETEST_TEST_PLAN_KEYS = opts.testPlanKeys.trim();
  }

  await runSelected();
});

program.parseAsync(process.argv).catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(msg);
  process.exit(1);
});
