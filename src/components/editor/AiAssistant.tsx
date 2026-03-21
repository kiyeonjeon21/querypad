"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { buildSchemaContext } from "@/lib/ai/schema-context";
import { generateSql } from "@/lib/ai/generate-sql";

interface AiAssistantProps {
  onAccept: (sql: string) => void;
  onClose: () => void;
  currentQuery: string;
}

export default function AiAssistant({
  onAccept,
  onClose,
  currentQuery,
}: AiAssistantProps) {
  const tables = useWorkspaceStore((s) => s.tables);
  const [prompt, setPrompt] = useState("");
  const [generatedSql, setGeneratedSql] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef(false);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleGenerate = useCallback(async () => {
    if (!prompt.trim() || isGenerating) return;
    setIsGenerating(true);
    setGeneratedSql("");
    setError(null);
    abortRef.current = false;

    try {
      const schema = buildSchemaContext(tables);
      let sql = "";
      for await (const chunk of generateSql(prompt, schema)) {
        if (abortRef.current) break;
        sql += chunk;
        setGeneratedSql(sql);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsGenerating(false);
    }
  }, [prompt, tables, isGenerating]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleGenerate();
      }
      if (e.key === "Escape") {
        abortRef.current = true;
        onClose();
      }
    },
    [handleGenerate, onClose]
  );

  return (
    <div className="border-b border-gray-200 bg-purple-50 px-3 py-2">
      <div className="flex items-center gap-2">
        <svg className="w-4 h-4 text-purple-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
        </svg>
        <input
          ref={inputRef}
          type="text"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Describe the SQL you want..."
          className="flex-1 px-2 py-1 text-sm border border-purple-200 rounded bg-white focus:outline-none focus:ring-2 focus:ring-purple-400 focus:border-transparent"
          disabled={isGenerating}
        />
        <button
          onClick={handleGenerate}
          disabled={isGenerating || !prompt.trim()}
          className="px-3 py-1 text-xs font-medium bg-purple-600 text-white rounded hover:bg-purple-700 disabled:opacity-50 transition-colors"
        >
          {isGenerating ? "Generating..." : "Generate"}
        </button>
        <button
          onClick={onClose}
          className="px-2 py-1 text-xs text-gray-500 hover:text-gray-700 transition-colors"
        >
          Esc
        </button>
      </div>
      {error && (
        <p className="mt-1 text-xs text-red-600">{error}</p>
      )}
      {generatedSql && (
        <div className="mt-2">
          <pre className="p-2 bg-white border border-purple-200 rounded text-xs font-mono whitespace-pre-wrap text-gray-800 max-h-[120px] overflow-auto">
            {generatedSql}
            {isGenerating && <span className="animate-pulse">|</span>}
          </pre>
          {!isGenerating && (
            <div className="flex items-center gap-2 mt-1.5">
              <button
                onClick={() => onAccept(generatedSql)}
                className="px-3 py-1 text-xs font-medium bg-green-600 text-white rounded hover:bg-green-700 transition-colors"
              >
                Accept
              </button>
              <button
                onClick={() => {
                  onAccept(
                    currentQuery
                      ? currentQuery + "\n" + generatedSql
                      : generatedSql
                  );
                }}
                className="px-3 py-1 text-xs font-medium text-gray-600 bg-gray-100 rounded hover:bg-gray-200 transition-colors"
              >
                Append
              </button>
              <button
                onClick={() => {
                  setGeneratedSql("");
                  setPrompt("");
                  inputRef.current?.focus();
                }}
                className="px-3 py-1 text-xs text-gray-500 hover:text-gray-700 transition-colors"
              >
                Discard
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
