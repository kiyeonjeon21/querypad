"use client";

import { useState, useCallback } from "react";
import dynamic from "next/dynamic";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { executePipeline } from "@/lib/pipeline/execute";
import PipelineStepCard from "./PipelineStepCard";
import PipelineResults from "./PipelineResults";

const PipelineDag = dynamic(() => import("./PipelineDag"), { ssr: false });

export default function PipelineEditor() {
  const activePipeline = useWorkspaceStore((s) =>
    s.pipelines.find((p) => p.id === s.activePipelineId)
  );
  const addPipelineStep = useWorkspaceStore((s) => s.addPipelineStep);
  const removePipelineStep = useWorkspaceStore((s) => s.removePipelineStep);
  const updatePipelineStep = useWorkspaceStore((s) => s.updatePipelineStep);
  const pipelineResults = useWorkspaceStore((s) => s.pipelineResults);
  const setPipelineResults = useWorkspaceStore((s) => s.setPipelineResults);
  const tables = useWorkspaceStore((s) => s.tables);

  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);

  const handleRun = useCallback(async () => {
    if (!activePipeline) return;
    setIsRunning(true);
    try {
      const results = await executePipeline(activePipeline.steps);
      const map: Record<string, (typeof results)[0]> = {};
      for (const r of results) {
        map[r.stepId] = r;
      }
      setPipelineResults(map);
    } finally {
      setIsRunning(false);
    }
  }, [activePipeline, setPipelineResults]);

  if (!activePipeline) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-gray-400">
        Select or create a pipeline
      </div>
    );
  }

  const steps = activePipeline.steps;
  const selectedStep = steps.find((s) => s.id === selectedStepId);

  // Check for name conflicts with loaded tables
  const tableNames = new Set(tables.map((t) => t.name.toLowerCase()));
  const nameConflicts = steps
    .filter((s) => s.name && tableNames.has(s.name.toLowerCase()))
    .map((s) => s.name);

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-gray-200 bg-white shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
            Pipeline
          </span>
          <span className="text-xs text-gray-400 font-mono">
            {activePipeline.title}
          </span>
          {nameConflicts.length > 0 && (
            <span className="text-[10px] text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">
              Name conflict: {nameConflicts.join(", ")}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => addPipelineStep(activePipeline.id)}
            className="px-2 py-1 text-xs text-gray-600 hover:bg-gray-100 rounded transition-colors"
          >
            + Add Step
          </button>
          <button
            onClick={handleRun}
            disabled={isRunning || steps.length === 0}
            className="flex items-center gap-1.5 px-3 py-1 bg-green-600 text-white text-xs font-medium rounded hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isRunning ? (
              <div className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                <path d="M6.3 2.8A1.5 1.5 0 004 4.1v11.8a1.5 1.5 0 002.3 1.3l9-5.9a1.5 1.5 0 000-2.6l-9-5.9z" />
              </svg>
            )}
            Run Pipeline
          </button>
        </div>
      </div>

      {/* Main content */}
      <div className="flex flex-1 min-h-0">
        {/* Left: Step list */}
        <div className="w-80 border-r border-gray-200 overflow-y-auto p-3 flex flex-col gap-3 shrink-0">
          {steps.length === 0 ? (
            <div className="text-center text-sm text-gray-400 py-8">
              No steps yet. Click &quot;+ Add Step&quot;.
            </div>
          ) : (
            steps.map((step) => (
              <PipelineStepCard
                key={step.id}
                step={step}
                result={pipelineResults[step.id]}
                isSelected={step.id === selectedStepId}
                onSelect={() => setSelectedStepId(step.id)}
                onUpdateName={(name) =>
                  updatePipelineStep(activePipeline.id, step.id, { name })
                }
                onUpdateQuery={(query) =>
                  updatePipelineStep(activePipeline.id, step.id, { query })
                }
                onRemove={() =>
                  removePipelineStep(activePipeline.id, step.id)
                }
              />
            ))
          )}
        </div>

        {/* Center: DAG */}
        <div className="flex-1 min-w-0">
          <div className="h-[50%] border-b border-gray-200">
            <PipelineDag
              steps={steps}
              results={pipelineResults}
              selectedStepId={selectedStepId}
              onSelectStep={setSelectedStepId}
            />
          </div>
          <div className="h-[50%]">
            <PipelineResults
              stepName={selectedStep?.name ?? ""}
              result={selectedStep ? pipelineResults[selectedStep.id] ?? null : null}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
