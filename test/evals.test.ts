import assert from "node:assert/strict";
import test from "node:test";
import { checkBehavior, compareRows } from "../src/evals/grade";
import type { AgentComplete } from "../src/core/agent/loop";
import type { AgentCase } from "../src/evals/types";

const rows = (data: Record<string, unknown>[]) => ({
  columns: Object.keys(data[0] ?? {}),
  rows: data,
});

// ---- compareRows -------------------------------------------------------------

test("compareRows ignores column names — a rename is still the right answer", () => {
  const expected = rows([{ plan: "paid", sum_amount: 285.74 }]);
  const actual = rows([{ plan: "paid", total: 285.74 }]);
  assert.equal(compareRows(expected, actual).equal, true);
});

test("compareRows ignores column order", () => {
  const expected = rows([{ plan: "paid", total: 10 }]);
  const actual = rows([{ total: 10, plan: "paid" }]);
  assert.equal(compareRows(expected, actual).equal, true);
});

test("compareRows ignores row order by default, honors it when asked", () => {
  const expected = rows([{ n: 1 }, { n: 2 }]);
  const actual = rows([{ n: 2 }, { n: 1 }]);
  assert.equal(compareRows(expected, actual).equal, true);
  assert.equal(compareRows(expected, actual, { orderSensitive: true }).equal, false);
});

test("compareRows treats BigInt and Number as equal (DuckDB COUNT returns BigInt)", () => {
  assert.equal(compareRows(rows([{ n: 4 }]), rows([{ n: 4n }])).equal, true);
});

test("compareRows unwraps Decimal-like objects and numeric strings", () => {
  const decimal = { valueOf: () => 4750 };
  assert.equal(compareRows(rows([{ r: 4750 }]), rows([{ r: decimal }])).equal, true);
  assert.equal(compareRows(rows([{ r: 4750 }]), rows([{ r: "4750" }])).equal, true);
});

test("compareRows tolerates float rounding but not real differences", () => {
  assert.equal(compareRows(rows([{ r: 1 / 3 }]), rows([{ r: 0.3333333333333 }])).equal, true);
  assert.equal(compareRows(rows([{ r: 4750 }]), rows([{ r: 4750.5 }])).equal, false);
});

test("compareRows catches the fan-out trap (right shape, wrong number)", () => {
  const result = compareRows(rows([{ revenue: 4750 }]), rows([{ revenue: 8400 }]));
  assert.equal(result.equal, false);
  assert.match(result.detail, /8400/);
  assert.match(result.detail, /4750/);
});

test("compareRows reports row- and column-count mismatches", () => {
  assert.match(compareRows(rows([{ n: 1 }]), rows([{ n: 1 }, { n: 2 }])).detail, /row count 2/);
  assert.match(
    compareRows(rows([{ a: 1, b: 2 }]), rows([{ a: 1 }])).detail,
    /column count 1/
  );
});

test("compareRows distinguishes NULL from a value", () => {
  assert.equal(compareRows(rows([{ n: null }]), rows([{ n: 0 }])).equal, false);
  assert.equal(compareRows(rows([{ n: null }]), rows([{ n: null }])).equal, true);
});

test("compareRows fails when the agent produced nothing", () => {
  const result = compareRows(rows([{ n: 1 }]), null);
  assert.equal(result.equal, false);
  assert.match(result.detail, /no result rows/);
});

test("compareRows treats two empty result sets as equal", () => {
  assert.equal(compareRows({ columns: [], rows: [] }, { columns: [], rows: [] }).equal, true);
});

// ---- checkBehavior -----------------------------------------------------------

const base: AgentCase = { id: "c", question: "q", expectedSql: "SELECT 1" };

test("checkBehavior enforces required and forbidden tools", () => {
  assert.deepEqual(
    checkBehavior({ ...base, mustUseTool: ["query_metric"] }, ["run_sql"], 1),
    ["did not use query_metric"]
  );
  assert.deepEqual(
    checkBehavior({ ...base, mustNotUseTool: ["run_sql"] }, ["run_sql"], 1),
    ["used run_sql"]
  );
  assert.deepEqual(
    checkBehavior({ ...base, mustUseTool: ["query_metric"] }, ["query_metric"], 1),
    []
  );
});

test("checkBehavior enforces a step budget", () => {
  assert.deepEqual(checkBehavior({ ...base, maxSteps: 3 }, [], 3), []);
  assert.deepEqual(checkBehavior({ ...base, maxSteps: 3 }, [], 5), [
    "took 5 steps, budget 3",
  ]);
});

test("checkBehavior reports every violation, not just the first", () => {
  const failures = checkBehavior(
    { ...base, mustUseTool: ["query_metric"], mustNotUseTool: ["run_sql"], maxSteps: 1 },
    ["run_sql"],
    9
  );
  assert.equal(failures.length, 3);
});

