"use client";

import { useState, useCallback } from "react";
import { loadRemoteFileAsTable } from "@/lib/duckdb/remote";
import { useWorkspaceStore } from "@/stores/workspace-store";

export default function UrlInput() {
  const [url, setUrl] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const addTable = useWorkspaceStore((s) => s.addTable);

  const handleLoad = useCallback(async () => {
    const trimmed = url.trim();
    if (!trimmed) return;

    setIsLoading(true);
    setError(null);
    try {
      const { table, fileName, data } = await loadRemoteFileAsTable(trimmed);
      addTable(table, fileName, data);
      setUrl("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }, [url, addTable]);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleLoad()}
          placeholder="https://example.com/data.parquet"
          className="flex-1 px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          disabled={isLoading}
        />
        <button
          onClick={handleLoad}
          disabled={isLoading || !url.trim()}
          className="px-4 py-1.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shrink-0"
        >
          {isLoading ? (
            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
          ) : (
            "Load"
          )}
        </button>
      </div>
      {error && (
        <p className="text-xs text-red-600">{error}</p>
      )}
    </div>
  );
}
