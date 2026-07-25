/** A tabular result to be graded: the shape both DuckDB and the agent produce. */
export interface ResultRows {
  columns: string[];
  rows: Record<string, unknown>[];
}

/** One natural-language case for the agent suite. */
export interface AgentCase {
  id: string;
  /** What a user would type. */
  question: string;
  /**
   * SQL that produces the correct answer. Executed by the harness to derive
   * ground truth — never shown to the agent.
   */
  expectedSql: string;
  /** What this case is probing (fan-out, multi-hop, …); grouped in the report. */
  trap?: string;
  /** Compare rows positionally (for "top N" / ranked questions). */
  orderSensitive?: boolean;
  /** Tools the agent must have called (e.g. query_metric for a defined metric). */
  mustUseTool?: string[];
  /** Tools the agent must not have called. */
  mustNotUseTool?: string[];
  /** Fail if the agent needed more than this many tool steps. */
  maxSteps?: number;
}

/** One deterministic case for the engine suite (no AI, no API key). */
export interface EngineCase {
  id: string;
  kind: "relationship" | "entity" | "metric" | "term";
  /** Human-readable statement of what is asserted. */
  describe: string;
  /** `relationship`: "orders.customer_id->customers.id" plus a confidence floor. */
  edge?: string;
  minConfidence?: number;
  /** `relationship`: assert this edge is NOT inferred. */
  absent?: boolean;
  /** `entity`: entity name, with the measures/dimensions it must expose. */
  entity?: string;
  table?: string;
  measures?: string[];
  dimensions?: string[];
  /** `metric`: a metric request that must compile (or be refused). */
  metric?: { metric: string; dimensions?: string[] };
  expectRefusal?: boolean;
  /** `term`: a phrase that must resolve to this target. */
  term?: string;
  resolvesTo?: string;
}

export type Outcome = "pass" | "fail" | "error";

export interface CaseResult {
  id: string;
  outcome: Outcome;
  /** Why it failed — empty on pass. */
  detail: string;
  trap?: string;
  /** Agent suite only. */
  sql?: string;
  steps?: number;
  /** Failed SQL attempts the agent recovered from. */
  selfCorrections?: number;
  toolsUsed?: string[];
  /**
   * How many of the `--repeat` runs passed. The case `outcome` is strict (it
   * passes only when every run passes), which is right for gating but a coarse
   * estimator for an A/B delta — these give the finer-grained rate.
   */
  runsPassed?: number;
  runsTotal?: number;
  /** Which tool produced the rows that were graded (see the note in run-agent). */
  lastTool?: string;
  /** True when any run was cut off by the turn budget rather than finishing. */
  budgetExhausted?: boolean;
}

/**
 * The configuration a report was produced under. Stored so a number can never be
 * quoted without the setup that produced it — two reports in `.datactx/evals/`
 * with different `verify` settings were previously indistinguishable.
 */
export interface SuiteConfig {
  arm: string;
  repeat: number;
  verify: boolean;
  behavioral: boolean;
  maxSteps: number;
  tools: string[];
  /** The exact preamble the model saw, so a reader can audit the control arm. */
  systemPrompt: string;
}

export interface SuiteReport {
  suite: "engine" | "agent";
  /** Agent suite only: which configuration was measured (see src/evals/arms.ts). */
  arm?: string;
  /** Agent suite only: the full setup this score was produced under. */
  config?: SuiteConfig;
  generatedAt: number;
  total: number;
  passed: number;
  failed: number;
  errored: number;
  /** passed / total, 0..1. */
  score: number;
  results: CaseResult[];
}
