import assert from "node:assert/strict";
import test from "node:test";
import { checkBehavior, compareRows } from "../src/evals/grade";
import type { AgentComplete } from "../src/core/agent/loop";
import type { AgentCase } from "../src/evals/types";

async function tempJson(name: string, data: unknown): Promise<string> {
  const { mkdtemp, writeFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const path = await import("node:path");
  const dir = await mkdtemp(path.join(tmpdir(), "querypad-eval-"));
  const file = path.join(dir, name);
  await writeFile(file, JSON.stringify(data));
  return file;
}

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

// ---- A/B arms (scripted agent, no API calls) ---------------------------------

/** Wrap a scripted `complete` and record every {system, tools} it was handed. */
function spyComplete(inner: AgentComplete): {
  complete: AgentComplete;
  calls: { system: string; tools: string[] }[];
} {
  const calls: { system: string; tools: string[] }[] = [];
  return {
    calls,
    complete: async (input) => {
      calls.push({ system: input.system, tools: input.tools.map((t) => t.name) });
      return inner(input);
    },
  };
}

const COUNT_SQL = "SELECT COUNT(*) AS n FROM customers";

test("toolkit allowlist withholds tools without breaking the loop's contract", async () => {
  const { createDataToolkit, DATA_TOOL_DEFINITIONS } = await import("../src/core/agent/toolkit");
  const base = {
    tables: [],
    model: { generatedAt: 0, entities: [] },
    relationships: [],
    runner: async () => {
      throw new Error("runner must not be reached for a withheld tool");
    },
  };

  const gated = createDataToolkit({ ...base, only: ["run_sql"] });
  assert.deepEqual(
    gated.definitions.map((d) => d.name),
    ["run_sql"]
  );

  // Withheld tools resolve (never throw) and are flagged, so the suite records a
  // wrong answer rather than a harness error.
  const withheld = await gated.run("query_metric", { metric: "sum_amount" });
  assert.equal(withheld.isError, true);
  assert.match(withheld.text, /not available/);

  // The gate precedes execution: this would throw via the runner otherwise.
  const stillGated = createDataToolkit({ ...base, only: ["list_tables"] });
  const refused = await stillGated.run("run_sql", { query: "SELECT 1" });
  assert.equal(refused.isError, true);

  // A typo must fail loudly, not silently leave the agent with no tools.
  assert.throws(() => createDataToolkit({ ...base, only: ["run_sqll"] }), /Unknown tool name/);

  // No allowlist: the shipped toolkit, unchanged (guards the MCP surface).
  const full = createDataToolkit(base);
  assert.deepEqual(full.definitions, DATA_TOOL_DEFINITIONS);
});

test("the raw-sql arm gets one tool and no grounding; grounded gets both", async () => {
  const { runAgentSuite } = await import("../src/evals/run-agent");

  const control = spyComplete(scriptedAgent(() => COUNT_SQL));
  await runAgentSuite({
    only: ["simple-count"],
    arm: "raw-sql",
    complete: control.complete,
  });
  for (const call of control.calls) {
    assert.deepEqual(call.tools, ["run_sql"], "control must see exactly one tool");
    assert.doesNotMatch(call.system, /Known relationships/);
    assert.doesNotMatch(call.system, /Business entities/);
    assert.doesNotMatch(call.system, /describe_table/);
    // Safety wording is tool-mechanics parity, not grounding — it must stay.
    assert.match(call.system, /read-only/);
  }

  const grounded = spyComplete(scriptedAgent(() => COUNT_SQL));
  await runAgentSuite({
    only: ["simple-count"],
    arm: "grounded",
    complete: grounded.complete,
  });
  const first = grounded.calls[0];
  assert.equal(first.tools.length, 6);
  assert.match(first.system, /Known relationships/);
  assert.match(first.system, /Business entities/);
});

test("the grounded arm is byte-identical to the shipped default path", async () => {
  const { runAgentSuite } = await import("../src/evals/run-agent");

  const explicit = spyComplete(scriptedAgent(() => COUNT_SQL));
  await runAgentSuite({ only: ["simple-count"], arm: "grounded", complete: explicit.complete });

  const shipped = spyComplete(scriptedAgent(() => COUNT_SQL));
  await runAgentSuite({ only: ["simple-count"], complete: shipped.complete });

  // "Arm A is what ships" is a claim the A/B rests on, so assert it rather than
  // asserting it in prose: same prompt, same tools, no override anywhere.
  assert.deepEqual(explicit.calls, shipped.calls);
});

test("budget exhaustion is recorded rather than looking like a wrong answer", async () => {
  const { runAgentQuery } = await import("../src/core/agent/loop");
  const { createNodeDb } = await import("../src/engine/duckdb/connection");

  let calls = 0;
  const db = await createNodeDb();
  try {
    const result = await runAgentQuery({
      question: "never finishes",
      context: "",
      tables: [],
      model: { generatedAt: 0, entities: [] },
      relationships: [],
      runner: db.runner,
      maxSteps: 3,
      complete: async () => {
        calls += 1;
        return {
          stopReason: "tool_use",
          content: [{ type: "tool_use", id: `t${calls}`, name: "list_tables", input: {} }],
        };
      },
    });
    assert.equal(result.budgetExhausted, true);
    // maxSteps turns plus the one forced final answer.
    assert.equal(calls, 4);
  } finally {
    db.close();
  }
});

test("agent suite records per-run passes alongside the strict case outcome", async () => {
  const { runAgentSuite } = await import("../src/evals/run-agent");
  let call = 0;
  const report = await runAgentSuite({
    only: ["simple-count"],
    repeat: 3,
    verify: false,
    complete: scriptedAgent(() => {
      call += 1;
      // Two calls per run (tool, then finalize); call 3 is run 2's query.
      return call === 3 ? "SELECT COUNT(*) + 1 AS n FROM customers" : COUNT_SQL;
    }),
  });

  const [result] = report.results;
  assert.equal(result.outcome, "fail", "strict rule: any bad run fails the case");
  assert.equal(result.runsPassed, 2);
  assert.equal(result.runsTotal, 3);
  assert.equal(report.arm, "grounded");
  assert.equal(report.config?.repeat, 3);
  assert.equal(report.config?.verify, false);
});

test("behavioral assertions can be turned off, leaving accuracy-only grading", async () => {
  const { runAgentSuite } = await import("../src/evals/run-agent");
  // A right answer that overruns a 1-step budget: graded on the route, then not.
  const cases: AgentCase[] = [
    {
      id: "budgeted",
      question: "how many customers are there",
      expectedSql: "SELECT COUNT(*) AS n FROM customers",
      maxSteps: 0,
    },
  ];

  const graded = await runAgentSuite({
    cases,
    verify: false,
    complete: scriptedAgent(() => COUNT_SQL),
  });
  assert.equal(graded.passed, 0);
  assert.match(graded.results[0].detail, /steps/);

  const accuracyOnly = await runAgentSuite({
    cases,
    verify: false,
    behavioral: false,
    complete: scriptedAgent(() => COUNT_SQL),
  });
  assert.equal(accuracyOnly.passed, 1, accuracyOnly.results[0].detail);
});

test("runAbSuite measures both arms and formatComparison renders the delta", async () => {
  const { runAbSuite } = await import("../src/evals/run-agent");
  const { formatComparison } = await import("../src/evals/report");

  // The control answers correctly; the grounded arm does too. Equal arms are the
  // honest scripted outcome — what is asserted here is the plumbing and rendering.
  const { arms } = await runAbSuite({
    only: ["simple-count"],
    verify: false,
    complete: scriptedAgent(() => COUNT_SQL),
  });

  assert.equal(arms.length, 2);
  assert.deepEqual(
    arms.map((a) => a.arm),
    ["grounded", "raw-sql"]
  );
  // Behavioral assertions must be off for both, or the arms have different rubrics.
  for (const arm of arms) {
    assert.equal(arm.config?.behavioral, false);
    assert.equal(arm.errored, 0, JSON.stringify(arm.results));
  }
  // The control's exact preamble is stored so a reader can audit it.
  assert.doesNotMatch(String(arms[1].config?.systemPrompt), /Known relationships/);

  const out = formatComparison(arms[0], arms[1]);
  assert.match(out, /grounded/);
  assert.match(out, /raw-sql/);
  assert.match(out, /delta/);
  assert.match(out, /validity checks/);
  assert.match(out, /turn budget hit on 0\//);
});

// ---- dataset parameterization -------------------------------------------------

test("suites can score a different dataset, and record which one they scored", async () => {
  const { runEngineSuite } = await import("../src/evals/run-engine");

  const committed = await runEngineSuite();
  assert.equal(committed.dataset, "evals/dataset");
  assert.equal(committed.casesFile, "evals/cases/engine.json");
  assert.equal(committed.glossary, false);
  assert.equal(committed.score, 1, "the default pair must stay green");

  // Pointed at a different folder the same cases no longer hold, which is the
  // proof that datasetDir is actually honored rather than silently ignored.
  const elsewhere = await runEngineSuite({ datasetDir: "fixtures/data" });
  assert.equal(elsewhere.dataset, "fixtures/data");
  assert.ok(elsewhere.failed > 0, "eval cases should not pass against another dataset");
});

test("a scored glossary is recorded on the report and reaches the model", async () => {
  const { runAgentSuite } = await import("../src/evals/run-agent");
  const glossaryFile = await tempJson("glossary.json", {
    generatedAt: 1,
    entries: [
      {
        term: "revenue",
        definition: "Money billed.",
        synonyms: ["net revenue"],
        mapsTo: { table: "products", column: "unit_price" },
        confidence: 0.9,
      },
    ],
    applied: [],
  });

  const spy = spyComplete(scriptedAgent(() => COUNT_SQL));
  const report = await runAgentSuite({
    only: ["simple-count"],
    glossaryFile,
    complete: spy.complete,
  });

  assert.equal(report.glossary, true);
  assert.equal(report.dataset, "evals/dataset");
  // The glossary annotation must actually reach the grounding context the model saw.
  assert.match(spy.calls[0].system, /aka net revenue/);
});
