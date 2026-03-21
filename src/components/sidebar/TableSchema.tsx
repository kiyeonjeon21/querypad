"use client";

import { useState } from "react";
import type { TableInfo } from "@/types";

interface TableSchemaProps {
  table: TableInfo;
  onRemove: (name: string) => void;
}

export default function TableSchema({ table, onRemove }: TableSchemaProps) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="text-sm group/table">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 w-full px-3 py-1.5 hover:bg-gray-100 rounded transition-colors text-left"
      >
        <svg
          className={`w-3 h-3 text-gray-400 transition-transform ${expanded ? "rotate-90" : ""}`}
          fill="currentColor"
          viewBox="0 0 20 20"
        >
          <path d="M6 4l8 6-8 6V4z" />
        </svg>
        <span className="font-medium text-gray-800 font-mono">{table.name}</span>
        <span className="text-xs text-gray-400 ml-auto group-hover/table:hidden">{table.rowCount.toLocaleString()} rows</span>
        <span
          role="button"
          tabIndex={0}
          onClick={(e) => { e.stopPropagation(); onRemove(table.name); }}
          onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); onRemove(table.name); } }}
          className="text-gray-400 hover:text-red-500 ml-auto hidden group-hover/table:inline-flex transition-colors"
          title="Remove table"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </span>
      </button>
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
