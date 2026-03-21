"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { buildSchemaContext } from "@/lib/ai/schema-context";
import { generateSql } from "@/lib/ai/generate-sql";
import { getApiKey, setApiKey, clearApiKey } from "@/lib/ai/api-key";

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
  const [apiKey, setApiKeyState] = useState<string | null>(null);
  const [keyInput, setKeyInput] = useState("");
  const [showKeyForm, setShowKeyForm] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const keyInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef(false);

  useEffect(() => {
    setApiKeyState(getApiKey());
  }, []);

  useEffect(() => {
    if (apiKey && !showKeyForm) {
      inputRef.current?.focus();
    } else {
      keyInputRef.current?.focus();
    }
  }, [apiKey, showKeyForm]);

  const handleSaveKey = useCallback(() => {
    const trimmed = keyInput.trim();
    if (!trimmed) return;
    setApiKey(trimmed);
    setApiKeyState(trimmed);
    setKeyInput("");
    setShowKeyForm(false);
    setError(null);
  }, [keyInput]);

  const handleChangeKey = useCallback(() => {
    setShowKeyForm(true);
    setKeyInput("");
    setError(null);
  }, []);

  const handleGenerate = useCallback(async () => {
    if (!prompt.trim() || isGenerating || !apiKey) return;
    setIsGenerating(true);
    setGeneratedSql("");
    setError(null);
    abortRef.current = false;

    try {
      const schema = buildSchemaContext(tables);
      let sql = "";
      for await (const chunk of generateSql(apiKey, prompt, schema)) {
        if (abortRef.current) break;
        sql += chunk;
        setGeneratedSql(sql);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      if (message.includes("Invalid API key")) {
        clearApiKey();
        setApiKeyState(null);
      }
    } finally {
      setIsGenerating(false);
    }
  }, [prompt, tables, isGenerating, apiKey]);

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

  const handleKeyInputKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleSaveKey();
      }
      if (e.key === "Escape") {
        onClose();
      }
    },
    [handleSaveKey, onClose]
  );

  // Show key input form
  if (!apiKey || showKeyForm) {
    return (
      <div className="border-b border-gray-200 bg-purple-50 px-3 py-2">
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4 text-purple-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" />
          </svg>
          <input
            ref={keyInputRef}
            type="password"
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            onKeyDown={handleKeyInputKeyDown}
            placeholder="Enter your Anthropic API key (sk-ant-...)"
            className="flex-1 px-2 py-1 text-sm border border-purple-200 rounded bg-white focus:outline-none focus:ring-2 focus:ring-purple-400 focus:border-transparent font-mono"
          />
          <button
            onClick={handleSaveKey}
            disabled={!keyInput.trim()}
            className="px-3 py-1 text-xs font-medium bg-purple-600 text-white rounded hover:bg-purple-700 disabled:opacity-50 transition-colors"
          >
            Save Key
          </button>
          <button
            onClick={showKeyForm ? () => setShowKeyForm(false) : onClose}
            className="px-2 py-1 text-xs text-gray-500 hover:text-gray-700 transition-colors"
          >
            {showKeyForm ? "Cancel" : "Esc"}
          </button>
        </div>
        <p className="mt-1.5 text-xs text-gray-500">
          Your key is stored only in this browser and never sent to our servers.{" "}
          <a
            href="https://console.anthropic.com/settings/keys"
            target="_blank"
            rel="noopener noreferrer"
            className="text-purple-600 hover:underline"
          >
            Get an API key
          </a>
        </p>
        {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      </div>
    );
  }

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
          onClick={handleChangeKey}
          className="px-2 py-1 text-xs text-gray-400 hover:text-gray-600 transition-colors"
          title="Change API key"
        >
          Key
        </button>
        <button
          onClick={onClose}
          className="px-2 py-1 text-xs text-gray-500 hover:text-gray-700 transition-colors"
        >
          Esc
        </button>
      </div>
      {error && (
        <div className="mt-1 flex items-center gap-2">
          <p className="text-xs text-red-600">{error}</p>
          {error.includes("Invalid API key") && (
            <button
              onClick={handleChangeKey}
              className="text-xs text-purple-600 hover:underline"
            >
              Enter a new key
            </button>
          )}
        </div>
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