// ---- engine suite (deterministic, no API key) --------------------------------

test("engine suite scores the committed eval dataset", async () => {
  const { runEngineSuite } = await import("../src/evals/run-engine");
  const report = await runEngineSuite();

  assert.equal(report.suite, "engine");
  assert.ok(report.total >= 15, "expected a meaningful number of cases");
  assert.equal(report.errored, 0, JSON.stringify(report.results.filter((r) => r.outcome === "error")));
  assert.equal(
    report.failed,
    0,
    `engine regressions: ${report.results
      .filter((r) => r.outcome === "fail")
      .map((r) => `${r.id}: ${r.detail}`)
      .join(" | ")}`
  );
  assert.equal(report.score, 1);
});

// ---- agent suite plumbing (scripted agent, no API calls) ---------------------

/**
 * A scripted `complete` that calls run_sql once with the given SQL, then
 * answers — enough to drive the whole suite without a model.
 */
function scriptedAgent(sqlFor: (question: string) => string | null): AgentComplete {
  return async ({ messages }) => {
    const first = messages[0]?.content;
    const question = typeof first === "string" ? first : "";
    const alreadyRan = messages.length > 1;
    const sql = sqlFor(question);
    if (alreadyRan || sql === null) {
      return { stopReason: "end_turn", content: [{ type: "text", text: "done" }] };
    }
    return {
      stopReason: "tool_use",
      content: [{ type: "tool_use", id: "t1", name: "run_sql", input: { query: sql } }],
    };
  };
}

test("agent suite passes a case when the scripted agent runs the right SQL", async () => {
  const { runAgentSuite } = await import("../src/evals/run-agent");
  const report = await runAgentSuite({
    only: ["simple-count"],
    complete: scriptedAgent(() => "SELECT COUNT(*) AS total FROM customers"),
  });

  assert.equal(report.total, 1);
  assert.equal(report.passed, 1, report.results[0].detail);
  // Column renamed (total vs n) and it still passes — grading is value-based.
  assert.deepEqual(report.results[0].toolsUsed, ["run_sql"]);
  assert.equal(report.results[0].selfCorrections, 0);
});

test("agent suite fails a case when the answer is wrong", async () => {
  const { runAgentSuite } = await import("../src/evals/run-agent");
  const report = await runAgentSuite({
    only: ["revenue-total"],
    // The fan-out mistake: joining through support_tickets inflates revenue.
    complete: scriptedAgent(
      () =>
        "SELECT ROUND(SUM(oi.quantity*p.unit_price),2) AS revenue FROM order_items oi " +
        "JOIN products p ON oi.product_id=p.id JOIN orders o ON oi.order_id=o.id " +
        "JOIN support_tickets t ON t.customer_id=o.customer_id"
    ),
  });

  assert.equal(report.passed, 0);
  assert.equal(report.failed, 1);
  assert.equal(report.score, 0);
  assert.match(report.results[0].detail, /12650|9050/);
});

test("agent suite records an error when the agent produces no rows", async () => {
  const { runAgentSuite } = await import("../src/evals/run-agent");
  const report = await runAgentSuite({
    only: ["simple-count"],
    complete: scriptedAgent(() => null), // answers without ever querying
  });

  assert.equal(report.failed, 1);
  assert.match(report.results[0].detail, /no result rows/);
});

test("agent suite honors --cases filtering and rejects an unknown id", async () => {
  const { runAgentSuite } = await import("../src/evals/run-agent");
  const report = await runAgentSuite({
    only: ["simple-count", "distinct-customers-ordered"],
    complete: scriptedAgent((q) =>
      /distinct/i.test(q)
        ? "SELECT COUNT(DISTINCT customer_id) AS n FROM orders"
        : "SELECT COUNT(*) AS n FROM customers"
    ),
  });
  assert.equal(report.total, 2);
  assert.equal(report.passed, 2, JSON.stringify(report.results));

  await assert.rejects(
    () => runAgentSuite({ only: ["does-not-exist"], complete: scriptedAgent(() => null) }),
    /No matching eval cases/
  );
});

test("agent suite --repeat fails the case if any run fails", async () => {
  const { runAgentSuite } = await import("../src/evals/run-agent");
  let call = 0;
  const report = await runAgentSuite({
    only: ["simple-count"],
    repeat: 3,
    // verify off: this test exercises --repeat plumbing, and keying the wrong run
    // off the call counter needs a fixed two calls per run (tool + finalize).
    verify: false,
    complete: scriptedAgent(() => {
      call += 1;
      // Correct on runs 1 and 3, wrong on run 2 — models are not deterministic.
      return call === 3
        ? "SELECT COUNT(*) + 1 AS n FROM customers"
        : "SELECT COUNT(*) AS n FROM customers";
    }),
  });

  assert.equal(report.failed, 1);
  assert.match(report.results[0].detail, /runs failed/);
});
