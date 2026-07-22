import { formatReport, writeReport } from "../../evals/report";
import { runEngineSuite } from "../../evals/run-engine";
import type { SuiteReport } from "../../evals/types";

export interface RunEvalOptions {
  suite: string;
  /** Print the raw JSON report instead of the table. */
  json?: boolean;
  /** Agent suite: restrict to these case ids. */
  only?: string[];
  /** Agent suite: run each case N times to surface non-determinism. */
  repeat?: number;
  provider?: string;
  log?: (line: string) => void;
}

/**
 * `querypad eval <engine|agent>`: score the engine (deterministic, no API key)
 * or the agent (needs a key, costs tokens). Exit code is non-zero when any case
 * fails, so the engine suite can gate CI.
 */
export async function runEval(options: RunEvalOptions): Promise<number> {
  const log = options.log ?? ((line: string) => console.log(line));

  let report: SuiteReport;
  switch (options.suite) {
    case "engine":
      report = await runEngineSuite();
      break;
    case "agent": {
      const { runAgentSuite } = await import("../../evals/run-agent");
      report = await runAgentSuite({
        only: options.only,
        repeat: options.repeat,
        provider: options.provider,
        onProgress: options.json ? undefined : (line) => log(line),
      });
      break;
    }
    default:
      console.error(`Unknown eval suite "${options.suite}". Use "engine" or "agent".`);
      return 1;
  }

  if (options.json) {
    log(JSON.stringify(report, null, 2));
  } else {
    log(formatReport(report));
    const file = await writeReport(report);
    log(`\nWrote ${file}`);
  }

  return report.failed + report.errored > 0 ? 1 : 0;
}
