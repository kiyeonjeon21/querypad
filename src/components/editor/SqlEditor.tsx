"use client";

import { useCallback, useRef, useState, useEffect } from "react";
import dynamic from "next/dynamic";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useCollaborationStore } from "@/stores/collaboration-store";
import { executeQuery } from "@/lib/duckdb/queries";
import AiAssistant from "./AiAssistant";
import PeerCursors from "@/components/collaboration/PeerCursors";

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-full bg-gray-50 text-sm text-gray-400">
      Loading editor...
    </div>
  ),
});

export default function SqlEditor() {
  const activeTabId = useWorkspaceStore((s) => s.activeTabId);
  const activeTab = useWorkspaceStore((s) =>
    s.tabs.find((t) => t.id === s.activeTabId)
  );
  const updateTab = useWorkspaceStore((s) => s.updateTab);
  const tables = useWorkspaceStore((s) => s.tables);
  const roomId = useCollaborationStore((s) => s.roomId);
  const editorRef = useRef<unknown>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bindingRef = useRef<any>(null);
  const [showAi, setShowAi] = useState(false);

  const query = activeTab?.query ?? "";
  const isExecuting = activeTab?.isExecuting ?? false;

  const runQuery = useCallback(async () => {
    const q = query.trim();
    if (!q) return;
    updateTab(activeTabId, { isExecuting: true, error: null });
    try {
      const result = await executeQuery(q);
      updateTab(activeTabId, { result, error: null, isExecuting: false });
    } catch (err) {
      updateTab(activeTabId, {
        error: { message: err instanceof Error ? err.message : String(err) },
        result: null,
        isExecuting: false,
      });
    }
  }, [query, activeTabId, updateTab]);

  // Setup y-monaco binding when in a collaboration room
  useEffect(() => {
    if (!roomId || !editorRef.current) return;

    let cancelled = false;

    (async () => {
      try {
        const { getYTextForTab, getAwareness } = await import(
          "@/lib/collaboration/sync"
        );
        const { MonacoBinding } = await import("y-monaco");

        if (cancelled) return;

        const yText = getYTextForTab(activeTabId);
        const awareness = getAwareness();
        if (!yText || !awareness) return;

        // Initialize Y.Text with current query if empty
        if (yText.length === 0 && query) {
          yText.insert(0, query);
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const editor = editorRef.current as any;
        const model = editor.getModel();
        if (!model) return;

        bindingRef.current = new MonacoBinding(
          yText,
          model,
          new Set([editor]),
          awareness
        );
      } catch (err) {
        console.error("Failed to setup y-monaco binding:", err);
      }
    })();

    return () => {
      cancelled = true;
      if (bindingRef.current) {
        bindingRef.current.destroy();
        bindingRef.current = null;
      }
    };
  }, [roomId, activeTabId]);

  const handleMount = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (editor: any, monaco: any) => {
      editorRef.current = editor;

      editor.addAction({
        id: "run-query",
        label: "Run Query",
        keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter],
        run: () => runQuery(),
      });

      editor.addAction({
        id: "ai-assist",
        label: "AI SQL Assistant",
        keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyK],
        run: () => setShowAi((v) => !v),
      });

      monaco.languages.registerCompletionItemProvider("sql", {
        provideCompletionItems: () => {
          const suggestions = tables.flatMap((t) => [
            {
              label: t.name,
              kind: 1,
              insertText: t.name,
              detail: "table",
            },
            ...t.columns.map((c) => ({
              label: c.name,
              kind: 5,
              insertText: c.name,
              detail: `${t.name}.${c.type}`,
            })),
          ]);
          return { suggestions };
        },
      });
    },
    [runQuery, tables]
  );

  const handleAiAccept = useCallback(
    (sql: string) => {
      updateTab(activeTabId, { query: sql });
      setShowAi(false);
    },
    [activeTabId, updateTab]
  );

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-gray-200 bg-white">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
            SQL Editor
          </span>
          <button
            onClick={() => setShowAi((v) => !v)}
            className="flex items-center gap-1 px-2 py-0.5 text-[10px] text-purple-600 bg-purple-50 hover:bg-purple-100 rounded transition-colors"
            title="AI SQL Assistant (Cmd+K)"
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
            </svg>
            AI
            <span className="opacity-60">&#8984;K</span>
          </button>
          {roomId && <PeerCursors />}
        </div>
        <button
          onClick={runQuery}
          disabled={isExecuting || !query.trim()}
          className="flex items-center gap-1.5 px-3 py-1 bg-green-600 text-white text-xs font-medium rounded hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {isExecuting ? (
            <div className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin" />
          ) : (
            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
              <path d="M6.3 2.8A1.5 1.5 0 004 4.1v11.8a1.5 1.5 0 002.3 1.3l9-5.9a1.5 1.5 0 000-2.6l-9-5.9z" />
            </svg>
          )}
          Run
          <span className="text-[10px] opacity-70 ml-1">&#8984;&#8629;</span>
        </button>
      </div>
      {showAi && (
        <AiAssistant
          onAccept={handleAiAccept}
          onClose={() => setShowAi(false)}
          currentQuery={query}
        />
      )}
      <div className="flex-1 min-h-0">
        <MonacoEditor
          key={activeTabId}
          defaultLanguage="sql"
          value={query}
          onChange={(v) => updateTab(activeTabId, { query: v ?? "" })}
          onMount={handleMount}
          theme="vs"
          options={{
            minimap: { enabled: false },
            fontSize: 13,
            lineNumbers: "on",
            scrollBeyondLastLine: false,
            wordWrap: "on",
            padding: { top: 8 },
            automaticLayout: true,
          }}
        />
      </div>
    </div>
  );
}
