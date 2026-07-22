import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { buildExplanation } from "../src/core/discovery/explain";
import { runExplain } from "../src/adapters/cli/explain";
import type { Relationship, RelationshipSignals } from "../src/core/types/discovery";

function rel(
  fromTable: string,
  toTable: string,
  confidence: number,
  signals: Partial<RelationshipSignals> = {}
): Relationship {
  return {
    from: { table: fromTable, column: "user_id" },
    to: { table: toTable, column: "id" },
    confidence,
    cardinality: "many-to-one",
    signals: {
      valueOverlap: 1,
      nameSimilarity: 1,
      typeMatch: 1,
      cardinalityShape: 1,
      ...signals,
    },
  };
}

test("buildExplanation gives strong reasons and no caveats for a clean edge", () => {
  const report = buildExplanation([rel("payments", "users", 100)], ["payments", "users"]);
  assert.equal(report.relationships.length, 1);
  const reasons = report.relationships[0].reasons;
  assert.ok(reasons.some((r) => r.includes("100% of distinct payments.user_id")));
  assert.ok(reasons.includes("column name strongly matches the target"));
  assert.ok(reasons.includes("exact type match"));
  assert.ok(reasons.includes("many-to-one (target key is unique)"));
  assert.deepEqual(report.caveats, []);
});

test("buildExplanation flags low-confidence edges", () => {
  const report = buildExplanation([rel("payments", "users", 60)], ["payments", "users"]);
  assert.ok(report.caveats.some((c) => c.includes("low-confidence (60%)")));
});

test("buildExplanation flags high-overlap weak-name edges as coincidental", () => {
  const report = buildExplanation(
    [rel("payments", "events", 80, { nameSimilarity: 0.3, valueOverlap: 1 })],
    ["payments", "events"]
  );
  assert.ok(report.caveats.some((c) => c.includes("possibly coincidental")));
});

test("buildExplanation reports orphan tables", () => {
  const report = buildExplanation([rel("payments", "users", 100)], [
    "payments",
    "users",
    "logs",
  ]);
  assert.ok(report.caveats.some((c) => c.includes("no inferred relationships: logs")));
});

test("runExplain guides the user when artifacts are missing", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "querypad-explain-"));
  const lines: string[] = [];
  const code = await runExplain(dir, { log: (line) => lines.push(line) });
  assert.equal(code, 1);
  assert.ok(lines.join("\n").includes("querypad inspect"));
});
