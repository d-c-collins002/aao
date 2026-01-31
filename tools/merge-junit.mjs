import fs from "node:fs";
import path from "node:path";

const resultsDir = path.join(process.cwd(), "apps/web/test-results");
const vitestPath = path.join(resultsDir, "vitest-junit.xml");
const pwPath = path.join(resultsDir, "junit.xml");
const outPath = path.join(resultsDir, "junit-combined.xml");

function readIfExists(p) {
  try { return fs.readFileSync(p, "utf8"); } catch { return ""; }
}

const vitestXml = readIfExists(vitestPath);
const pwXml = readIfExists(pwPath);

function extractSuites(xml) {
  if (!xml) return "";
  // Strip XML declaration
  xml = xml.replace(/^<\?xml[^>]*>\s*/i, "");
  // Prefer extracting <testsuite ...>...</testsuite> chunks
  const suites = [];
  const re = /<testsuite\b[\s\S]*?<\/testsuite>/gi;
  let m;
  while ((m = re.exec(xml)) !== null) suites.push(m[0]);
  if (suites.length) return suites.join("\n");
  // If the file is already <testsuites>...</testsuites>, strip wrapper
  const inner = xml.match(/<testsuites\b[^>]*>([\s\S]*)<\/testsuites>/i);
  if (inner) return inner[1].trim();
  return xml.trim();
}

const combinedSuites = [extractSuites(vitestXml), extractSuites(pwXml)].filter(Boolean).join("\n");

if (!combinedSuites) {
  console.error(`[merge-junit] No JUnit input found at:\n- ${vitestPath}\n- ${pwPath}`);
  process.exit(1);
}

const combinedXml = `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites>\n${combinedSuites}\n</testsuites>\n`;
fs.mkdirSync(resultsDir, { recursive: true });
fs.writeFileSync(outPath, combinedXml, "utf8");
console.error(`[merge-junit] Wrote combined JUnit: ${outPath}`);
