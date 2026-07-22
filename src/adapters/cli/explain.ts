import { buildExplanation } from "../../core/discovery/explain";
import { applyVerdicts } from "../../core/discovery/verdicts";
import { readArtifacts, readVerdicts } from "./artifacts";

export interface RunExplainOptions {
  log?: (line: string) => void;
}

/**
 * `querypad explain [folder]`: read the inferred relationships from `.datactx/` and
 * justify each one from its stored signals, plus caveats to verify. Pure consumer of
 * artifacts — run `querypad inspect` first. Returns a process exit code.
 */
export async function runExplain(folder: string, options: RunExplainOptions = {}): Promise<number> {
  const log = options.log ?? ((line: string) => console.log(line));

  const cached = await readArtifacts(folder);
  if (!cached.relationships) {
    log(
      `No .datactx/relationships.json found in ${folder}. ` +
        "Run `querypad inspect <folder>` first."
    );
    return 1;
  }
  const { relationships } = applyVerdicts(cached.relationships, await readVerdicts(folder));
  const profiles = cached.profiles;

  const tableNames = profiles?.map((profile) => profile.tableName) ?? [];
  const report = buildExplanation(relationships, tableNames);

  log(`Relationships (${report.relationships.length})`);
  if (report.relationships.length === 0) {
    log("  No relationships were inferred.");
  }
  for (const { relationship, reasons } of report.relationships) {
    const from = `${relationship.from.table}.${relationship.from.column}`;
    const to = `${relationship.to.table}.${relationship.to.column}`;
    log("");
    log(`${from} ↳ ${to} — ${relationship.confidence}% (${relationship.cardinality})`);
    for (const reason of reasons) log(`  • ${reason}`);
  }

  log("");
  log(`Caveats (${report.caveats.length})`);
  if (report.caveats.length === 0) {
    log("  None.");
  }
  for (const caveat of report.caveats) log(`  • ${caveat}`);

  return 0;
}
