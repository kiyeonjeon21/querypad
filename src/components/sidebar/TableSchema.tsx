"use client";

import { useState } from "react";
import type { TableInfo } from "@/types";

interface TableSchemaProps {
  table: TableInfo;
  onRemove: (name: string) => void;
  onOpenProfile: (name: string) => void;
  profileActive: boolean;
}

export default function TableSchema({
  table,
  onRemove,
  onOpenProfile,
  profileActive,
}: TableSchemaProps) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="text-sm group/table">
      <div className="flex items-center gap-1 px-3 py-1.5 hover:bg-gray-100 rounded transition-colors">
        <button
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
          aria-label={table.name}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
        >
          <svg
            className={`w-3 h-3 text-gray-400 transition-transform ${expanded ? "rotate-90" : ""}`}
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path d="M6 4l8 6-8 6V4z" />
          </svg>
          <span className="truncate font-medium text-gray-800 font-mono">
            {table.name}
          </span>
          <span className="ml-auto shrink-0 text-xs text-gray-400">
            {table.rowCount.toLocaleString()} rows
          </span>
        </button>
        <button
          onClick={() => onOpenProfile(table.name)}
          className={`shrink-0 p-0.5 rounded transition-colors ${
            profileActive
              ? "text-blue-600 bg-blue-50"
              : "text-gray-400 hover:text-blue-600 hover:bg-blue-50"
          }`}
          title="Profile table"
          aria-label={`Profile ${table.name}`}
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 19V5m0 14h16M8 16V9m4 7V7m4 9v-4" />
          </svg>
        </button>
        <button
          onClick={() => onRemove(table.name)}
          className="shrink-0 p-0.5 rounded text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
          title="Remove table"
          aria-label={`Remove ${table.name}`}
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      {expanded && (
        <div className="ml-5 mt-0.5 space-y-px">
          {table.columns.map((col) => (
            <div
              key={col.name}
              className="flex items-center gap-2 px-2 py-0.5 text-xs"
            >
              <span className="text-gray-700 font-mono">{col.name}</span>
              <span className="text-gray-400 ml-auto">{col.type}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
