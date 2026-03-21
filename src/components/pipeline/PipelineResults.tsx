"use client";

import dynamic from "next/dynamic";
import type { PipelineExecutionResult } from "@/types/pipeline";

const DataTable = dynamic(() => import("@/components/results/DataTable"), {
  ssr: false,
});

interface PipelineResultsProps {
  stepName: string;
  result: PipelineExecutionResult | null;
}

export default function PipelineResults({
  stepName,
  result,
}: PipelineResultsProps) {
  if (!result) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-gray-400">
        Run the pipeline to see results
      </div>
    );
  }

  if (result.error) {
    return (
      <div className="p-4 h-full">
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-sm font-medium text-red-800">
            Step &quot;{stepName}&quot; Error
          </p>
          <pre className="mt-1 text-xs text-red-600 whitespace-pre-wrap font-mono">
            {result.error.message}
          </pre>
        </div>
      </div>
    );
  }

  if (!result.result) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-gray-400">
        No results
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-3 py-1.5 border-b border-gray-200 text-xs text-gray-500">
        <span className="font-mono font-medium text-gray-700">{stepName}</span>
        <span className="text-gray-300">|</span>
        <span>{result.result.rowCount.toLocaleString()} rows</span>
        <span className="text-gray-300">|</span>
        <span>{result.executionTimeMs}ms</span>
      </div>
      <div className="flex-1 min-h-0">
        <DataTable result={result.result} />
      </div>
    </div>
  );
}
