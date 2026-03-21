"use client";

import { useState, useCallback } from "react";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { buildShareUrl } from "@/lib/sharing/encode";
import { formatBytes } from "@/lib/utils";

const SIZE_LIMIT = 100 * 1024; // 100KB

export default function ShareButton() {
  const query = useWorkspaceStore((s) => {
    const tab = s.tabs.find((t) => t.id === s.activeTabId);
    return tab?.query ?? "";
  });
  const fileEntries = useWorkspaceStore((s) => s.fileEntries);
  const tables = useWorkspaceStore((s) => s.tables);
  const [copied, setCopied] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);

  const handleShare = useCallback(async () => {
    if (!query.trim() && tables.length === 0) return;

    const tableData = fileEntries.map((f) => ({
      name: f.name,
      fileName: f.fileName,
      data: f.data,
    }));

    const { url, totalSize } = buildShareUrl(query, tableData);

    if (totalSize > SIZE_LIMIT) {
      setWarning(
        `Total file size (${formatBytes(totalSize)}) exceeds ${formatBytes(SIZE_LIMIT)}. The URL may be too long for some browsers.`
      );
    }

    if (url.length > 8000) {
      setWarning(
        `Generated URL is ${formatBytes(url.length)} which may exceed browser limits. Consider using smaller datasets.`
      );
    }

    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      setWarning(null);
    } catch {
      prompt("Copy this URL:", url);
    }
  }, [query, fileEntries, tables]);

  return (
    <div className="relative">
      <button
        onClick={handleShare}
        disabled={!query.trim() && tables.length === 0}
        className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m9.86-2.753a4.5 4.5 0 00-1.242-7.244l-4.5-4.5a4.5 4.5 0 00-6.364 6.364L4.343 8.04" />
        </svg>
        {copied ? "Copied!" : "Share"}
      </button>
      {warning && (
        <div className="absolute top-full right-0 mt-2 p-2 bg-amber-50 border border-amber-200 rounded text-xs text-amber-700 w-64 z-20">
          {warning}
        </div>
      )}
    </div>
  );
}
