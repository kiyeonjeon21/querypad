"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { usePathname } from "next/navigation";
import dynamic from "next/dynamic";
import { getDB } from "@/lib/duckdb/instance";
import { loadBufferAsTable } from "@/lib/duckdb/files";
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
  const updateTab = useWorkspaceStore((s) => s.updateTab);
  const activeTabId = useWorkspaceStore((s) => s.activeTabId);

  const [showPluginManager, setShowPluginManager] = useState(false);
  const [showJoinDialog, setShowJoinDialog] = useState(false);
  const [preloading, setPreloading] = useState(false);
  const preloadAttempted = useRef(false);

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

  // Preload sample data for first-time visitors
  useEffect(() => {
    if (!dbReady || !_hydrated || tables.length > 0 || isSharedPage || preloadAttempted.current) return;
    preloadAttempted.current = true;

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

        const empTable = await loadBufferAsTable("employees", "employees.csv", empBuf);
        addTable(empTable, "employees.csv", empBuf);

        const deptTable = await loadBufferAsTable("departments", "departments.csv", deptBuf);
        addTable(deptTable, "departments.csv", deptBuf);

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
          <ShareButton />
        </div>
      </header>

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
