"use client";

import { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import { useWorkspaceStore } from "@/stores/workspace-store";
import DataTable from "./DataTable";
import ExportButton from "./ExportButton";
import ChartConfigPanel from "./ChartConfig";
import { detectChartConfig } from "@/lib/charts/detect";
import type { ChartConfig } from "@/lib/charts/detect";
import PluginVisualization from "@/components/plugins/PluginVisualization";

const ChartPanel = dynamic(() => import("./ChartPanel"), { ssr: false });

type Tab = "table" | "chart" | string; // string for plugin viz tabs

export default function ResultsPanel() {
  const activeTab = useWorkspaceStore((s) =>
    s.tabs.find((t) => t.id === s.activeTabId)
  );
  const plugins = useWorkspaceStore((s) => s.plugins);
  const result = activeTab?.result ?? null;
  const error = activeTab?.error ?? null;
  const isExecuting = activeTab?.isExecuting ?? false;

  const [viewTab, setViewTab] = useState<Tab>("table");
  const [chartConfig, setChartConfig] = useState<ChartConfig | null>(null);

  // Collect plugin visualizations
  const pluginVizTabs = plugins.flatMap((p) =>
    p.manifest.extensions
      .filter((ext) => ext.type === "visualization")
      .map((ext) => ({
        key: `plugin-${p.manifest.id}`,
        label: p.manifest.name,
        pluginName: p.manifest.name,
        extension: ext as Extract<typeof ext, { type: "visualization" }>,
      }))
  );

  useEffect(() => {
    if (result) {
      const detected = detectChartConfig(result);
      setChartConfig(detected);
      setViewTab("table");
    } else {
      setChartConfig(null);
    }
  }, [result]);

  if (isExecuting) {
    return (
      <div className="flex items-center justify-center h-full bg-white">
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          Executing query...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 h-full bg-white">
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-sm font-medium text-red-800">Query Error</p>
          <pre className="mt-1 text-xs text-red-600 whitespace-pre-wrap font-mono">
            {error.message}
          </pre>
        </div>
      </div>
    );
  }

  if (!result) {
    return (
      <div className="flex items-center justify-center h-full bg-white text-sm text-gray-400">
        Run a query to see results
      </div>
    );
  }

  const activePluginViz = pluginVizTabs.find((t) => t.key === viewTab);

  return (
    <div className="flex flex-col h-full bg-white">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-gray-200 text-xs text-gray-500">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setViewTab("table")}
            className={`px-2 py-0.5 rounded transition-colors ${
              viewTab === "table"
                ? "bg-gray-200 text-gray-800 font-medium"
                : "hover:bg-gray-100"
            }`}
          >
            Table
          </button>
          <button
            onClick={() => chartConfig && setViewTab("chart")}
            disabled={!chartConfig}
            className={`px-2 py-0.5 rounded transition-colors ${
              viewTab === "chart"
                ? "bg-gray-200 text-gray-800 font-medium"
                : chartConfig
                ? "hover:bg-gray-100"
                : "opacity-40 cursor-not-allowed"
            }`}
          >
            Chart
          </button>
          {pluginVizTabs.map((pvt) => (
            <button
              key={pvt.key}
              onClick={() => setViewTab(pvt.key)}
              className={`px-2 py-0.5 rounded transition-colors ${
                viewTab === pvt.key
                  ? "bg-purple-100 text-purple-800 font-medium"
                  : "hover:bg-gray-100"
              }`}
            >
              {pvt.label}
            </button>
          ))}
          <span className="text-gray-300">|</span>
          <span>{result.rowCount.toLocaleString()} rows</span>
          <span className="text-gray-300">|</span>
          <span>{result.executionTimeMs}ms</span>
          {result.rowCount > 10000 && (
            <>
              <span className="text-gray-300">|</span>
              <span className="text-amber-600">
                Showing first 10,000 rows
              </span>
            </>
          )}
        </div>
        <ExportButton />
      </div>
      {viewTab === "chart" && chartConfig && (
        <div className="border-b border-gray-200">
          <ChartConfigPanel
            config={chartConfig}
            columns={result.columns}
            onConfigChange={setChartConfig}
          />
        </div>
      )}
      <div className="flex-1 min-h-0">
        {viewTab === "table" ? (
          <DataTable result={result} />
        ) : viewTab === "chart" && chartConfig ? (
          <ChartPanel result={result} config={chartConfig} />
        ) : activePluginViz ? (
          <PluginVisualization
            extension={activePluginViz.extension}
            pluginName={activePluginViz.pluginName}
            result={result}
          />
        ) : null}
      </div>
    </div>
  );
}
