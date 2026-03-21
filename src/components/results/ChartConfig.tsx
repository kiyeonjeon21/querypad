"use client";

import type { ChartType, ChartConfig } from "@/lib/charts/detect";

interface ChartConfigPanelProps {
  config: ChartConfig;
  columns: string[];
  onConfigChange: (config: ChartConfig) => void;
}

const CHART_TYPES: ChartType[] = ["bar", "line", "scatter", "pie"];

export default function ChartConfigPanel({
  config,
  columns,
  onConfigChange,
}: ChartConfigPanelProps) {
  return (
    <div className="flex items-center gap-3 px-3 py-1.5 text-xs">
      <label className="flex items-center gap-1 text-gray-500">
        Type
        <select
          value={config.type}
          onChange={(e) =>
            onConfigChange({ ...config, type: e.target.value as ChartType })
          }
          className="ml-1 px-1.5 py-0.5 border border-gray-200 rounded text-xs bg-white"
        >
          {CHART_TYPES.map((t) => (
            <option key={t} value={t}>
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-1 text-gray-500">
        X
        <select
          value={config.xColumn}
          onChange={(e) =>
            onConfigChange({ ...config, xColumn: e.target.value })
          }
          className="ml-1 px-1.5 py-0.5 border border-gray-200 rounded text-xs bg-white"
        >
          {columns.map((col) => (
            <option key={col} value={col}>
              {col}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-1 text-gray-500">
        Y
        <select
          value={config.yColumns[0]}
          onChange={(e) =>
            onConfigChange({ ...config, yColumns: [e.target.value] })
          }
          className="ml-1 px-1.5 py-0.5 border border-gray-200 rounded text-xs bg-white"
        >
          {columns.map((col) => (
            <option key={col} value={col}>
              {col}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
