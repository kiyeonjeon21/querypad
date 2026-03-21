"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { generateExportHtml } from "@/lib/export/html";
import { exportCsv } from "@/lib/export/csv";
import { exportJson } from "@/lib/export/json";
import { exportMarkdown } from "@/lib/export/markdown";
import { exportExcel } from "@/lib/export/excel";
import { exportParquet } from "@/lib/export/parquet";
import { copyToClipboard } from "@/lib/export/clipboard";

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function ExportButton() {
  const result = useWorkspaceStore((s) => {
    const tab = s.tabs.find((t) => t.id === s.activeTabId);
    return tab?.result ?? null;
  });
  const query = useWorkspaceStore((s) => {
    const tab = s.tabs.find((t) => t.id === s.activeTabId);
    return tab?.query ?? "";
  });

  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const handleExport = useCallback(
    async (format: string) => {
      if (!result) return;
      setOpen(false);

      switch (format) {
        case "csv": {
          const csv = exportCsv(result);
          download(new Blob([csv], { type: "text/csv" }), "querypad-export.csv");
          break;
        }
        case "json": {
          const json = exportJson(result);
          download(new Blob([json], { type: "application/json" }), "querypad-export.json");
          break;
        }
        case "markdown": {
          const md = exportMarkdown(result);
          download(new Blob([md], { type: "text/markdown" }), "querypad-export.md");
          break;
        }
        case "html": {
          const html = generateExportHtml(query, result);
          download(new Blob([html], { type: "text/html" }), "querypad-export.html");
          break;
        }
        case "excel": {
          const buf = exportExcel(result);
          download(
            new Blob([buf.buffer as ArrayBuffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
            "querypad-export.xlsx"
          );
          break;
        }
        case "parquet": {
          if (!query.trim()) return;
          try {
            const buf = await exportParquet(query);
            download(new Blob([buf.buffer as ArrayBuffer], { type: "application/octet-stream" }), "querypad-export.parquet");
          } catch (err) {
            console.error("Parquet export failed:", err);
          }
          break;
        }
        case "clipboard": {
          await copyToClipboard(result);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
          break;
        }
      }
    },
    [result, query]
  );

  const plugins = useWorkspaceStore((s) => s.plugins);

  // Collect plugin exporters
  const pluginExporters = plugins.flatMap((p) =>
    p.manifest.extensions
      .filter((ext): ext is Extract<typeof ext, { type: "exporter" }> => ext.type === "exporter")
      .map((ext) => ({
        key: `plugin-export-${p.manifest.id}-${ext.label}`,
        label: ext.label,
        handler: ext.export,
      }))
  );

  const handlePluginExport = useCallback(
    async (handler: (r: import("@/types").QueryResult, q: string) => Promise<Blob>, label: string) => {
      if (!result) return;
      setOpen(false);
      try {
        const blob = await handler(result, query);
        download(blob, `querypad-${label.toLowerCase().replace(/\s+/g, "-")}`);
      } catch (err) {
        console.error("Plugin export failed:", err);
      }
    },
    [result, query]
  );

  if (!result) return null;

  const items = [
    { key: "csv", label: "CSV" },
    { key: "json", label: "JSON" },
    { key: "markdown", label: "Markdown" },
    { key: "html", label: "HTML" },
    { key: "excel", label: "Excel (.xlsx)" },
    { key: "parquet", label: "Parquet", disabled: !query.trim() },
    { key: "clipboard", label: copied ? "Copied!" : "Copy to Clipboard" },
  ];

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 transition-colors"
      >
        <svg
          className="w-3.5 h-3.5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5m0 0l5-5m-5 5V3"
          />
        </svg>
        Export
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-30 py-1 min-w-[160px]">
          {items.map((item) => (
            <button
              key={item.key}
              onClick={() => handleExport(item.key)}
              disabled={item.disabled}
              className="w-full text-left px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {item.label}
            </button>
          ))}
          {pluginExporters.length > 0 && (
            <>
              <div className="border-t border-gray-100 my-1" />
              {pluginExporters.map((pe) => (
                <button
                  key={pe.key}
                  onClick={() => handlePluginExport(pe.handler, pe.label)}
                  className="w-full text-left px-3 py-1.5 text-xs text-purple-700 hover:bg-purple-50 transition-colors"
                >
                  {pe.label}
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
