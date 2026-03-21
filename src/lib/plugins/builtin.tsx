import type { PluginManifest } from "@/types/plugin";
import type { QueryResult } from "@/types";

/**
 * Built-in heatmap visualization plugin (serves as example).
 * This is registered directly, not loaded via URL.
 */
function HeatmapVisualization({ result }: { result: QueryResult }) {
  const numericCols = result.columns.filter((col) =>
    result.rows.length > 0 && typeof result.rows[0][col] === "number"
  );

  if (numericCols.length === 0) {
    return (
    <div style={{ padding: 16, color: "#9ca3af", fontSize: 13 }}>
        No numeric columns for heatmap
      </div>
    );
  }

  // Find min/max for first numeric column
  const col = numericCols[0];
  const values = result.rows.map((r) => Number(r[col]) || 0);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  return (
    <div style={{ padding: 16, overflowY: "auto", maxHeight: "100%" }}>
      <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 8 }}>
        Heatmap: {col} (min={min.toFixed(1)}, max={max.toFixed(1)})
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 2 }}>
        {result.rows.slice(0, 200).map((row, i) => {
          const val = Number(row[col]) || 0;
          const intensity = (val - min) / range;
          const r = Math.round(255 * (1 - intensity));
          const g = Math.round(200 * intensity);
          const b = Math.round(100 * intensity);
          return (
            <div
              key={i}
              title={`${col}: ${val}`}
              style={{
                width: 20,
                height: 20,
                borderRadius: 3,
                backgroundColor: `rgb(${r}, ${g}, ${b})`,
              }}
            />
          );
        })}
      </div>
    </div>
  );
}

export const builtinHeatmapPlugin: PluginManifest = {
  id: "builtin-heatmap",
  name: "Heatmap",
  version: "1.0.0",
  description: "Simple heatmap visualization for numeric columns",
  extensions: [
    {
      type: "visualization",
      component: HeatmapVisualization,
    },
  ],
};
