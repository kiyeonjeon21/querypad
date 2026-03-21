import type { QueryResult, QueryError } from "./index";

export interface PipelineStep {
  id: string;
  name: string; // temp table name (e.g. "clean_orders")
  query: string; // SQL that can reference other step names
  position?: { x: number; y: number };
}

export interface Pipeline {
  id: string;
  title: string;
  steps: PipelineStep[];
  createdAt: number;
}

export interface PipelineExecutionResult {
  stepId: string;
  result: QueryResult | null;
  error: QueryError | null;
  executionTimeMs: number;
}
