/**
 * The two configurations the agent suite can measure, so the product's central
 * claim — that an agent grounded in a governed semantic model beats naked
 * text-to-SQL — is measured rather than asserted.
 *
 * The control is not crippled. `isReadOnlyQuery` allows SHOW/DESCRIBE/PRAGMA, so
 * a `run_sql`-only agent can discover every table and column for itself, the way
 * a shell agent would `ls` a folder and `head` the CSVs (verified against the
 * engine: `SHOW TABLES` lists all 7 eval tables). What it loses is only the
 * semantic layer: inferred joins with confidence, business entities, the metric
 * compiler's fan-out refusal, and term resolution.
 *
 * Two rules keep the comparison honest:
 *
 * 1. **`grounded` is the zero-override arm.** It sets no tools and no system
 *    prompt, so it runs the shipped code path byte for byte. If it had to
 *    re-compose the prompt here, "the grounded arm is what ships" would stop
 *    being verifiable — and a test asserts the two are identical.
 * 2. **The control's prompt is a mechanical translation of
 *    `AGENT_SYSTEM_PROMPT`, nothing more.** Only two edits are licensed:
 *    name the read-only statements it inspects with (tool-mechanics parity,
 *    since it has no `describe_table`/`sample_table`), and drop the "ground your
 *    SQL in the relationships below" line because there is nothing below.
 *    No dataset knowledge (no table names, no join keys, no hint that revenue is
 *    derived) and no strategy hints beyond parity. "All tools are read-only"
 *    stays: that is mechanics parity, and removing it would make the safety case
 *    over-refuse for a reason unrelated to the hypothesis.
 */
export type ArmId = "grounded" | "raw-sql";

export const ARM_IDS: ArmId[] = ["grounded", "raw-sql"];

/** The control's preamble: same job and same guardrails, no map, smaller toolbox. */
export const RAW_SQL_SYSTEM_PROMPT = `You are a data analyst agent working over a local, read-only DuckDB database.
Use the provided tools to explore the schema and answer the user's question with SQL.

Guidance:
- Inspect the schema with read-only statements (SHOW TABLES, DESCRIBE <table>, SELECT ... LIMIT) before writing complex SQL.
- All tools are read-only. If a query errors, read the error, fix the SQL, and retry.
- When you have the answer, reply with a concise 1-3 sentence finding. Do not restate the SQL.`;

export interface ArmSpec {
  id: ArmId;
  /** Shown in reports. */
  label: string;
  /** Tool allowlist; undefined means the whole shipped toolkit. */
  tools?: string[];
  /** System prompt override; undefined means the shipped composition. */
  systemPrompt?: string;
  /** Whether the dataset's grounding context reaches the agent. */
  grounded: boolean;
}

export const ARMS: Record<ArmId, ArmSpec> = {
  // No overrides on purpose - this IS the shipped configuration.
  grounded: {
    id: "grounded",
    label: "grounded (semantic layer + full toolkit)",
    grounded: true,
  },
  "raw-sql": {
    id: "raw-sql",
    label: "raw-sql (no grounding, run_sql only)",
    tools: ["run_sql"],
    systemPrompt: RAW_SQL_SYSTEM_PROMPT,
    grounded: false,
  },
};

/** Parse a `--arm` value, with a readable error listing the valid ids. */
export function parseArm(value: string): ArmId {
  if (value in ARMS) return value as ArmId;
  throw new Error(`Unknown arm "${value}". Use one of: ${ARM_IDS.join(", ")}`);
}
