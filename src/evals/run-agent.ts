import { readFile } from "node:fs/promises";
import path from "node:path";
import { completeWithTools } from "../ai/complete";
import { runAgentQuery, type AgentComplete } from "../core/agent/loop";
import type { QueryRunner } from "../core/discovery/relationships";
import { prepareDataset } from "../adapters/dataset";
import { resolveAiCredentials } from "../adapters/cli/ai-env";
import { resolveSource } from "../adapters/cli/source";
import { createNodeDb } from "../engine/duckdb/connection";
import { checkBehavior, compareRows } from "./grade";
import { EVAL_DATASET } from "./run-engine";
import type { AgentCase, CaseResult, SuiteReport } from "./types";

export const AGENT_CASES = "evals/cases/agent.json";

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

export interface AgentSuiteOptions {
  datasetDir?: string;
  casesFile?: string;
  /** Restrict to these case ids. */
  only?: string[];
  /** Run each case N times; the case passes only if every run passes. */
  repeat?: number;
  provider?: string;
  maxSteps?: number;
  onProgress?: (line: string) => void;
  /** Injected in tests; built from env credentials otherwise. */
  complete?: AgentComplete;
}

/** Grade one agent run against a case's ground truth. */
async function gradeRun(
  testCase: AgentCase,
  runner: QueryRunner,
  agent: Awaited<ReturnType<typeof runAgentQuery>>
): Promise<{ detail: string; toolsUsed: string[]; steps: number; selfCorrections: number }> {
  const toolsUsed = [...new Set(agent.steps.map((s) => s.tool))];
  const steps = agent.steps.length;
  const selfCorrections = agent.steps.filter((s) => s.isError).length;

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
  problems.push(...checkBehavior(testCase, toolsUsed, steps));

  return { detail: problems.join("; "), toolsUsed, steps, selfCorrections };
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
  const all = await loadAgentCases(options.casesFile);
  const cases = options.only?.length
    ? all.filter((c) => options.only!.includes(c.id))
    : all;
  if (cases.length === 0) throw new Error("No matching eval cases.");

  const complete = options.complete ?? buildComplete(options.provider);

  const repeat = Math.max(1, options.repeat ?? 1);
  const db = await createNodeDb();
  try {
    const dataset = await prepareDataset(
      { ...resolveSource({ folder: options.datasetDir ?? EVAL_DATASET }), outDir: "/dev/null" },
      db.runner
    );

    const results: CaseResult[] = [];
    for (const testCase of cases) {
      const runs: Awaited<ReturnType<typeof gradeRun>>[] = [];
      let error: string | null = null;

      for (let attempt = 0; attempt < repeat && !error; attempt += 1) {
        options.onProgress?.(
          `▸ ${testCase.id}${repeat > 1 ? ` (${attempt + 1}/${repeat})` : ""}`
        );
        try {
          const agent = await runAgentQuery({
            question: testCase.question,
            context: dataset.context,
            tables: dataset.tables,
            model: dataset.model,
            relationships: dataset.relationships,
            runner: db.runner,
            maxSteps: options.maxSteps,
            complete,
          });
          runs.push(await gradeRun(testCase, db.runner, agent));
        } catch (err) {
          error = err instanceof Error ? err.message : String(err);
        }
      }

      if (error) {
        results.push({ id: testCase.id, outcome: "error", detail: error, trap: testCase.trap });
        continue;
      }

      const failed = runs.filter((r) => r.detail !== "");
      const last = runs[runs.length - 1];
      results.push({
        id: testCase.id,
        outcome: failed.length === 0 ? "pass" : "fail",
        detail:
          failed.length === 0
            ? ""
            : repeat > 1
              ? `${failed.length}/${repeat} runs failed: ${failed[0].detail}`
              : failed[0].detail,
        trap: testCase.trap,
        steps: last.steps,
        selfCorrections: last.selfCorrections,
        toolsUsed: last.toolsUsed,
      });
    }

    const passed = results.filter((r) => r.outcome === "pass").length;
    const failedCount = results.filter((r) => r.outcome === "fail").length;
    const errored = results.filter((r) => r.outcome === "error").length;
    return {
      suite: "agent",
      generatedAt: Date.now(),
      total: results.length,
      passed,
      failed: failedCount,
      errored,
      score: results.length > 0 ? passed / results.length : 0,
      results,
    };
  } finally {
    db.close();
  }
}
