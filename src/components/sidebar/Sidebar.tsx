"use client";

import { useCallback, useState } from "react";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { SAMPLE_TABLE_NAMES } from "@/lib/constants";
import TableSchema from "./TableSchema";
import ProfileDrawer from "./ProfileDrawer";
import RelationshipsPanel from "./RelationshipsPanel";
import DropZone from "@/components/dropzone/DropZone";

export default function Sidebar() {
  const tables = useWorkspaceStore((s) => s.tables);
  const removeTable = useWorkspaceStore((s) => s.removeTable);
  const [profileTableName, setProfileTableName] = useState<string | null>(null);
  const [showRelationships, setShowRelationships] = useState(false);
  const onlySampleTables =
    tables.length > 0 && tables.every((t) => SAMPLE_TABLE_NAMES.has(t.name));
  const visibleProfileTableName =
    profileTableName && tables.some((t) => t.name === profileTableName)
      ? profileTableName
      : null;

  const handleFilesAdded = useCallback(() => {
    if (onlySampleTables) {
      for (const name of SAMPLE_TABLE_NAMES) {
        removeTable(name);
      }
    }
  }, [onlySampleTables, removeTable]);

  const handleRemove = useCallback(
    (name: string) => {
      if (profileTableName === name) setProfileTableName(null);
      removeTable(name);
    },
    [profileTableName, removeTable]
  );

  return (
    <div className="flex h-full shrink-0">
      <div className="w-60 border-r border-gray-200 bg-white flex flex-col h-full">
        <div className="px-3 py-2 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
            Tables
          </h2>
          <DropZone compact highlight={onlySampleTables} onFilesAdded={handleFilesAdded} />
        </div>
        <button
          onClick={() => setShowRelationships((v) => !v)}
          className={`mx-2 my-1 flex items-center gap-1.5 rounded px-2 py-1 text-[11px] transition-colors ${
            showRelationships
              ? "text-green-700 bg-green-50"
              : "text-gray-500 hover:text-green-600 hover:bg-green-50"
          }`}
          aria-label="Relationships"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H17a3 3 0 010 6h-3.5M10.5 18H7a3 3 0 010-6h3.5M8 15h8" />
          </svg>
          Relationships
        </button>
        <div className="flex-1 overflow-y-auto py-1">
          {tables.length === 0 ? (
            <p className="px-3 py-4 text-xs text-gray-400 text-center">
              No tables loaded
            </p>
          ) : (
            tables.map((t) => (
              <TableSchema
                key={t.name}
                table={t}
                onRemove={handleRemove}
                onOpenProfile={setProfileTableName}
                profileActive={visibleProfileTableName === t.name}
              />
            ))
          )}
        </div>
      </div>
      {visibleProfileTableName && (
        <ProfileDrawer
          tableName={visibleProfileTableName}
          onClose={() => setProfileTableName(null)}
        />
      )}
      {showRelationships && (
        <RelationshipsPanel onClose={() => setShowRelationships(false)} />
      )}
    </div>
  );
}
