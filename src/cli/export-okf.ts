import { buildOkfBundle } from "../lib/discovery/okf-export";
import { readSemanticModel, writeOkfBundle } from "./artifacts";

/**
 * `querypad export-okf <folder>`: write the semantic model as an OKF (Open Knowledge Format)
 * bundle under `.querypad/okf/`. Pure consumer of `.querypad/semantic-model.json`; run
 * `inspect` (and optionally `enrich`) first.
 */
export async function runExportOkf(folder: string): Promise<number> {
  const model = await readSemanticModel(folder);
  if (!model) {
    console.error(
      "No semantic model found. Run `querypad inspect` first (then optionally `enrich`)."
    );
    return 1;
  }

  const bundle = buildOkfBundle(model);
  const dir = await writeOkfBundle(folder, bundle);
  console.log(`Wrote ${bundle.length} OKF file(s) to ${dir}`);
  return 0;
}
