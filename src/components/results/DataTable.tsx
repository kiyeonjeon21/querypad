"use client";

import { useRef, useMemo } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { QueryResult } from "@/types";
import { formatValue } from "@/lib/utils";

const ROW_HEIGHT = 32;

export default function DataTable({ result }: { result: QueryResult }) {
  const parentRef = useRef<HTMLDivElement>(null);

  const gridCols = useMemo(
    () => `48px repeat(${result.columns.length}, minmax(100px, 1fr))`,
    [result.columns.length]
  );

  // eslint-disable-next-line react-hooks/incompatible-library
  const rowVirtualizer = useVirtualizer({
    count: result.rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 20,
  });

  return (
    <div ref={parentRef} className="overflow-auto h-full">
      {/* Header */}
      <div
        className="sticky top-0 z-10 bg-gray-100 border-b border-gray-200"
        style={{ display: "grid", gridTemplateColumns: gridCols }}
      >
        <div className="px-3 py-1.5 text-left text-xs font-semibold text-gray-500">
          #
        </div>
        {result.columns.map((col) => (
          <div
            key={col}
            className="px-3 py-1.5 text-left text-xs font-semibold text-gray-600 whitespace-nowrap overflow-hidden text-ellipsis"
          >
            {col}
          </div>
        ))}
      </div>
      {/* Body */}
      <div
        style={{
          height: `${rowVirtualizer.getTotalSize()}px`,
          position: "relative",
        }}
      >
        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
          const row = result.rows[virtualRow.index];
          return (
            <div
              key={virtualRow.index}
              className="hover:bg-blue-50 border-b border-gray-100"
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                height: `${virtualRow.size}px`,
                transform: `translateY(${virtualRow.start}px)`,
                display: "grid",
                gridTemplateColumns: gridCols,
              }}
            >
              <div className="px-3 py-1 text-xs text-gray-400 font-mono flex items-center">
                {virtualRow.index + 1}
              </div>
              {result.columns.map((col) => (
                <div
                  key={col}
                  className="px-3 py-1 text-xs text-gray-700 font-mono whitespace-nowrap overflow-hidden text-ellipsis flex items-center"
                >
                  {formatValue(row[col])}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
