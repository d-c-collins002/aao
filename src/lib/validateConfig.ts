import type {
  AaoConfig,
  AgiletestProducerConfig,
  JiraProducerConfig,
  SonarConsumerConfig,
  EnvMap,
} from "./config.js";

export type AaoConfigValidated = AaoConfig & {
  producers: {
    agiletest: AgiletestProducerConfig;
    jira: JiraProducerConfig;
  };
  consumers?: {
    sonar?: SonarConsumerConfig & { env: EnvMap };
  };
};

export function validateConfig(cfg: AaoConfig): void {
  const missing: string[] = [];

  if (!cfg.project?.["project-root"]) missing.push("project.project-root");
  if (!cfg.project?.["test-root"]) missing.push("project.test-root");
  if (!cfg.project?.["results-dir"]) missing.push("project.results-dir");
  if (!cfg.project?.["coverage-dir"]) missing.push("project.coverage-dir");

  const at = cfg.producers?.agiletest;
  if (!at?.["auth-base-url"]) missing.push("producers.agiletest.auth-base-url");
  if (!at?.["submit-base-url"]) missing.push("producers.agiletest.submit-base-url");
  if (!at?.["project-id"]) missing.push("producers.agiletest.project-id");
  if (!at?.["client-id"]) missing.push("producers.agiletest.client-id");
  if (!at?.["client-secret"]) missing.push("producers.agiletest.client-secret");
  if (!at?.timezone) missing.push("producers.agiletest.timezone");

  const jira = cfg.producers?.jira;
  if (!jira?.["base-url"]) missing.push("producers.jira.base-url");
  if (!jira?.email) missing.push("producers.jira.email");
  if (!jira?.["api-token"]) missing.push("producers.jira.api-token");

  if (!cfg.executors || Object.keys(cfg.executors).length === 0) missing.push("executors");

  const sonar = cfg.consumers?.sonar;
  const enabled = Boolean(sonar?.enabled);
  if (enabled) {
    if (!sonar?.["host-url"]) missing.push("consumers.sonar.host-url");
    if (!sonar?.["project-key"]) missing.push("consumers.sonar.project-key");
    if (!sonar?.token) missing.push("consumers.sonar.token");
    if (!sonar?.cmd) missing.push("consumers.sonar.cmd");
    if (!sonar?.env) missing.push("consumers.sonar.env");
  }

  if (missing.length) {
    throw new Error(`AAO config validation failed. Missing required value(s): ${missing.join(", ")}`);
  }
}
