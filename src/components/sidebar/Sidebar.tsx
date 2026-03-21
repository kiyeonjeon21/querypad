"use client";

import { useCallback } from "react";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { SAMPLE_TABLE_NAMES } from "@/lib/constants";
import TableSchema from "./TableSchema";
import DropZone from "@/components/dropzone/DropZone";

export default function Sidebar() {
  const tables = useWorkspaceStore((s) => s.tables);
  const removeTable = useWorkspaceStore((s) => s.removeTable);
  const onlySampleTables =
    tables.length > 0 && tables.every((t) => SAMPLE_TABLE_NAMES.has(t.name));

  const handleFilesAdded = useCallback(() => {
    if (onlySampleTables) {
      for (const name of SAMPLE_TABLE_NAMES) {
        removeTable(name);
      }
    }
  }, [onlySampleTables, removeTable]);

  return (
    <div className="w-60 border-r border-gray-200 bg-white flex flex-col h-full">
      <div className="px-3 py-2 border-b border-gray-200 flex items-center justify-between">
        <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
          Tables
        </h2>
        <DropZone compact highlight={onlySampleTables} onFilesAdded={handleFilesAdded} />
      </div>
      <div className="flex-1 overflow-y-auto py-1">
        {tables.length === 0 ? (
          <p className="px-3 py-4 text-xs text-gray-400 text-center">
            No tables loaded
          </p>
        ) : (
          tables.map((t) => <TableSchema key={t.name} table={t} onRemove={removeTable} />)
        )}
      </div>
    </div>
  );
}
