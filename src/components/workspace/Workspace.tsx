"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { usePathname } from "next/navigation";
import dynamic from "next/dynamic";
import { getDB } from "@/lib/duckdb/instance";
import { SAMPLE_TABLE_NAMES, checkFileSize } from "@/lib/constants";
import { loadBufferAsTable, loadFileAsTable } from "@/lib/duckdb/files";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useCollaborationStore } from "@/stores/collaboration-store";
import { connectToRoom } from "@/lib/collaboration/sync";
import { observeRemoteFiles } from "@/lib/collaboration/file-sync";
import Sidebar from "@/components/sidebar/Sidebar";
import SqlEditor from "@/components/editor/SqlEditor";
import TabBar from "@/components/editor/TabBar";
import ResultsPanel from "@/components/results/ResultsPanel";
import ShareButton from "@/components/share/ShareButton";
import DropZone from "@/components/dropzone/DropZone";
import RoomBar from "@/components/collaboration/RoomBar";
import JoinDialog from "@/components/collaboration/JoinDialog";
import CopyAgentContextButton from "./CopyAgentContextButton";

const PipelineEditor = dynamic(
  () => import("@/components/pipeline/PipelineEditor"),
  { ssr: false }
);
const PluginManager = dynamic(
  () => import("@/components/plugins/PluginManager"),
  { ssr: false }
);

