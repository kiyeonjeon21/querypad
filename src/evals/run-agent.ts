import { readFile } from "node:fs/promises";
import path from "node:path";
import { completeWithTools } from "../ai/complete";
import { AGENT_SYSTEM_PROMPT, runAgentQuery, type AgentComplete } from "../core/agent/loop";
import { DATA_TOOL_DEFINITIONS } from "../core/agent/toolkit";
import type { QueryRunner } from "../core/discovery/relationships";
import { prepareDataset } from "../adapters/dataset";
import { resolveAiCredentials } from "../adapters/cli/ai-env";
import { createNodeDb } from "../engine/duckdb/connection";
import { ARMS, ARM_IDS, type ArmId } from "./arms";
import { checkBehavior, compareRows } from "./grade";
import { EVAL_DATASET, loadEvalDataset, type EvalDatasetOptions } from "./run-engine";
import type { AgentCase, CaseResult, SuiteConfig, SuiteReport } from "./types";

export const AGENT_CASES = "evals/cases/agent.json";

/** The loop's own default, mirrored here so a stored config is never blank. */
const DEFAULT_MAX_STEPS = 8;

/**
 * Turn budget for the A/B, raised above the default for **both** arms. The
 * control has to spend turns discovering the schema, and starving it would
 * measure our arbitrary ceiling instead of the grounding; raising it for one arm
 * only would introduce a second variable. `budgetExhausted` in the report proves
 * whether it ever bound.
 */
const AB_MAX_STEPS = 12;

export async function loadAgentCases(file = AGENT_CASES): Promise<AgentCase[]> {
  return JSON.parse(await readFile(path.resolve(file), "utf8")) as AgentCase[];
}

/** Real model turn, Anthropic-only (the tool-use loop needs it). */
function buildComplete(provider?: string): AgentComplete {
  const creds = resolveAiCredentials(provider);
  if (creds.provider !== "anthropic") {
    throw new Error(
      "The agent eval suite needs the agentic tool-use loop, which is Anthropic-only. " +
        "Set ANTHROPIC_API_KEY and drop --provider."
    );
  }
  return ({ system, messages, tools, maxTokens }) =>
    completeWithTools({
      provider: creds.provider,
      apiKey: creds.apiKey,
      system,
      messages,
      tools,
      maxTokens,
    });
}

export interface AgentSuiteOptions extends EvalDatasetOptions {
  casesFile?: string;
  /** Restrict to these case ids. */
  only?: string[];
  /** Run each case N times; the case passes only if every run passes. */
  repeat?: number;
  provider?: string;
  maxSteps?: number;
  /** Run the self-critique pass before grading (default true; mirrors shipped `ask`). */
  verify?: boolean;
  /** Which configuration to measure (default "grounded" — what ships). */
  arm?: ArmId;
  /**
   * Apply the case file's behavioral assertions (mustUseTool / mustNotUseTool /
   * maxSteps). Default true, which is right for the product-regression suite.
   * The A/B turns it off for **both** arms: those assertions describe the route
   * the grounded agent should take, so leaving them on would grade the grounded
   * arm on correctness *and* efficiency while grading the control on correctness
   * alone — a strictly harder rubric for the arm under test.
   */
  behavioral?: boolean;
  /** Test-only case injection, mirroring the `complete` injection pattern. */
  cases?: AgentCase[];
  onProgress?: (line: string) => void;
  /** Injected in tests; built from env credentials otherwise. */
  complete?: AgentComplete;
}

/** Dataset/cases identity recorded on every report. */
function identity(options: AgentSuiteOptions) {
  return {
    dataset: options.datasetDir ?? EVAL_DATASET,
    casesFile: options.cases ? "<injected>" : (options.casesFile ?? AGENT_CASES),
    glossary: Boolean(options.glossaryFile),
  };
}

interface RunGrade {
  detail: string;
  toolsUsed: string[];
  steps: number;
  selfCorrections: number;
  /** Last tool that produced the graded rows — see the lastResult note below. */
  lastTool: string | null;
  budgetExhausted: boolean;
}

