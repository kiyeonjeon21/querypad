import assert from "node:assert/strict";
import test from "node:test";
import { isReadOnlyQuery, stripSqlFences } from "../src/lib/discovery/sql-safety";
import { buildAskContext } from "../src/lib/agent/ask-context";
import { runAsk, type AskAi } from "../src/cli/ask";
import type { Relationship } from "../src/types/discovery";

const REL: Relationship = {
  from: { table: "payments", column: "user_id" },
  to: { table: "users", column: "id" },
  confidence: 100,
  cardinality: "many-to-one",
  signals: { valueOverlap: 1, nameSimilarity: 1, typeMatch: 1, cardinalityShape: 1 },
};

// ---- Pure safety unit tests ---------------------------------------------------

test("stripSqlFences removes ```sql fences and bare fences", () => {
  assert.equal(stripSqlFences("```sql\nSELECT 1\n```"), "SELECT 1");
  assert.equal(stripSqlFences("```\nSELECT 1\n```"), "SELECT 1");
  assert.equal(stripSqlFences("  SELECT 1  "), "SELECT 1");
});

test("isReadOnlyQuery allows reads and rejects writes/DDL", () => {
  assert.ok(isReadOnlyQuery("SELECT * FROM users"));
  assert.ok(isReadOnlyQuery("WITH t AS (SELECT 1) SELECT * FROM t"));
  assert.ok(isReadOnlyQuery("```sql\nSELECT 1\n```"));
  for (const bad of [
    "DROP TABLE users",
    "DELETE FROM users",
    "UPDATE users SET x = 1",
    "INSERT INTO users VALUES (1)",
    "ALTER TABLE users ADD c INT",
    "CREATE TABLE t (a INT)",
    "ATTACH 'x.db'",
    "COPY users TO 'x.csv'",
  ]) {
    assert.ok(!isReadOnlyQuery(bad), `should reject: ${bad}`);
  }
});

test("isReadOnlyQuery cannot be bypassed with a leading comment", () => {
  assert.ok(!isReadOnlyQuery("-- harmless\nDROP TABLE users"));
  assert.ok(!isReadOnlyQuery("/* c */ DELETE FROM users"));
});

test("buildAskContext includes the inferred relationship lines", () => {
  const context = buildAskContext({
    tables: [
      { name: "users", columns: [{ name: "id", type: "BIGINT" }], rowCount: 5 },
      {
        name: "payments",
        columns: [
          { name: "id", type: "BIGINT" },
          { name: "user_id", type: "BIGINT" },
        ],
        rowCount: 8,
      },
    ],
    relationships: [REL],
  });
  assert.match(context, /Known relationships/);
  assert.match(context, /payments\.user_id -> users\.id/);
});

// ---- Pipeline integration with a stubbed AI (no network) ----------------------

const JOIN_SQL =
  "SELECT u.plan, COUNT(*) AS payment_count, CAST(SUM(p.amount) AS DOUBLE) AS total " +
  "FROM payments p JOIN users u ON p.user_id = u.id GROUP BY u.plan ORDER BY u.plan";

function stubAi(sql: string): AskAi {
  return {
    generateSql: async () => sql,
    generateInsight: async () => "All payments come from paid-plan users.",
  };
}

test("runAsk executes generated SQL over fixtures and returns results", async () => {
  const lines: string[] = [];
  const result = await runAsk({
    question: "total payment amount by user plan",
    folder: "fixtures/data",
    // Fenced to also exercise stripSqlFences end-to-end.
    ai: stubAi("```sql\n" + JOIN_SQL + "\n```"),
    log: (line) => lines.push(line),
  });

  assert.deepEqual(result.result?.columns, ["plan", "payment_count", "total"]);
  assert.equal(result.result?.rows.length, 1);
  const row = result.result!.rows[0];
  assert.equal(String(row.plan), "paid");
  assert.equal(Number(row.payment_count), 8);
  assert.ok(Math.abs(Number(row.total) - 285.74) < 0.01);
  assert.equal(result.insight, "All payments come from paid-plan users.");
  assert.ok(lines.join("\n").includes("Insight:"));
});

test("runAsk refuses to execute non-read-only generated SQL", async () => {
  await assert.rejects(
    runAsk({
      question: "delete everything",
      folder: "fixtures/data",
      ai: stubAi("DROP TABLE users"),
      log: () => {},
    }),
    /non-read-only/
  );
});

test("runAsk --show-sql returns SQL without executing", async () => {
  const result = await runAsk({
    question: "anything",
    folder: "fixtures/data",
    showSql: true,
    ai: stubAi("```sql\nSELECT 1\n```"),
    log: () => {},
  });
  assert.equal(result.sql, "SELECT 1");
  assert.equal(result.result, null);
  assert.equal(result.insight, null);
});
