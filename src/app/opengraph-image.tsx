import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "QueryPad — SQL Playground for Your Data Files";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OgImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          background: "linear-gradient(135deg, #0f172a 0%, #1e293b 100%)",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        {/* Logo area */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "16px",
            marginBottom: "32px",
          }}
        >
          <div
            style={{
              width: "64px",
              height: "64px",
              borderRadius: "16px",
              background: "linear-gradient(135deg, #3b82f6, #8b5cf6)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "32px",
              color: "white",
              fontWeight: 700,
            }}
          >
            Q
          </div>
          <div
            style={{
              fontSize: "56px",
              fontWeight: 800,
              color: "white",
              letterSpacing: "-2px",
            }}
          >
            QueryPad
          </div>
        </div>

        {/* Tagline */}
        <div
          style={{
            fontSize: "28px",
            color: "#94a3b8",
            marginBottom: "48px",
            textAlign: "center",
            maxWidth: "800px",
          }}
        >
          Drop a file. Query with SQL. Visualize and share.
        </div>

        {/* Feature pills */}
        <div
          style={{
            display: "flex",
            gap: "12px",
            flexWrap: "wrap",
            justifyContent: "center",
          }}
        >
          {["CSV", "Parquet", "JSON", "Excel", "DuckDB-Wasm", "In-Browser"].map(
            (label) => (
              <div
                key={label}
                style={{
                  padding: "8px 20px",
                  borderRadius: "9999px",
                  background: "rgba(59, 130, 246, 0.15)",
                  border: "1px solid rgba(59, 130, 246, 0.3)",
                  color: "#60a5fa",
                  fontSize: "18px",
                  fontWeight: 600,
                }}
              >
                {label}
              </div>
            )
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            position: "absolute",
            bottom: "32px",
            fontSize: "20px",
            color: "#64748b",
          }}
        >
          querypad.io — Open Source
        </div>
      </div>
    ),
    { ...size }
  );
}