/** Grade one agent run against a case's ground truth. */
async function gradeRun(
  testCase: AgentCase,
  runner: QueryRunner,
  agent: Awaited<ReturnType<typeof runAgentQuery>>,
  behavioral: boolean
): Promise<RunGrade> {
  const toolsUsed = [...new Set(agent.steps.map((s) => s.tool))];
  const steps = agent.steps.length;
  const selfCorrections = agent.steps.filter((s) => s.isError).length;
  // `lastResult` is overwritten by any row-producing tool, so an agent that
  // answers and then samples a table is graded on the sample. Recording which
  // tool produced the graded rows turns that silent bias into a visible one.
  const rowProducing = agent.steps.filter((s) => !s.isError && s.tool !== "resolve_terms");
  const lastTool = rowProducing[rowProducing.length - 1]?.tool ?? null;

  const expectedRows = await runner(testCase.expectedSql);
  const expected = {
    columns: expectedRows.length > 0 ? Object.keys(expectedRows[0]) : [],
    rows: expectedRows,
  };

  const problems: string[] = [];
  const comparison = compareRows(expected, agent.lastResult, {
    orderSensitive: testCase.orderSensitive,
  });
  if (!comparison.equal) problems.push(comparison.detail);
  if (behavioral) problems.push(...checkBehavior(testCase, toolsUsed, steps));

  return {
    detail: problems.join("; "),
    toolsUsed,
    steps,
    selfCorrections,
    lastTool,
    budgetExhausted: agent.budgetExhausted,
  };
}

/** Everything a case needs to run, shared by the single-arm and A/B paths. */
interface CaseDeps {
  dataset: Awaited<ReturnType<typeof prepareDataset>>;
  runner: QueryRunner;
  complete: AgentComplete;
  repeat: number;
  maxSteps?: number;
  verify: boolean;
  behavioral: boolean;
  onProgress?: (line: string) => void;
}

/**
 * Run one case `repeat` times under one arm and grade it. Extracted so the A/B
 * can interleave the arms case by case: running all of one arm and then all of
 * the other would put a long drift window (API capacity, server-side variance)
 * between them and confound the comparison with time.
 */
