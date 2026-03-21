"use client";

import { useState, useCallback } from "react";
import { useWorkspaceStore } from "@/stores/workspace-store";

interface PluginManagerProps {
  onClose: () => void;
}

export default function PluginManager({ onClose }: PluginManagerProps) {
  const plugins = useWorkspaceStore((s) => s.plugins);
  const loadPlugin = useWorkspaceStore((s) => s.loadPlugin);
  const unloadPlugin = useWorkspaceStore((s) => s.unloadPlugin);

  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAdd = useCallback(async () => {
    if (!url.trim()) return;
    setLoading(true);
    setError(null);
    try {
      await loadPlugin(url.trim());
      setUrl("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [url, loadPlugin]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
          <h2 className="text-sm font-semibold text-gray-800">Plugins</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-700 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-4">
          {/* Warning */}
          <div className="mb-3 p-2 bg-amber-50 border border-amber-200 rounded text-[11px] text-amber-700">
            Only load plugins from sources you trust. Plugins run with full page access.
          </div>

          {/* Add URL */}
          <div className="flex gap-2 mb-4">
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAdd()}
              placeholder="Plugin URL (ES module)"
              className="flex-1 px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg outline-none focus:border-blue-400"
            />
            <button
              onClick={handleAdd}
              disabled={loading || !url.trim()}
              className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {loading ? "..." : "Add"}
            </button>
          </div>

          {error && (
            <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded text-[11px] text-red-600">
              {error}
            </div>
          )}

          {/* Plugin list */}
          <div className="space-y-2">
            {plugins.length === 0 ? (
              <p className="text-xs text-gray-400 text-center py-4">
                No plugins loaded
              </p>
            ) : (
              plugins.map((p) => (
                <div
                  key={p.manifest.id}
                  className="flex items-center justify-between p-2.5 border border-gray-100 rounded-lg"
                >
                  <div>
                    <div className="text-xs font-medium text-gray-800">
                      {p.manifest.name}
                      <span className="ml-1.5 text-[10px] text-gray-400">
                        v{p.manifest.version}
                      </span>
                    </div>
                    <div className="text-[10px] text-gray-500 mt-0.5">
                      {p.manifest.description}
                    </div>
                    <div className="flex gap-1 mt-1">
                      {p.manifest.extensions.map((ext, i) => (
                        <span
                          key={i}
                          className="px-1 py-0.5 text-[9px] bg-gray-100 text-gray-500 rounded"
                        >
                          {ext.type}
                        </span>
                      ))}
                    </div>
                  </div>
                  <button
                    onClick={() => unloadPlugin(p.manifest.id)}
                    className="text-xs text-gray-400 hover:text-red-500 transition-colors ml-2"
                  >
                    Remove
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
