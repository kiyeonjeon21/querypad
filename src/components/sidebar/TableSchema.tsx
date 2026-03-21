"use client";

import { useState } from "react";
import type { TableInfo } from "@/types";

export default function TableSchema({ table }: { table: TableInfo }) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="text-sm">
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
        <span className="text-xs text-gray-400 ml-auto">{table.rowCount.toLocaleString()} rows</span>
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
