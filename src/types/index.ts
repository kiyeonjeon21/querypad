export interface ColumnInfo {
  name: string;
  type: string;
}

export interface TableInfo {
  name: string;
  columns: ColumnInfo[];
  rowCount: number;
}

export interface QueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  executionTimeMs: number;
}

export interface QueryError {
  message: string;
}

export interface SharePayload {
  q: string;
  d: Record<string, string>;
  t: { name: string; fileName: string }[];
}

export type ChartType = "bar" | "line" | "scatter" | "pie";

export interface ChartConfig {
  type: ChartType;
  xColumn: string;
  yColumns: string[];
}

export interface EditorTab {
  id: string;
  title: string;
  query: string;
  result: QueryResult | null;
  error: QueryError | null;
  isExecuting: boolean;
  createdAt: number;
}

// Re-exports
export type {
  Pipeline,
  PipelineStep,
  PipelineExecutionResult,
} from "./pipeline";

export type {
  PluginManifest,
  PluginExtension,
  LoadedPlugin,
} from "./plugin";

export type { PeerInfo, RoomState } from "./collaboration";
