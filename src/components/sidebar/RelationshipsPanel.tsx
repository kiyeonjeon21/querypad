"use client";

import { useEffect, useMemo, useState } from "react";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { relationshipKey } from "@/lib/discovery/relationships";
import { buildExplanation } from "@/lib/discovery/explain";
import type { TableInfo } from "@/types";
import type { Relationship, RelationshipVerdict } from "@/types/discovery";

function confidenceClasses(confidence: number): string {
  if (confidence >= 85) return "text-green-700 bg-green-50";
  if (confidence >= 60) return "text-amber-700 bg-amber-50";
  return "text-gray-600 bg-gray-100";
}

interface RelationshipCardProps {
  rel: Relationship;
  tables: TableInfo[];
  tableNames: string[];
  verdict: RelationshipVerdict | undefined;
  edited: boolean;
  onVerdict: (verdict: RelationshipVerdict | null) => void;
  onEdit: (next: Relationship) => void;
}

function columnsOf(tables: TableInfo[], table: string): string[] {
  return tables.find((t) => t.name === table)?.columns.map((c) => c.name) ?? [];
}

function RelationshipCard({
  rel,
  tables,
  tableNames,
  verdict,
  edited,
  onVerdict,
  onEdit,
}: RelationshipCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [fromColumn, setFromColumn] = useState(rel.from.column);
  const [toTable, setToTable] = useState(rel.to.table);
  const [toColumn, setToColumn] = useState(rel.to.column);

  const reasons = useMemo(
    () => buildExplanation([rel], tableNames).relationships[0]?.reasons ?? [],
    [rel, tableNames]
  );

  const from = `${rel.from.table}.${rel.from.column}`;
  const to = `${rel.to.table}.${rel.to.column}`;

  const startEdit = () => {
    setFromColumn(rel.from.column);
    setToTable(rel.to.table);
    setToColumn(rel.to.column);
    setEditing(true);
  };

  const saveEdit = () => {
    onEdit({
      from: { table: rel.from.table, column: fromColumn },
      to: { table: toTable, column: toColumn },
      confidence: 100,
      cardinality: rel.cardinality,
      signals: rel.signals,
    });
    setEditing(false);
  };

  const ring =
    verdict === "accepted"
      ? "border-green-300 bg-green-50/40"
      : verdict === "rejected"
        ? "border-gray-200 bg-gray-50 opacity-60"
        : "border-gray-200";

  return (
    <div className={`mx-2 my-1.5 rounded-lg border px-3 py-2 ${ring}`}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p
            className={`font-mono text-xs text-gray-800 break-all ${
              verdict === "rejected" ? "line-through" : ""
            }`}
          >
            {from} ↳ {to}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
            <span className={`rounded px-1.5 py-0.5 font-medium ${confidenceClasses(rel.confidence)}`}>
              {rel.confidence}%
            </span>
            <span className="text-gray-400">{rel.cardinality}</span>
            {edited && <span className="text-blue-500">edited</span>}
          </div>
        </div>
      </div>

      {editing ? (
        <div className="mt-2 space-y-1.5">
          <div className="flex items-center gap-1 text-[11px] text-gray-500">
            <span className="font-mono text-gray-700">{rel.from.table}.</span>
            <select
              value={fromColumn}
              onChange={(e) => setFromColumn(e.target.value)}
              className="min-w-0 flex-1 rounded border border-gray-200 bg-white px-1 py-0.5 font-mono text-gray-800"
              aria-label="Foreign column"
            >
              {columnsOf(tables, rel.from.table).map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <span className="text-gray-400">↳</span>
          </div>
          <div className="flex items-center gap-1 text-[11px]">
            <select
              value={toTable}
              onChange={(e) => {
                setToTable(e.target.value);
                setToColumn(columnsOf(tables, e.target.value)[0] ?? "");
              }}
              className="min-w-0 flex-1 rounded border border-gray-200 bg-white px-1 py-0.5 font-mono text-gray-800"
              aria-label="Referenced table"
            >
              {tableNames.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
            <span className="text-gray-400">.</span>
            <select
              value={toColumn}
              onChange={(e) => setToColumn(e.target.value)}
              className="min-w-0 flex-1 rounded border border-gray-200 bg-white px-1 py-0.5 font-mono text-gray-800"
              aria-label="Referenced column"
            >
              {columnsOf(tables, toTable).map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <div className="flex gap-1.5 pt-0.5">
            <button
              onClick={saveEdit}
              className="rounded bg-blue-600 px-2 py-0.5 text-[11px] font-medium text-white hover:bg-blue-700 transition-colors"
            >
              Save
            </button>
            <button
              onClick={() => setEditing(false)}
              className="rounded px-2 py-0.5 text-[11px] text-gray-500 hover:bg-gray-100 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          {expanded && reasons.length > 0 && (
            <ul className="mt-1.5 space-y-0.5 text-[11px] text-gray-600">
              {reasons.map((reason, i) => (
                <li key={i}>• {reason}</li>
              ))}
            </ul>
          )}
          <div className="mt-2 flex items-center gap-1.5">
            <button
              onClick={() => onVerdict(verdict === "accepted" ? null : "accepted")}
              className={`rounded px-2 py-0.5 text-[11px] font-medium transition-colors ${
                verdict === "accepted"
                  ? "bg-green-600 text-white hover:bg-green-700"
                  : "text-green-700 hover:bg-green-50"
              }`}
            >
              Accept
            </button>
            <button
              onClick={() => onVerdict(verdict === "rejected" ? null : "rejected")}
              className={`rounded px-2 py-0.5 text-[11px] font-medium transition-colors ${
                verdict === "rejected"
                  ? "bg-gray-600 text-white hover:bg-gray-700"
                  : "text-gray-600 hover:bg-gray-100"
              }`}
            >
              Reject
            </button>
            <button
              onClick={startEdit}
              className="rounded px-2 py-0.5 text-[11px] text-gray-500 hover:bg-gray-100 transition-colors"
            >
              Edit
            </button>
            <button
              onClick={() => setExpanded((v) => !v)}
              className="ml-auto rounded px-2 py-0.5 text-[11px] text-gray-400 hover:bg-gray-100 transition-colors"
            >
              {expanded ? "Hide" : "Why?"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

interface RelationshipsPanelProps {
  onClose: () => void;
}

export default function RelationshipsPanel({ onClose }: RelationshipsPanelProps) {
  const discovery = useWorkspaceStore((s) => s.discovery);
  const tables = useWorkspaceStore((s) => s.tables);
  const verdicts = useWorkspaceStore((s) => s.relationshipVerdicts);
  const overrides = useWorkspaceStore((s) => s.relationshipOverrides);
  const discoverRelationships = useWorkspaceStore((s) => s.discoverRelationships);
  const setRelationshipVerdict = useWorkspaceStore((s) => s.setRelationshipVerdict);
  const editRelationship = useWorkspaceStore((s) => s.editRelationship);

  useEffect(() => {
    if (discovery.status === "idle") void discoverRelationships();
  }, [discovery.status, discoverRelationships]);

  const tableNames = useMemo(() => tables.map((t) => t.name), [tables]);
  const overrideKeys = useMemo(
    () => new Set(overrides.map((rel) => relationshipKey(rel))),
    [overrides]
  );

  return (
    <aside className="w-80 max-w-[42vw] shrink-0 border-r border-gray-200 bg-white flex flex-col h-full">
      <div className="px-3 py-2 border-b border-gray-200 flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-xs font-semibold text-gray-800">Relationships</h2>
          <p className="text-[11px] text-gray-400">
            {discovery.status === "ready"
              ? `${discovery.relationships.length} inferred — verify below`
              : "Inferred joins across your tables"}
          </p>
        </div>
        <button
          onClick={() => discoverRelationships()}
          disabled={discovery.status === "loading"}
          className="p-1 text-gray-400 hover:text-gray-700 hover:bg-gray-100 disabled:opacity-40 rounded transition-colors"
          title="Re-discover relationships"
          aria-label="Re-discover relationships"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h5M20 20v-5h-5M5.5 14A7 7 0 0018 17.5M18.5 10A7 7 0 006 6.5" />
          </svg>
        </button>
        <button
          onClick={onClose}
          className="p-1 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded transition-colors"
          title="Close relationships"
          aria-label="Close relationships"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto py-1">
        {discovery.status === "loading" && (
          <div className="flex items-center gap-2 px-3 py-4 text-xs text-gray-500">
            <div className="w-3.5 h-3.5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            Discovering relationships...
          </div>
        )}

        {discovery.status === "error" && (
          <div className="px-3 py-4 text-xs">
            <p className="font-medium text-red-700">Discovery failed</p>
            <p className="mt-1 text-red-600 whitespace-pre-wrap">{discovery.error}</p>
            <button
              onClick={() => discoverRelationships()}
              className="mt-3 px-2 py-1 rounded bg-red-50 text-red-700 hover:bg-red-100 transition-colors"
            >
              Retry
            </button>
          </div>
        )}

        {discovery.status === "ready" && discovery.relationships.length === 0 && (
          <p className="px-3 py-4 text-xs text-gray-400 text-center">
            No relationships inferred. Load at least two related tables.
          </p>
        )}

        {discovery.status === "ready" &&
          discovery.relationships.map((rel) => {
            const key = relationshipKey(rel);
            return (
              <RelationshipCard
                key={key}
                rel={rel}
                tables={tables}
                tableNames={tableNames}
                verdict={verdicts[key]}
                edited={overrideKeys.has(key)}
                onVerdict={(verdict) => setRelationshipVerdict(key, verdict)}
                onEdit={(next) => editRelationship(key, next)}
              />
            );
          })}
      </div>
    </aside>
  );
}
