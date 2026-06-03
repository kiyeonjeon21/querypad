"use client";

import dynamic from "next/dynamic";
import type { PipelineStep, PipelineExecutionResult } from "@/types/pipeline";

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
  loading: () => (
    <div className="h-full bg-gray-50 flex items-center justify-center text-xs text-gray-400">
      Loading...
    </div>
  ),
});

interface PipelineStepCardProps {
  step: PipelineStep;
  result?: PipelineExecutionResult;
  isSelected: boolean;
  onSelect: () => void;
  onUpdateName: (name: string) => void;
  onUpdateQuery: (query: string) => void;
  onRemove: () => void;
}

export default function PipelineStepCard({
  step,
  result,
  isSelected,
  onSelect,
  onUpdateName,
  onUpdateQuery,
  onRemove,
}: PipelineStepCardProps) {
  const statusColor = result
    ? result.error
      ? "border-red-400 bg-red-50"
      : "border-green-400 bg-green-50"
    : "border-gray-200 bg-white";

  return (
    <div
      onClick={onSelect}
      className={`rounded-lg border-2 transition-colors cursor-pointer ${
        isSelected ? "border-blue-500 ring-2 ring-blue-100" : statusColor
      }`}
    >
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-gray-100">
        <input
          value={step.name}
          onChange={(e) => onUpdateName(e.target.value.replace(/\s/g, "_"))}
          onClick={(e) => e.stopPropagation()}
          className="text-sm font-mono font-medium bg-transparent outline-none border-b border-transparent focus:border-blue-400 w-40"
          placeholder="step_name"
        />
        <div className="flex items-center gap-2">
          {result && !result.error && (
            <span className="text-[10px] text-green-600">{result.executionTimeMs}ms</span>
          )}
          {result?.error && (
            <span className="text-[10px] text-red-600" title={result.error.message}>err</span>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
            className="text-gray-400 hover:text-red-500 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>
      <div className="h-[100px]" onClick={(e) => e.stopPropagation()}>
        <MonacoEditor
          defaultLanguage="sql"
          value={step.query}
          onChange={(v) => onUpdateQuery(v ?? "")}
          theme="vs"
          options={{
            minimap: { enabled: false },
            fontSize: 11,
            lineNumbers: "off",
            scrollBeyondLastLine: false,
            wordWrap: "on",
            padding: { top: 4 },
            automaticLayout: true,
            folding: false,
            glyphMargin: false,
            lineDecorationsWidth: 4,
            overviewRulerLanes: 0,
          }}
        />
      </div>
    </div>
  );
}