export default function Workspace() {
  const dbReady = useWorkspaceStore((s) => s.dbReady);
  const setDbReady = useWorkspaceStore((s) => s.setDbReady);
  const tables = useWorkspaceStore((s) => s.tables);
  const _hydrated = useWorkspaceStore((s) => s._hydrated);
  const restoreFromIndexedDB = useWorkspaceStore(
    (s) => s.restoreFromIndexedDB
  );
  const clearWorkspace = useWorkspaceStore((s) => s.clearWorkspace);
  const viewMode = useWorkspaceStore((s) => s.viewMode);
  const setViewMode = useWorkspaceStore((s) => s.setViewMode);
  const pipelines = useWorkspaceStore((s) => s.pipelines);
  const activePipelineId = useWorkspaceStore((s) => s.activePipelineId);
  const addPipeline = useWorkspaceStore((s) => s.addPipeline);
  const setActivePipeline = useWorkspaceStore((s) => s.setActivePipeline);
  const removePipeline = useWorkspaceStore((s) => s.removePipeline);

  const roomId = useCollaborationStore((s) => s.roomId);
  const connecting = useCollaborationStore((s) => s.connecting);

  const pathname = usePathname();
  const isSharedPage = pathname === "/shared";

  const addTable = useWorkspaceStore((s) => s.addTable);
  const removeTable = useWorkspaceStore((s) => s.removeTable);
  const updateTab = useWorkspaceStore((s) => s.updateTab);
  const activeTabId = useWorkspaceStore((s) => s.activeTabId);

  const [showPluginManager, setShowPluginManager] = useState(false);
  const [showJoinDialog, setShowJoinDialog] = useState(false);
  const [preloading, setPreloading] = useState(false);
  const preloadAttempted = useRef(false);
  const [fileSizeAlert, setFileSizeAlert] = useState<{ type: "error" | "warning"; message: string } | null>(null);

  // Global drag-and-drop overlay
  const [showDropOverlay, setShowDropOverlay] = useState(false);
  const dragCounter = useRef(0);

  // Welcome banner
  const onlySampleTables =
    tables.length > 0 && tables.every((t) => SAMPLE_TABLE_NAMES.has(t.name));
  const [welcomeDismissed, setWelcomeDismissed] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("querypad:welcome-dismissed") === "1";
  });

  useEffect(() => {
    getDB()
      .then(() => setDbReady(true))
      .catch(console.error);
  }, [setDbReady]);

  useEffect(() => {
    if (dbReady && !_hydrated && !isSharedPage) {
      restoreFromIndexedDB();
    }
  }, [dbReady, _hydrated, isSharedPage, restoreFromIndexedDB]);

  // Preload sample data for first-time visitors only
  useEffect(() => {
    const alreadyPreloaded = localStorage.getItem("querypad:preloaded") === "1";
    if (!dbReady || !_hydrated || tables.length > 0 || isSharedPage || preloadAttempted.current || alreadyPreloaded) return;
    preloadAttempted.current = true;
    localStorage.setItem("querypad:preloaded", "1");

    const preload = async () => {
      setPreloading(true);
      try {
        const [empRes, deptRes] = await Promise.all([
          fetch("/sample/employees.csv"),
          fetch("/sample/departments.csv"),
        ]);
        const [empBuf, deptBuf] = await Promise.all([
          empRes.arrayBuffer().then((ab) => new Uint8Array(ab)),
          deptRes.arrayBuffer().then((ab) => new Uint8Array(ab)),
        ]);

        // Copy buffers before loadBufferAsTable — DuckDB's registerFileBuffer detaches the original
        const empBufCopy = new Uint8Array(empBuf);
        const deptBufCopy = new Uint8Array(deptBuf);

        const empTable = await loadBufferAsTable("employees", "employees.csv", empBuf);
        addTable(empTable, "employees.csv", empBufCopy);

        const deptTable = await loadBufferAsTable("departments", "departments.csv", deptBuf);
        addTable(deptTable, "departments.csv", deptBufCopy);

        // Prefill example query in active tab
        const sampleQuery = `SELECT d.dept_name, COUNT(*) as headcount, ROUND(AVG(e.salary)) as avg_salary
FROM employees e
JOIN departments d ON e.dept_id = d.dept_id
GROUP BY d.dept_name`;
        updateTab(activeTabId, { query: sampleQuery });
      } catch (err) {
        console.error("Failed to preload sample data:", err);
      } finally {
        setPreloading(false);
      }
    };

    preload();
  }, [dbReady, _hydrated, tables.length, isSharedPage, addTable, updateTab, activeTabId]);

  // Stable ref for onlySampleTables so native listeners always see current value
  const onlySampleTablesRef = useRef(onlySampleTables);
  onlySampleTablesRef.current = onlySampleTables;

  // Global drag-and-drop via native document listeners (works reliably across all browsers)
  useEffect(() => {
    if (isSharedPage) return;

    const onDragEnter = (e: DragEvent) => {
      e.preventDefault();
      dragCounter.current++;
      if (e.dataTransfer?.types.includes("Files")) {
        setShowDropOverlay(true);
      }
    };
    const onDragOver = (e: DragEvent) => {
      e.preventDefault();
    };
    const onDragLeave = (e: DragEvent) => {
      e.preventDefault();
      dragCounter.current--;
      if (dragCounter.current === 0) {
        setShowDropOverlay(false);
      }
    };
    const onDrop = async (e: DragEvent) => {
      e.preventDefault();
      dragCounter.current = 0;
      setShowDropOverlay(false);
      setFileSizeAlert(null);
      const files = e.dataTransfer?.files;
      if (!files?.length) return;
      const ACCEPTED = [".parquet", ".csv", ".tsv", ".json", ".jsonl", ".ndjson", ".xlsx"];
      const hadOnlySamples = onlySampleTablesRef.current;
      let addedAny = false;
      for (const file of Array.from(files)) {
        const ext = "." + file.name.split(".").pop()?.toLowerCase();
        if (!ACCEPTED.includes(ext)) continue;

        const sizeCheck = checkFileSize(file);
        if (sizeCheck?.type === "error") {
          setFileSizeAlert(sizeCheck);
          continue;
        }
        if (sizeCheck?.type === "warning") {
          setFileSizeAlert(sizeCheck);
        }

        try {
          const data = new Uint8Array(await file.arrayBuffer());
          const table = await loadFileAsTable(file);
          addTable(table, file.name, data);
          addedAny = true;
        } catch (err) {
          console.error("File load error:", err);
        }
      }
      if (hadOnlySamples && addedAny) {
        for (const name of SAMPLE_TABLE_NAMES) {
          removeTable(name);
        }
      }
    };

    document.addEventListener("dragenter", onDragEnter);
    document.addEventListener("dragover", onDragOver);
    document.addEventListener("dragleave", onDragLeave);
    document.addEventListener("drop", onDrop);
    return () => {
      document.removeEventListener("dragenter", onDragEnter);
      document.removeEventListener("dragover", onDragOver);
      document.removeEventListener("dragleave", onDragLeave);
      document.removeEventListener("drop", onDrop);
    };
  }, [isSharedPage, addTable, removeTable]);

  const dismissWelcome = useCallback(() => {
    setWelcomeDismissed(true);
    localStorage.setItem("querypad:welcome-dismissed", "1");
  }, []);

  const handleCreateRoom = useCallback(
    async (host: string) => {
      const id = crypto.randomUUID().slice(0, 8);
      try {
        await connectToRoom(id, host);
        observeRemoteFiles();
        setShowJoinDialog(false);
      } catch (err) {
        console.error("Failed to create room:", err);
      }
    },
    []
  );

  const handleJoinRoom = useCallback(
    async (id: string, host: string) => {
      try {
        await connectToRoom(id, host);
        observeRemoteFiles();
        setShowJoinDialog(false);
      } catch (err) {
        console.error("Failed to join room:", err);
      }
    },
    []
  );

  if (!dbReady) {
    return (
      <div className="flex items-center justify-center h-screen bg-white">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-gray-500">Initializing DuckDB...</p>
        </div>
      </div>
    );
  }

  if (!_hydrated && !isSharedPage) {
    return (
      <div className="flex items-center justify-center h-screen bg-white">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-gray-500">Restoring workspace...</p>
        </div>
      </div>
    );
  }

  if (tables.length === 0) {
    if (preloading) {
      return (
        <div className="flex items-center justify-center h-screen bg-white">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-gray-500">Loading sample data...</p>
          </div>
        </div>
      );
    }
    return (
      <div className="flex flex-col h-screen bg-white">
        <header className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
          <h1 className="text-lg font-bold text-gray-800">QueryPad</h1>
          <a
            href="https://github.com/vericontext/querypad"
            target="_blank"
            rel="noopener noreferrer"
            className="p-1 text-gray-400 hover:text-gray-600 transition-colors"
            title="GitHub"
          >
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/></svg>
          </a>
        </header>
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="w-full max-w-lg">
            <DropZone />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-white">
      <header className="flex items-center justify-between px-4 py-2 border-b border-gray-200 shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-bold text-gray-800">QueryPad</h1>
          {/* SQL / Pipeline mode toggle */}
          <div className="flex gap-0.5 p-0.5 bg-gray-100 rounded-md">
            <button
              onClick={() => setViewMode("sql")}
              className={`px-2 py-0.5 text-[11px] rounded transition-colors ${
                viewMode === "sql"
                  ? "bg-white text-gray-800 font-medium shadow-sm"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              SQL
            </button>
            <button
              onClick={() => {
                setViewMode("pipeline");
                if (pipelines.length === 0) addPipeline();
              }}
              className={`px-2 py-0.5 text-[11px] rounded transition-colors ${
                viewMode === "pipeline"
                  ? "bg-white text-gray-800 font-medium shadow-sm"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              Pipeline
            </button>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Collaboration */}
          {roomId ? (
            <RoomBar />
          ) : (
            <button
              onClick={() => setShowJoinDialog(true)}
              className="px-2 py-1 text-[11px] text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
            >
              Collaborate
            </button>
          )}
          {/* Plugin manager */}
          <button
            onClick={() => setShowPluginManager(true)}
            className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors"
            title="Plugins"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
          <button
            onClick={() => clearWorkspace()}
            className="px-2.5 py-1 text-xs text-gray-500 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
          >
            Clear
          </button>
          <CopyAgentContextButton />
          <ShareButton />
          <a
            href="https://github.com/vericontext/querypad"
            target="_blank"
            rel="noopener noreferrer"
            className="p-1 text-gray-400 hover:text-gray-600 transition-colors"
            title="GitHub"
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/></svg>
          </a>
        </div>
      </header>

      {onlySampleTables && !welcomeDismissed && !isSharedPage && (
        <div className="flex items-center justify-between px-4 py-2 bg-blue-50 border-b border-blue-100 text-sm text-blue-700">
          <span>Exploring with sample data — drop your own files anywhere to get started</span>
          <button
            onClick={dismissWelcome}
            className="ml-4 p-0.5 text-blue-400 hover:text-blue-600 transition-colors"
            aria-label="Dismiss"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      <div className="flex flex-1 min-h-0">
        <Sidebar />
        <div className="flex-1 flex flex-col min-w-0">
          {viewMode === "sql" ? (
            <>
              <TabBar />
              <div className="h-[45%] min-h-[120px] border-b border-gray-200">
                <SqlEditor />
              </div>
              <div className="flex-1 min-h-0">
                <ResultsPanel />
              </div>
            </>
          ) : (
            <>
              {/* Pipeline tab bar */}
              <div className="flex items-center border-b border-gray-200 bg-gray-50 overflow-x-auto shrink-0">
                {pipelines.map((p) => (
                  <div
                    key={p.id}
                    onClick={() => setActivePipeline(p.id)}
                    className={`group flex items-center gap-1 px-3 py-1.5 text-xs cursor-pointer border-r border-gray-200 shrink-0 select-none ${
                      p.id === activePipelineId
                        ? "bg-white text-gray-800 border-b-2 border-b-blue-500 font-medium"
                        : "text-gray-500 hover:bg-gray-100"
                    }`}
                  >
                    <span className="max-w-[120px] truncate">{p.title}</span>
                    {pipelines.length > 1 && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          removePipeline(p.id);
                        }}
                        className="opacity-0 group-hover:opacity-100 ml-1 text-gray-400 hover:text-gray-700 transition-opacity"
                      >
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    )}
                  </div>
                ))}
                <button
                  onClick={addPipeline}
                  className="flex items-center justify-center w-7 h-7 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded transition-colors shrink-0 mx-1"
                  title="New pipeline"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                  </svg>
                </button>
              </div>
              <div className="flex-1 min-h-0">
                <PipelineEditor />
              </div>
            </>
          )}
        </div>
      </div>

      {/* Global drop indicator — subtle border highlight */}
      {showDropOverlay && (
        <div className="fixed inset-0 z-50 pointer-events-none border-3 border-blue-400 rounded-lg m-1 transition-opacity" />
      )}

      {/* File size alert toast */}
      {fileSizeAlert && (
        <div className="fixed bottom-4 right-4 z-50 max-w-sm animate-in fade-in slide-in-from-bottom-2">
          <div className={`flex items-start gap-2 px-4 py-3 rounded-lg shadow-lg text-sm ${
            fileSizeAlert.type === "error"
              ? "bg-red-50 text-red-700 border border-red-200"
              : "bg-amber-50 text-amber-700 border border-amber-200"
          }`}>
            <span className="shrink-0 mt-0.5">{fileSizeAlert.type === "error" ? "⚠" : "⚡"}</span>
            <span className="flex-1">{fileSizeAlert.message}</span>
            <button
              onClick={() => setFileSizeAlert(null)}
              className="shrink-0 p-0.5 hover:opacity-70"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Modals */}
      {showPluginManager && (
        <PluginManager onClose={() => setShowPluginManager(false)} />
      )}
      {showJoinDialog && (
        <JoinDialog
          onJoin={handleJoinRoom}
          onCreate={handleCreateRoom}
          onClose={() => setShowJoinDialog(false)}
          connecting={connecting}
        />
      )}
    </div>
  );
}
