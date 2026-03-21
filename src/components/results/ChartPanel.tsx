"use client";

import {
  BarChart,
  Bar,
  LineChart,
  Line,
  ScatterChart,
  Scatter,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import type { QueryResult } from "@/types";
import type { ChartConfig } from "@/lib/charts/detect";

const COLORS = [
  "#3b82f6",
  "#ef4444",
  "#10b981",
  "#f59e0b",
  "#8b5cf6",
  "#ec4899",
  "#06b6d4",
  "#f97316",
  "#84cc16",
  "#6366f1",
];

const MAX_CHART_ROWS = 5000;

interface ChartPanelProps {
  result: QueryResult;
  config: ChartConfig;
}

export default function ChartPanel({ result, config }: ChartPanelProps) {
  const sampled = result.rows.length > MAX_CHART_ROWS;
  const data = sampled ? result.rows.slice(0, MAX_CHART_ROWS) : result.rows;

  return (
    <div className="flex flex-col h-full p-4">
      {sampled && (
        <p className="text-xs text-amber-600 mb-2">
          Showing first {MAX_CHART_ROWS.toLocaleString()} of{" "}
          {result.rows.length.toLocaleString()} rows
        </p>
      )}
      <div className="flex-1 min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          {renderChart(data, config)}
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function renderChart(
  data: Record<string, unknown>[],
  config: ChartConfig
): React.ReactElement {
  const { type, xColumn, yColumns } = config;

  switch (type) {
    case "bar":
      return (
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey={xColumn} tick={{ fontSize: 12 }} />
          <YAxis tick={{ fontSize: 12 }} />
          <Tooltip />
          <Legend />
          {yColumns.map((col, i) => (
            <Bar
              key={col}
              dataKey={col}
              fill={COLORS[i % COLORS.length]}
            />
          ))}
        </BarChart>
      );

    case "line":
      return (
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey={xColumn} tick={{ fontSize: 12 }} />
          <YAxis tick={{ fontSize: 12 }} />
          <Tooltip />
          <Legend />
          {yColumns.map((col, i) => (
            <Line
              key={col}
              type="monotone"
              dataKey={col}
              stroke={COLORS[i % COLORS.length]}
              dot={data.length <= 50}
            />
          ))}
        </LineChart>
      );

    case "scatter":
      return (
        <ScatterChart>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey={xColumn} name={xColumn} tick={{ fontSize: 12 }} />
          <YAxis
            dataKey={yColumns[0]}
            name={yColumns[0]}
            tick={{ fontSize: 12 }}
          />
          <Tooltip cursor={{ strokeDasharray: "3 3" }} />
          <Scatter data={data} fill={COLORS[0]} />
        </ScatterChart>
      );

    case "pie":
      return (
        <PieChart>
          <Tooltip />
          <Legend />
          <Pie
            data={data}
            dataKey={yColumns[0]}
            nameKey={xColumn}
            cx="50%"
            cy="50%"
            outerRadius="70%"
            label
          >
            {data.map((_, i) => (
              <Cell key={i} fill={COLORS[i % COLORS.length]} />
            ))}
          </Pie>
        </PieChart>
      );
  }
}
