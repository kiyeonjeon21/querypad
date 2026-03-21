"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import { getDB } from "@/lib/duckdb/instance";
import { decodeSharePayload, decodeTableData } from "@/lib/sharing/decode";
import { loadBufferAsTable } from "@/lib/duckdb/files";
import { useWorkspaceStore } from "@/stores/workspace-store";

const Workspace = dynamic(() => import("@/components/workspace/Workspace"), {
  ssr: false,
});

function SharedLoader() {
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const addTable = useWorkspaceStore((s) => s.addTable);
  const updateTab = useWorkspaceStore((s) => s.updateTab);
  const activeTabId = useWorkspaceStore((s) => s.activeTabId);
  const setDbReady = useWorkspaceStore((s) => s.setDbReady);

  useEffect(() => {
    const encoded = searchParams.get("s");
    if (!encoded) {
      setError("No shared data found in URL");
      setLoading(false);
      return;
    }

    (async () => {
      try {
        await getDB();
        setDbReady(true);

        const payload = decodeSharePayload(encoded);

        for (const meta of payload.t) {
          const dataB64 = payload.d[meta.name];
          if (!dataB64) continue;
          const buffer = decodeTableData(dataB64);
          const bufferCopy = new Uint8Array(buffer);
          const table = await loadBufferAsTable(meta.name, meta.fileName, buffer);
          addTable(table, meta.fileName, bufferCopy);
        }

        if (payload.q) updateTab(activeTabId, { query: payload.q });
        setLoading(false);
      } catch (err) {
        console.error("Failed to load shared data:", err);
        setError(err instanceof Error ? err.message : "Failed to decode shared data");
        setLoading(false);
      }
    })();
  }, [searchParams, addTable, updateTab, activeTabId, setDbReady]);

  if (error) {
    return (
      <div className="flex items-center justify-center h-screen bg-white">
        <div className="text-center">
          <p className="text-red-600 font-medium">Failed to load shared data</p>
          <p className="text-sm text-gray-500 mt-1">{error}</p>
          <a href="/" className="text-sm text-blue-600 hover:underline mt-4 inline-block">
            Go to QueryPad
          </a>
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
