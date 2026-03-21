import { getConnection } from "@/lib/duckdb/instance";
import { executeQuery } from "@/lib/duckdb/queries";
import { topologicalSort } from "./graph";
import type { PipelineStep, PipelineExecutionResult } from "@/types/pipeline";

/**
 * Execute a pipeline: topological sort, then run each step as CREATE TEMP TABLE.
 */
export async function executePipeline(
  steps: PipelineStep[]
): Promise<PipelineExecutionResult[]> {
  const sorted = topologicalSort(steps);
  if (!sorted) {
    return steps.map((s) => ({
      stepId: s.id,
      result: null,
      error: { message: "Circular dependency detected in pipeline" },
      executionTimeMs: 0,
    }));
  }

  const results: PipelineExecutionResult[] = [];
  const conn = await getConnection();

  for (const step of sorted) {
    const start = performance.now();
    try {
      // Create temp table from step query
      await conn.query(
        `CREATE OR REPLACE TEMP TABLE "${step.name}" AS (${step.query})`
      );
      // Fetch results for display
      const result = await executeQuery(
        `SELECT * FROM "${step.name}"`
      );
      results.push({
        stepId: step.id,
        result,
        error: null,
        executionTimeMs: Math.round(performance.now() - start),
      });
    } catch (err) {
      results.push({
        stepId: step.id,
        result: null,
        error: {
          message: err instanceof Error ? err.message : String(err),
        },
        executionTimeMs: Math.round(performance.now() - start),
      });
      // Continue executing remaining steps that don't depend on this one
    }
  }

  return results;
}
