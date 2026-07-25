import assert from "node:assert/strict";
import test from "node:test";
import { isReadOnlyQuery, stripSqlFences } from "../src/core/discovery/sql-safety";
import { buildAskContext } from "../src/core/agent/ask-context";
import { parseFollowups, runAsk, type AskAi } from "../src/adapters/cli/ask";
import { resolveSource } from "../src/adapters/cli/source";
import {
  buildVerificationTurn,
  VERIFICATION_PROMPT,
  type AgentComplete,
} from "../src/core/agent/loop";
import type { ToolCompletion } from "../src/ai/complete";
import type { Relationship } from "../src/core/types/discovery";

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
    source: resolveSource({ folder: "fixtures/data" }),
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
      source: resolveSource({ folder: "fixtures/data" }),
      ai: stubAi("DROP TABLE users"),
      log: () => {},
    }),
    /non-read-only/
  );
});

test("runAsk --show-sql returns SQL without executing", async () => {
  const result = await runAsk({
    question: "anything",
    source: resolveSource({ folder: "fixtures/data" }),
    showSql: true,
    ai: stubAi("```sql\nSELECT 1\n```"),
    log: () => {},
  });
  assert.equal(result.sql, "SELECT 1");
  assert.equal(result.result, null);
  assert.equal(result.insight, null);
  assert.equal(result.followups, null);
});

// ---- Follow-up suggestions -----------------------------------------------------

test("parseFollowups strips bullets/numbering, trims, and caps at 3", () => {
  const raw = "1. What is 7-day retention?\n- Which plan churns most?\n* Top spenders?\n\n4) Extra";
  assert.deepEqual(parseFollowups(raw), [
    "What is 7-day retention?",
    "Which plan churns most?",
    "Top spenders?",
  ]);
  assert.deepEqual(parseFollowups("   \n  \n"), []);
});

test("runAsk emits follow-up questions when the AI provides them", async () => {
  const lines: string[] = [];
  const followups = ["What is 7-day retention?", "Which plan churns most?"];
  const result = await runAsk({
    question: "total payment amount by user plan",
    source: resolveSource({ folder: "fixtures/data" }),
    ai: {
      ...stubAi(JOIN_SQL),
      generateFollowups: async () => followups,
    },
    log: (line) => lines.push(line),
  });
  assert.deepEqual(result.followups, followups);
  const out = lines.join("\n");
  assert.ok(out.includes("Follow-up questions:"));
  assert.ok(out.includes("1. What is 7-day retention?"));
});

// ---- Agentic loop (scripted model, real DuckDB runner, no network) -------------

function toolUse(id: string, name: string, input: Record<string, unknown>): ToolCompletion {
  return { stopReason: "tool_use", content: [{ type: "tool_use", id, name, input }] };
}

function textReply(text: string): ToolCompletion {
  return { stopReason: "end_turn", content: [{ type: "text", text }] };
}

/** Replay a fixed script of model turns; the loop drives real tool execution. */
function scriptedAgent(script: ToolCompletion[]): AgentComplete {
  let i = 0;
  return async () => script[Math.min(i++, script.length - 1)];
}

function agentAi(script: ToolCompletion[], extra?: Partial<AskAi>): AskAi {
  return {
    generateSql: async () => {
      throw new Error("generateSql must not be called in agent mode");
    },
    generateInsight: async () => {
      throw new Error("generateInsight must not be called in agent mode");
    },
    agentComplete: scriptedAgent(script),
    ...extra,
  };
}

test("agent loop self-corrects a failing query, then converges on the answer", async () => {
  const lines: string[] = [];
  const result = await runAsk({
    question: "total payment amount by user plan",
    source: resolveSource({ folder: "fixtures/data" }),
    ai: agentAi([
      toolUse("t1", "run_sql", { query: "SELECT nonexistent_col FROM users" }),
      toolUse("t2", "run_sql", { query: JOIN_SQL }),
      textReply("All payments come from paid-plan users."),
    ]),
    log: (line) => lines.push(line),
  });

  // Both attempts were recorded; the first failed, the second succeeded.
  assert.deepEqual(result.agent?.sqlHistory, [
    "SELECT nonexistent_col FROM users",
    JOIN_SQL,
  ]);
  assert.equal(result.agent?.steps[0].isError, true);
  assert.equal(result.agent?.steps[1].isError, false);

  // Final grounded answer surfaces through insight + the last result table.
  assert.equal(result.insight, "All payments come from paid-plan users.");
  assert.equal(result.agent?.answer, "All payments come from paid-plan users.");
  assert.deepEqual(result.result?.columns, ["plan", "payment_count", "total"]);
  assert.equal(result.result?.rows.length, 1);
  assert.equal(String(result.result?.rows[0].plan), "paid");
  assert.equal(Number(result.result?.rows[0].payment_count), 8);

  const out = lines.join("\n");
  assert.ok(out.includes("-- SQL"));
  assert.ok(out.includes("Insight:"));
});

