export interface ColumnInfo {
  name: string;
  type: string;
}

export interface TableInfo {
  name: string;
  columns: ColumnInfo[];
  rowCount: number;
}

export type ProfileColumnKind = "numeric" | "date" | "text" | "boolean" | "other";

export interface ProfileTopValue {
  value: string;
  count: number;
}

export interface ColumnProfile {
  name: string;
  type: string;
  kind: ProfileColumnKind;
  nullCount: number;
  nullPercent: number;
  distinctCount: number | null;
  min: string | number | null;
  max: string | number | null;
  avg: number | null;
  topValues: ProfileTopValue[];
}

export interface TableProfile {
  tableName: string;
  rowCount: number;
  columnCount: number;
  generatedAt: number;
  columns: ColumnProfile[];
}

export interface QueryResult {
  columns: string[];
  columnTypes: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  executionTimeMs: number;
}

