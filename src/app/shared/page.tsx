"use client";

import { useEffect, useState, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import { getDB } from "@/lib/duckdb/instance";
import { decodeShare } from "@/lib/sharing/decode";
import { loadBufferAsTable } from "@/lib/duckdb/files";
import { useWorkspaceStore } from "@/stores/workspace-store";

const Workspace = dynamic(() => import("@/components/workspace/Workspace"), {
  ssr: false,
});

function SharedLoader() {
  const searchParams = useSearchParams();
  const encoded = searchParams.get("s");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const addTable = useWorkspaceStore((s) => s.addTable);
  const updateTab = useWorkspaceStore((s) => s.updateTab);
  const activeTabId = useWorkspaceStore((s) => s.activeTabId);
  const setDbReady = useWorkspaceStore((s) => s.setDbReady);

  useEffect(() => {
    if (!encoded) return;

    (async () => {
      try {
        await getDB();
        setDbReady(true);

        const shared = decodeShare(encoded);

        for (const entry of shared.tables) {
          const bufferCopy = new Uint8Array(entry.data);
          const table = await loadBufferAsTable(entry.name, entry.fileName, entry.data);
          addTable(table, entry.fileName, bufferCopy);
        }

        if (shared.query) updateTab(activeTabId, { query: shared.query });
        setLoading(false);
      } catch (err) {
        console.error("Failed to load shared data:", err);
        setError(err instanceof Error ? err.message : "Failed to decode shared data");
        setLoading(false);
      }
    })();
  }, [encoded, addTable, updateTab, activeTabId, setDbReady]);

  if (!encoded) {
    return (
      <div className="flex items-center justify-center h-screen bg-white">
        <div className="text-center">
          <p className="text-red-600 font-medium">Failed to load shared data</p>
          <p className="text-sm text-gray-500 mt-1">No shared data found in URL</p>
          <Link href="/" className="text-sm text-blue-600 hover:underline mt-4 inline-block">
            Go to QueryPad
          </Link>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-screen bg-white">
        <div className="text-center">
          <p className="text-red-600 font-medium">Failed to load shared data</p>
          <p className="text-sm text-gray-500 mt-1">{error}</p>
          <Link href="/" className="text-sm text-blue-600 hover:underline mt-4 inline-block">
            Go to QueryPad
          </Link>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-white">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-gray-500">Loading shared workspace...</p>
        </div>
      </div>
    );
  }

  return <Workspace />;
}

export default function SharedPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center h-screen bg-white">
          <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
        </div>
      }
    >
      <SharedLoader />
    </Suspense>
  );
}
