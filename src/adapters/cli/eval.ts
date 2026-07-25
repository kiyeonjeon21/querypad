import { formatComparison, formatReport, writeReport } from "../../evals/report";
import { runEngineSuite } from "../../evals/run-engine";
import type { SuiteReport } from "../../evals/types";
import { parseArm } from "../../evals/arms";

export interface RunEvalOptions {
  suite: string;
  /** Print the raw JSON report instead of the table. */
  json?: boolean;
  /** Agent suite: restrict to these case ids. */
  only?: string[];
  /** Agent suite: run each case N times to surface non-determinism. */
  repeat?: number;
  provider?: string;
  /** Agent suite: run the self-critique pass (default true; --no-verify sets false). */
  verify?: boolean;
  /** Agent suite: which configuration to measure (default "grounded"). */
  arm?: string;
  /** Agent suite: run both arms interleaved and print the comparison. */
  ab?: boolean;
  /** Agent suite: the agent's turn budget. */
  steps?: number;
  /** Score a different dataset folder (default: the committed evals/dataset). */
  dataset?: string;
  /** Score a different cases file (note: --cases is the case-id filter). */
  casesFile?: string;
  /** Apply a committed glossary, e.g. a hard dataset's curation. */
  glossary?: string;
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
      report = await runEngineSuite({
        datasetDir: options.dataset,
        casesFile: options.casesFile,
        glossaryFile: options.glossary,
      });
      break;
    case "agent": {
      const shared = {
        datasetDir: options.dataset,
        casesFile: options.casesFile,
        glossaryFile: options.glossary,
        only: options.only,
        repeat: options.repeat,
        provider: options.provider,
        verify: options.verify,
        maxSteps: options.steps,
        onProgress: options.json ? undefined : (line: string) => log(line),
      };

      // A/B: both arms over the same cases, interleaved, graded identically.
      if (options.ab) {
        const { runAbSuite } = await import("../../evals/run-agent");
        const { arms } = await runAbSuite(shared);
        if (options.json) {
          log(JSON.stringify({ arms }, null, 2));
        } else {
          log(formatComparison(arms[0], arms[1]));
          for (const arm of arms) log(`\nWrote ${await writeReport(arm)}`);
        }
        // A control arm doing badly is the expected finding, not a failure — only
        // a harness malfunction should make this exit non-zero.
        return arms.some((a) => a.errored > 0) ? 1 : 0;
      }

      const { runAgentSuite } = await import("../../evals/run-agent");
      report = await runAgentSuite({
        ...shared,
        arm: options.arm ? parseArm(options.arm) : undefined,
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