async function runCase(
  testCase: AgentCase,
  armId: ArmId,
  deps: CaseDeps
): Promise<CaseResult> {
  const arm = ARMS[armId];
  const runs: RunGrade[] = [];
  let error: string | null = null;

  for (let attempt = 0; attempt < deps.repeat && !error; attempt += 1) {
    deps.onProgress?.(
      `▸ ${testCase.id} [${armId}]${deps.repeat > 1 ? ` (${attempt + 1}/${deps.repeat})` : ""}`
    );
    try {
      const agent = await runAgentQuery({
        question: testCase.question,
        // Visible at the call site: the control is handed no grounding at all.
        context: arm.grounded ? deps.dataset.context : "",
        tables: deps.dataset.tables,
        model: deps.dataset.model,
        relationships: deps.dataset.relationships,
        runner: deps.runner,
        maxSteps: deps.maxSteps,
        verify: deps.verify,
        tools: arm.tools,
        systemPrompt: arm.systemPrompt,
        complete: deps.complete,
      });
      runs.push(await gradeRun(testCase, deps.runner, agent, deps.behavioral));
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }

  if (error) {
    return { id: testCase.id, outcome: "error", detail: error, trap: testCase.trap };
  }

  const failed = runs.filter((r) => r.detail !== "");
  const last = runs[runs.length - 1];
  return {
    id: testCase.id,
    outcome: failed.length === 0 ? "pass" : "fail",
    detail:
      failed.length === 0
        ? ""
        : deps.repeat > 1
          ? `${failed.length}/${deps.repeat} runs failed: ${failed[0].detail}`
          : failed[0].detail,
    trap: testCase.trap,
    steps: last.steps,
    selfCorrections: last.selfCorrections,
    toolsUsed: last.toolsUsed,
    runsPassed: runs.length - failed.length,
    runsTotal: runs.length,
    lastTool: last.lastTool ?? undefined,
    budgetExhausted: runs.some((r) => r.budgetExhausted),
  };
}

function tally(results: CaseResult[]): Pick<
  SuiteReport,
  "total" | "passed" | "failed" | "errored" | "score"
> {
  const passed = results.filter((r) => r.outcome === "pass").length;
  return {
    total: results.length,
    passed,
    failed: results.filter((r) => r.outcome === "fail").length,
    errored: results.filter((r) => r.outcome === "error").length,
    score: results.length > 0 ? passed / results.length : 0,
  };
}

/**
 * Run the agent suite: each case's question goes through the real agent loop,
 * and its result rows are compared against the ground truth produced by the
 * case's `expectedSql` (never shown to the agent).
 *
 * Calls `runAgentQuery` directly rather than `runAsk`, so no tokens are spent
 * on insight or follow-up generation — the eval only grades the analysis.
 */
export async function runAgentSuite(options: AgentSuiteOptions = {}): Promise<SuiteReport> {
  const all = options.cases ?? (await loadAgentCases(options.casesFile));
  const cases = options.only?.length
    ? all.filter((c) => options.only!.includes(c.id))
    : all;
  if (cases.length === 0) throw new Error("No matching eval cases.");

  const complete = options.complete ?? buildComplete(options.provider);

  const armId = options.arm ?? "grounded";
  const repeat = Math.max(1, options.repeat ?? 1);
  const db = await createNodeDb();
  try {
    const dataset = await loadEvalDataset(options, db.runner);

    const deps: CaseDeps = {
      dataset,
      runner: db.runner,
      complete,
      repeat,
      maxSteps: options.maxSteps,
      verify: options.verify ?? true,
      behavioral: options.behavioral ?? true,
      onProgress: options.onProgress,
    };

    const results: CaseResult[] = [];
    for (const testCase of cases) {
      results.push(await runCase(testCase, armId, deps));
    }

    return {
      suite: "agent",
      arm: armId,
      generatedAt: Date.now(),
      config: describeConfig(armId, deps),
      ...identity(options),
      ...tally(results),
      results,
    };
  } finally {
    db.close();
  }
}

/** What the run was configured with — so a stored report is never ambiguous. */
function describeConfig(armId: ArmId, deps: CaseDeps): SuiteConfig {
  return {
    arm: armId,
    repeat: deps.repeat,
    verify: deps.verify,
    behavioral: deps.behavioral,
    maxSteps: deps.maxSteps ?? DEFAULT_MAX_STEPS,
    tools: ARMS[armId].tools ?? DATA_TOOL_DEFINITIONS.map((t) => t.name),
    systemPrompt: ARMS[armId].systemPrompt ?? `${AGENT_SYSTEM_PROMPT}\n\n<grounding context>`,
  };
}

/**
 * Run both arms over the same cases, interleaved case by case, and return one
 * report per arm. The arms share a single dataset, database, and grader, and
 * differ only in the tool allowlist and the grounding — the whole point being
 * that the delta is attributable to grounding and nothing else.
 *
 * Behavioral assertions are off for both arms (see `AgentSuiteOptions.behavioral`).
 */
export async function runAbSuite(
  options: AgentSuiteOptions = {}
): Promise<{ arms: SuiteReport[] }> {
  const all = options.cases ?? (await loadAgentCases(options.casesFile));
  const cases = options.only?.length
    ? all.filter((c) => options.only!.includes(c.id))
    : all;
  if (cases.length === 0) throw new Error("No matching eval cases.");

  const complete = options.complete ?? buildComplete(options.provider);
  const repeat = Math.max(1, options.repeat ?? 1);
  const db = await createNodeDb();
  try {
    const dataset = await loadEvalDataset(options, db.runner);

    const deps: CaseDeps = {
      dataset,
      runner: db.runner,
      complete,
      repeat,
      maxSteps: options.maxSteps ?? AB_MAX_STEPS,
      verify: options.verify ?? true,
      // Accuracy-only for both arms: identical rubric is the whole point.
      behavioral: false,
      onProgress: options.onProgress,
    };

    const perArm = new Map<ArmId, CaseResult[]>(ARM_IDS.map((id) => [id, []]));
    for (const testCase of cases) {
      for (const armId of ARM_IDS) {
        perArm.get(armId)!.push(await runCase(testCase, armId, deps));
      }
    }

    const generatedAt = Date.now();
    return {
      arms: ARM_IDS.map((armId) => {
        const results = perArm.get(armId)!;
        return {
          suite: "agent" as const,
          arm: armId,
          generatedAt,
          config: describeConfig(armId, deps),
          ...identity(options),
          ...tally(results),
          results,
        };
      }),
    };
  } finally {
    db.close();
  }
}
