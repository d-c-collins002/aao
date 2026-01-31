import path from "node:path";
import { loadConfig } from "../lib/config.js";
import { validateConfig } from "../lib/validateConfig.js";
import { basicAuth, fetchJson, postJsonText } from "../lib/http.js";
import { getAgiletestBases, getAgiletestJwt } from "../lib/agiletestAuth.js";

type ExpandOpts = {
  testPlanKeys?: string; // space-separated (e.g. "SWIM-64 SWIM-66")
};

type JiraIssue = { id: string; key: string };

type AgileTestPlan = {
  id: number;
  issueId: string;     // Jira issue id (numeric) as string
  projectId: string;   // AgileTest projectId as string
};

type AgileTestPlanCase = {
  id?: number;
  issueId: string;     // Jira issue id (numeric) as string
};

function asNonEmptyString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s.length ? s : null;
}

function splitKeys(raw: string): string[] {
  return raw
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function expandAgiletestPlan(opts: ExpandOpts): Promise<string[]> {
  const cfg = loadConfig();
  validateConfig(cfg);

  // Narrow after validateConfig (runtime contract: these exist if validateConfig passed)
  const producers = cfg.producers!;
  const jira = producers.jira!;
  const at = producers.agiletest!;

  const planKeysRaw =
    opts.testPlanKeys ?? String(at["test-plan-keys"] ?? "").trim();

  const planKeys = splitKeys(planKeysRaw);

  if (planKeys.length === 0) {
    console.log("expand-agiletest-plan: no test plan keys provided");
    return [];
  }

  const jiraBase = String(jira["base-url"] ?? "").trim();
  const jiraAuth = basicAuth(String(jira.email ?? ""), String(jira["api-token"] ?? ""));

  const atBase = String(at["auth-base-url"] ?? "").trim();
  const atProjectId = asNonEmptyString(at["project-id"]);
  const clientId = asNonEmptyString(at["client-id"]);
  const clientSecret = asNonEmptyString(at["client-secret"]);

  if (!atProjectId) {
    throw new Error("Missing producers.agiletest.project-id");
  }
  if (!clientId || !clientSecret) {
    throw new Error(
      "AgileTest auth not configured. Missing producers.agiletest.client-id and/or producers.agiletest.client-secret."
    );
  }

  async function jiraIssueByKey(key: string): Promise<JiraIssue> {
    const u = new URL(path.posix.join("/rest/api/3/issue", key), jiraBase);
    u.searchParams.set("fields", "id,key");
    return await fetchJson<JiraIssue>(u.toString(), {
      headers: { Authorization: jiraAuth, Accept: "application/json" },
    });
  }

  async function jiraKeyForIssueId(issueId: string): Promise<string> {
    const u = new URL(path.posix.join("/rest/api/3/issue", issueId), jiraBase);
    u.searchParams.set("fields", "key");
    const data = await fetchJson<{ key: string }>(u.toString(), {
      headers: { Authorization: jiraAuth, Accept: "application/json" },
    });
    return data.key;
  }

  // 1) Resolve Jira keys (SWIM-64) -> Jira numeric issue ids (strings)
  const planIssueIds: string[] = [];
  for (const key of planKeys) {
    const issue = await jiraIssueByKey(key);
    const id = asNonEmptyString(issue.id);
    if (!id) throw new Error(`Jira issue ${key} did not return an id`);
    planIssueIds.push(id);
  }

  if (planIssueIds.length === 0) {
    throw new Error(`No Jira issue ids resolved for plan keys: ${planKeys.join(" ")}`);
  }

  // 2) Authenticate to AgileTest: returns RAW JWT STRING (not JSON)
  const jwt = await getAgiletestJwt(cfg);
  if (!jwt) throw new Error("AgileTest authenticate returned an empty token");

  const atHeaders = {
    Authorization: `JWT ${jwt}`,
    Accept: "application/json",
  };

  // 3) Bulk lookup: test plans by Jira issue ids
  async function agileFetchPlansByIssueIds(issueIds: string[]): Promise<AgileTestPlan[]> {
    const url = new URL("/ds/test-plans/issue/bulk", atBase).toString();

    // AgileTest validates these strictly
    const body = {
      projectId: String(atProjectId),
      testPlanIssueIds: issueIds.map(String),
    };

    return await fetchJson<AgileTestPlan[]>(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...atHeaders,
      },
      body: JSON.stringify(body),
    });
  }

  // 4) For each plan, fetch cases
  async function agileFetchCases(planId: number): Promise<AgileTestPlanCase[]> {
    const u = new URL(path.posix.join("/ds/test-plans", String(planId), "test-cases"), atBase);
    u.searchParams.set("projectId", String(atProjectId));
    return await fetchJson<AgileTestPlanCase[]>(u.toString(), {
      headers: { ...atHeaders },
    });
  }

  const plans = await agileFetchPlansByIssueIds(planIssueIds);

  // If AgileTest returns nothing, surface a strong hint
  if (!plans || plans.length === 0) {
    // eslint-disable-next-line no-console
    console.log(
      `expand-agiletest-plan: no AgileTest plans matched Jira issue ids: ${planIssueIds.join(", ")}`
    );
    return [];
  }

  const allTestCaseIssueIds: string[] = [];

  for (const p of plans) {
    const cases = await agileFetchCases(p.id);
    // eslint-disable-next-line no-console
    console.log(
      `expand-agiletest-plan: plan issueId=${p.issueId} (AgileTest id=${p.id}) has ${cases.length} test cases`
    );

    for (const c of cases) {
      const id = asNonEmptyString(c.issueId);
      if (id) allTestCaseIssueIds.push(id);
    }
  }

  // 5) Map test case Jira issue ids -> keys (TC-xxx, etc)
  const uniqueIssueIds = Array.from(new Set(allTestCaseIssueIds));

  
  const keys: string[] = [];

  for (const issueId of uniqueIssueIds) {
    const k = await jiraKeyForIssueId(issueId);
    keys.push(k);
  }

  return Array.from(new Set(keys));
}
