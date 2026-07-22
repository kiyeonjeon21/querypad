import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { renderTable, terminalRenderOptions } from "../adapters/cli/render";
import type { SuiteReport } from "./types";

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
  lines.push("");
  lines.push(
    `${report.suite}: ${report.passed}/${report.total} passed (${pct}%)` +
      (report.failed > 0 ? `, ${report.failed} failed` : "") +
      (report.errored > 0 ? `, ${report.errored} errored` : "")
  );

  return lines.join("\n");
}

/** Persist a report so runs can be diffed over time. Returns the file path. */
export async function writeReport(report: SuiteReport, dir = RESULTS_DIR): Promise<string> {
  await mkdir(path.resolve(dir), { recursive: true });
  const file = path.resolve(dir, `${report.suite}-${report.generatedAt}.json`);
  await writeFile(file, JSON.stringify(report, null, 2));
  return file;
}