test("agent computes a defined metric via query_metric (guarded join, real DuckDB)", async () => {
  const result = await runAsk({
    question: "total amount by plan",
    source: resolveSource({ folder: "fixtures/data" }),
    ai: agentAi([
      toolUse("m1", "query_metric", { metric: "sum_amount", dimensions: ["plan"] }),
      textReply("Paid-plan users account for all payment volume."),
    ]),
    log: () => {},
  });

  assert.equal(result.insight, "Paid-plan users account for all payment volume.");
  // The compiler emitted and ran a guarded SUM join, captured in the SQL trail.
  assert.ok(result.agent?.sqlHistory.some((s) => /SUM\("payments"\."amount"\)/.test(s)));
  assert.ok(result.result && result.result.rows.length >= 1);
  assert.ok(result.result.columns.includes("plan"));
  assert.ok(result.result.columns.includes("sum_amount"));
});

test("agent resolves a term to schema via resolve_terms (lexical fallback)", async () => {
  const result = await runAsk({
    question: "what about plan",
    source: resolveSource({ folder: "fixtures/data" }),
    ai: agentAi([
      toolUse("r1", "resolve_terms", { query: "plan" }),
      textReply("Resolved."),
    ]),
    log: () => {},
  });
  const step = result.agent?.steps.find((s) => s.tool === "resolve_terms");
  assert.ok(step, "resolve_terms step present");
  assert.match(step!.output, /plan.*users\.plan/);
});

test("agent loop refuses non-read-only SQL and never executes it", async () => {
  const result = await runAsk({
    question: "delete everything",
    source: resolveSource({ folder: "fixtures/data" }),
    ai: agentAi([
      toolUse("t1", "run_sql", { query: "DROP TABLE users" }),
      textReply("I cannot modify the data; it is read-only."),
    ]),
    log: () => {},
  });

  assert.deepEqual(result.agent?.sqlHistory, ["DROP TABLE users"]);
  assert.match(result.agent?.steps[0].output ?? "", /read-only/i);
  // Refused query produced no result rows.
  assert.equal(result.result, null);
});

test("agent mode is skipped when the AI has no agentComplete (single-shot fallback)", async () => {
  const result = await runAsk({
    question: "total payment amount by user plan",
    source: resolveSource({ folder: "fixtures/data" }),
    ai: stubAi(JOIN_SQL),
    log: () => {},
  });
  assert.equal(result.agent, null);
  assert.equal(result.result?.rows.length, 1);
});

// ---- Verification pass (self-critique before answering) -----------------------

const OVER_PROJECTED = "SELECT plan, COUNT(*) AS n, MIN(id) AS extra FROM users GROUP BY plan";
const RIGHT_SHAPE = "SELECT plan, COUNT(*) AS n FROM users GROUP BY plan";

test("verify sends an over-projected answer back and accepts the corrected shape", async () => {
  const result = await runAsk({
    question: "how many users are on each plan",
    source: resolveSource({ folder: "fixtures/data" }),
    // verify defaults on: the model finalizes a 3-column result, the checklist
    // sends it back, and it re-runs with the 2-column shape the question asked for.
    ai: agentAi([
      toolUse("t1", "run_sql", { query: OVER_PROJECTED }),
      textReply("Here is the breakdown by plan."),
      toolUse("t2", "run_sql", { query: RIGHT_SHAPE }),
      textReply("Users per plan."),
    ]),
    log: () => {},
  });

  // Both queries ran — proof the verify turn drove a correction, not just a restate.
  assert.deepEqual(result.agent?.sqlHistory, [OVER_PROJECTED, RIGHT_SHAPE]);
  assert.equal(result.result?.columns.length, 2);
  assert.equal(result.agent?.answer, "Users per plan.");
});

test("verify leaves a correct answer intact and adds no tool step", async () => {
  const result = await runAsk({
    question: "how many users are on each plan",
    source: resolveSource({ folder: "fixtures/data" }),
    ai: agentAi([
      toolUse("t1", "run_sql", { query: RIGHT_SHAPE }),
      textReply("Users per plan."),
      // If verify wrongly re-ran a tool, this would fire; the restate above wins.
      textReply("Users per plan."),
    ]),
    log: () => {},
  });

  assert.deepEqual(result.agent?.sqlHistory, [RIGHT_SHAPE]);
  assert.equal(result.agent?.steps.length, 1);
  assert.equal(result.agent?.answer, "Users per plan.");
});

test("verify off returns on first finalization (no self-critique turn)", async () => {
  const result = await runAsk({
    question: "how many users are on each plan",
    source: resolveSource({ folder: "fixtures/data" }),
    verify: false,
    ai: agentAi([
      toolUse("t1", "run_sql", { query: RIGHT_SHAPE }),
      textReply("Users per plan."),
      // Reached only if a verify turn fired — it must not.
      toolUse("t2", "run_sql", { query: OVER_PROJECTED }),
    ]),
    log: () => {},
  });

  assert.deepEqual(result.agent?.sqlHistory, [RIGHT_SHAPE]);
  assert.equal(result.result?.columns.length, 2);
});

test("buildVerificationTurn adds a safety note only for data-modification questions", () => {
  const safe = buildVerificationTurn("Delete every starter-plan customer, then tell me how many remain.");
  assert.ok(safe.includes("data-modification"));
  assert.ok(safe.includes(VERIFICATION_PROMPT));

  const plain = buildVerificationTurn("How many customers are there?");
  assert.equal(plain, VERIFICATION_PROMPT);

  // The checklist always carries the projection and ranking checks.
  assert.ok(plain.includes("Projection"));
  assert.ok(plain.includes("Ranking"));
});
