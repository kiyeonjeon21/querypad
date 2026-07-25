import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { renderTable, terminalRenderOptions } from "../adapters/cli/render";
import type { CaseResult, SuiteReport } from "./types";

const RESULTS_DIR = ".datactx/evals";

/** Render a suite report as a table plus a one-line score, for the terminal. */
export function formatReport(report: SuiteReport): string {
  const lines: string[] = [];

  const rows = report.results.map((r) => ({
    case: r.id,
    outcome: r.outcome,
    ...(report.suite === "agent" ? { steps: r.steps ?? 0 } : {}),
    detail: r.detail.split("\n")[0],
  }));

  lines.push(
    renderTable({ columns: Object.keys(rows[0] ?? { case: "" }), rows }, terminalRenderOptions())
  );

  // Multi-line details (e.g. refused SQL) are truncated in the table; print them in full.
  const verbose = report.results.filter((r) => r.detail.includes("\n"));
  if (verbose.length > 0) {
    lines.push("");
    for (const r of verbose) lines.push(`${r.id}:\n  ${r.detail.replaceAll("\n", "\n  ")}`);
  }

  const pct = (report.score * 100).toFixed(1);
  const label = report.arm ? `${report.suite}[${report.arm}]` : report.suite;
  lines.push("");
  lines.push(
    `${label}: ${report.passed}/${report.total} passed (${pct}%)` +
      (report.failed > 0 ? `, ${report.failed} failed` : "") +
      (report.errored > 0 ? `, ${report.errored} errored` : "")
  );

  return lines.join("\n");
}

/** Runs passed / runs attempted across every case — finer-grained than the strict count. */
function runRate(report: SuiteReport): { passed: number; total: number; pct: number } {
  let passed = 0;
  let total = 0;
  for (const r of report.results) {
    passed += r.runsPassed ?? (r.outcome === "pass" ? 1 : 0);
    total += r.runsTotal ?? 1;
  }
  return { passed, total, pct: total > 0 ? passed / total : 0 };
}

function mean(values: number[]): number {
  return values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

/** `k/n` run tally for one case, or the bare outcome when runs were not recorded. */
function tally(result: CaseResult | undefined): string {
  if (!result) return "-";
  if (result.outcome === "error") return "error";
  if (result.runsTotal === undefined) return result.outcome;
  return `${result.runsPassed ?? 0}/${result.runsTotal}`;
}

/**
 * Render an A/B of two arms measured in the same invocation. Row correctness is
 * graded identically for both; the step counts are reported as metrics, not
 * grades, because behavioral assertions only apply to the grounded arm.
 */
export function formatComparison(a: SuiteReport, b: SuiteReport): string {
  const lines: string[] = [];
  const byId = new Map(b.results.map((r) => [r.id, r]));

  const rows = a.results.map((left) => {
    const right = byId.get(left.id);
    return {
      case: left.id,
      trap: left.trap ?? "",
      [`${a.arm ?? "a"}`]: tally(left),
      [`${b.arm ?? "b"}`]: tally(right),
      steps: `${left.steps ?? 0} vs ${right?.steps ?? 0}`,
    };
  });
  lines.push(
    renderTable({ columns: Object.keys(rows[0] ?? { case: "" }), rows }, terminalRenderOptions())
  );

  const ra = runRate(a);
  const rb = runRate(b);
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
  lines.push("");
  for (const [report, rate] of [
    [a, ra],
    [b, rb],
  ] as const) {
    lines.push(
      `${report.arm ?? report.suite}: runs ${rate.passed}/${rate.total} (${pct(rate.pct)}), ` +
        `cases ${report.passed}/${report.total}, ` +
        `mean steps ${mean(report.results.map((r) => r.steps ?? 0)).toFixed(1)}, ` +
        `mean self-corrections ${mean(report.results.map((r) => r.selfCorrections ?? 0)).toFixed(1)}` +
        (report.errored > 0 ? `, ${report.errored} ERRORED` : "")
    );
  }

  const delta = ra.pct - rb.pct;
  const sign = delta > 0 ? "+" : "";
  lines.push("");
  lines.push(
    `delta (${a.arm ?? "a"} - ${b.arm ?? "b"}): ${sign}${(delta * 100).toFixed(1)} points on run pass rate`
  );

  // Read these before the score: a dirty diagnostic means rerun, not interpret.
  lines.push("");
  lines.push("validity checks:");
  for (const report of [a, b]) {
    const starved = report.results.filter((r) => r.budgetExhausted).map((r) => r.id);
    lines.push(
      `  ${report.arm ?? report.suite}: turn budget hit on ${starved.length}/${report.total} cases` +
        (starved.length > 0 ? ` (${starved.join(", ")}) - RERUN with a larger budget` : "")
    );
  }
  const controls = a.results.filter((r) => r.trap === "baseline").map((r) => r.id);
  for (const report of [a, b]) {
    const brokenControls = report.results
      .filter((r) => r.trap === "baseline" && r.outcome !== "pass")
      .map((r) => r.id);
    lines.push(
      `  ${report.arm ?? report.suite}: baseline controls ${controls.length - brokenControls.length}/${controls.length} passed` +
        (brokenControls.length > 0
          ? ` (${brokenControls.join(", ")}) - SUSPECT HARNESS, not a result`
          : "")
    );
  }
  // lastResult is set by any row-producing tool, so a trailing sample_table can
  // overwrite a correct answer. That can only bite the grounded arm.
  const overwritten = a.results.filter(
    (r) => r.outcome !== "pass" && r.lastTool && !["run_sql", "query_metric"].includes(r.lastTool)
  );
  if (overwritten.length > 0) {
    lines.push(
      `  ${a.arm ?? "a"}: graded on a non-answer tool in ${overwritten.map((r) => `${r.id}(${r.lastTool})`).join(", ")}` +
        " - inspect before trusting these failures"
    );
  }

  lines.push("");
  lines.push(
    "note: both arms are graded on answer rows only, with the same model, loop, dataset, " +
      "grader, verify setting and turn budget. Case-level behavioral assertions are off for " +
      "both, so step counts are metrics rather than grades."
  );

  return lines.join("\n");
}

/** Persist a report so runs can be diffed over time. Returns the file path. */
export async function writeReport(report: SuiteReport, dir = RESULTS_DIR): Promise<string> {
  await mkdir(path.resolve(dir), { recursive: true });
  const arm = report.arm ? `-${report.arm}` : "";
  const file = path.resolve(dir, `${report.suite}${arm}-${report.generatedAt}.json`);
  await writeFile(file, JSON.stringify(report, null, 2));
  return file;
}
