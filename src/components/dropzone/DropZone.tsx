"use client";

import { useCallback, useState } from "react";
import { loadFileAsTable } from "@/lib/duckdb/files";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useCollaborationStore } from "@/stores/collaboration-store";
import { broadcastFile } from "@/lib/collaboration/file-sync";
import UrlInput from "./UrlInput";

const ACCEPTED_EXTENSIONS = [".parquet", ".csv", ".tsv", ".json", ".jsonl", ".ndjson", ".xlsx"];

interface DropZoneProps {
  compact?: boolean;
  highlight?: boolean;
  onFilesAdded?: () => void;
}

export default function DropZone({ compact, highlight, onFilesAdded }: DropZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const addTable = useWorkspaceStore((s) => s.addTable);
  const roomId = useCollaborationStore((s) => s.roomId);

  const handleFiles = useCallback(
    async (files: FileList | File[]) => {
      setIsLoading(true);
      let addedAny = false;
      try {
        for (const file of Array.from(files)) {
          const ext = "." + file.name.split(".").pop()?.toLowerCase();
          if (!ACCEPTED_EXTENSIONS.includes(ext)) continue;
          const data = new Uint8Array(await file.arrayBuffer());
          const table = await loadFileAsTable(file);
          addTable(table, file.name, data);
          addedAny = true;
          // Broadcast to peers if in a room
          if (roomId) {
            broadcastFile(table.name, file.name, data);
          }
        }
      } catch (err) {
        console.error("File load error:", err);
      } finally {
        setIsLoading(false);
        if (addedAny) onFilesAdded?.();
      }
    },
    [addTable, roomId, onFilesAdded]
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
    },
    [handleFiles]
  );

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const onDragLeave = useCallback(() => setIsDragging(false), []);

  if (compact) {
    return (
      <label className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded cursor-pointer transition-colors ${
        highlight
          ? "text-blue-600 bg-blue-50 hover:bg-blue-100"
          : "text-gray-500 hover:text-gray-700 hover:bg-gray-100"
      }`}>
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
        </svg>
        Add file
        <input
          type="file"
          className="hidden"
          accept={ACCEPTED_EXTENSIONS.join(",")}
          multiple
          onChange={(e) => e.target.files && handleFiles(e.target.files)}
        />
      </label>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        className={`flex flex-col items-center justify-center w-full min-h-[350px] border-2 border-dashed rounded-xl transition-colors ${
          isDragging
            ? "border-blue-500 bg-blue-50"
            : "border-gray-300 bg-gray-50 hover:border-gray-400"
        }`}
      >
        {isLoading ? (
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-gray-500">Loading file...</p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-4 p-8">
            <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center">
              <svg className="w-8 h-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
              </svg>
            </div>
            <div className="text-center">
              <p className="text-lg font-medium text-gray-700">
                Drop your data files here
              </p>
              <p className="text-sm text-gray-500 mt-1">
                Parquet, CSV, JSON, Excel files supported
              </p>
            </div>
            <label className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 cursor-pointer transition-colors">
              Browse files
              <input
                type="file"
                className="hidden"
                accept={ACCEPTED_EXTENSIONS.join(",")}
                multiple
                onChange={(e) => e.target.files && handleFiles(e.target.files)}
              />
            </label>
          </div>
        )}
      </div>
      <div className="text-center">
        <p className="text-xs text-gray-400 mb-2">or paste a URL</p>
        <UrlInput />
      </div>
    </div>
  );
}
