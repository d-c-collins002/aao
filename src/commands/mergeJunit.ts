import fs from "node:fs";
import path from "node:path";
import { XMLParser, XMLBuilder } from "fast-xml-parser";

type MergeJunitOpts = {
  resultsDir: string;
  outFile: string;
};

function walk(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      files.push(...walk(p));
    } else if (e.isFile() && e.name.toLowerCase().endsWith(".xml")) {
      files.push(p);
    }
  }

  return files;
}

export async function mergeJunit(opts: MergeJunitOpts): Promise<void> {
  const { resultsDir, outFile } = opts;
  const outPath = path.join(resultsDir, outFile);

  const xmlFiles = walk(resultsDir)
    .filter((p) => path.resolve(p) !== path.resolve(outPath));

  if (xmlFiles.length === 0) {
    throw new Error(`No JUnit XML files found under ${resultsDir}`);
  }

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "",
  });

  const builder = new XMLBuilder({
    ignoreAttributes: false,
    attributeNamePrefix: "",
  });

  const suites: any[] = [];

  for (const file of xmlFiles) {
    const xml = fs.readFileSync(file, "utf8");
    const doc = parser.parse(xml);

    if (doc.testsuites?.testsuite) {
      const arr = Array.isArray(doc.testsuites.testsuite)
        ? doc.testsuites.testsuite
        : [doc.testsuites.testsuite];
      suites.push(...arr);
    } else if (doc.testsuite) {
      suites.push(doc.testsuite);
    }
  }

  const merged = {
    testsuites: {
      testsuite: suites,
    },
  };

  fs.writeFileSync(outPath, builder.build(merged), "utf8");
}
