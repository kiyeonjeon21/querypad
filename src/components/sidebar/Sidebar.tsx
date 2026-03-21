"use client";

import { useWorkspaceStore } from "@/stores/workspace-store";
import TableSchema from "./TableSchema";
import DropZone from "@/components/dropzone/DropZone";

export default function Sidebar() {
  const tables = useWorkspaceStore((s) => s.tables);

  return (
    <div className="w-60 border-r border-gray-200 bg-white flex flex-col h-full">
      <div className="px-3 py-2 border-b border-gray-200 flex items-center justify-between">
        <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
          Tables
        </h2>
        <DropZone compact />
      </div>
      <div className="flex-1 overflow-y-auto py-1">
        {tables.length === 0 ? (
          <p className="px-3 py-4 text-xs text-gray-400 text-center">
            No tables loaded
          </p>
        ) : (
          tables.map((t) => <TableSchema key={t.name} table={t} />)
        )}
      </div>
    </div>
  );
}
