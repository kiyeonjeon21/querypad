"use client";

import { useEffect } from "react";
import { useWorkspaceStore } from "@/stores/workspace-store";
import type { ColumnProfile, TableProfileState } from "@/types";

const IDLE_PROFILE_STATE: TableProfileState = {
  status: "idle",
  profile: null,
  error: null,
};

function formatNumber(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "n/a";
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: Math.abs(value) >= 100 ? 0 : 2,
  }).format(value);
}

function formatScalar(value: string | number | null): string {
  if (value === null || value === "") return "n/a";
  if (typeof value === "number") return formatNumber(value);
  return value.length > 48 ? `${value.slice(0, 45)}...` : value;
}

function formatPercent(value: number): string {
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)}%`;
}

function describeColumn(profile: ColumnProfile): string {
  if (profile.kind === "numeric") {
    const range =
      profile.min !== null || profile.max !== null
        ? `${formatScalar(profile.min)} to ${formatScalar(profile.max)}`
        : "n/a";
    return `range ${range}, avg ${formatNumber(profile.avg)}`;
  }

  if (profile.kind === "date") {
    return `range ${formatScalar(profile.min)} to ${formatScalar(profile.max)}`;
  }

  if (profile.topValues.length > 0) {
    return profile.topValues
      .map((item) => `${item.value || "n/a"} (${item.count.toLocaleString()})`)
      .join(", ");
  }

  return "No non-null values";
}

interface ProfileDrawerProps {
  tableName: string;
  onClose: () => void;
}

export default function ProfileDrawer({ tableName, onClose }: ProfileDrawerProps) {
  const table = useWorkspaceStore((s) => s.tables.find((t) => t.name === tableName));
  const profileState = useWorkspaceStore((s) => s.tableProfiles[tableName]) ?? IDLE_PROFILE_STATE;
  const loadTableProfile = useWorkspaceStore((s) => s.loadTableProfile);

  useEffect(() => {
    if (table && profileState.status === "idle") {
      void loadTableProfile(tableName);
    }
  }, [loadTableProfile, profileState.status, table, tableName]);

  if (!table) return null;

  return (
    <aside className="w-80 max-w-[42vw] shrink-0 border-r border-gray-200 bg-white flex flex-col h-full">
      <div className="px-3 py-2 border-b border-gray-200 flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-xs font-semibold text-gray-800 font-mono">
            {tableName} profile
          </h2>
          <p className="text-[11px] text-gray-400">
            {table.rowCount.toLocaleString()} rows, {table.columns.length.toLocaleString()} columns
          </p>
        </div>
        <button
          onClick={() => loadTableProfile(tableName)}
          disabled={profileState.status === "loading"}
          className="p-1 text-gray-400 hover:text-gray-700 hover:bg-gray-100 disabled:opacity-40 rounded transition-colors"
          title="Refresh profile"
          aria-label={`Refresh profile ${tableName}`}
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h5M20 20v-5h-5M5.5 14A7 7 0 0018 17.5M18.5 10A7 7 0 006 6.5" />
          </svg>
        </button>
        <button
          onClick={onClose}
          className="p-1 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded transition-colors"
          title="Close profile"
          aria-label="Close profile"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {profileState.status === "loading" && (
          <div className="flex items-center gap-2 px-3 py-4 text-xs text-gray-500">
            <div className="w-3.5 h-3.5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            Profiling table...
          </div>
        )}

        {profileState.status === "error" && (
          <div className="px-3 py-4 text-xs">
            <p className="font-medium text-red-700">Profile failed</p>
            <p className="mt-1 text-red-600 whitespace-pre-wrap">{profileState.error}</p>
            <button
              onClick={() => loadTableProfile(tableName)}
              className="mt-3 px-2 py-1 rounded bg-red-50 text-red-700 hover:bg-red-100 transition-colors"
            >
              Retry
            </button>
          </div>
        )}

        {profileState.status === "ready" && profileState.profile && (
          <div>
            <div className="grid grid-cols-3 border-b border-gray-200 bg-gray-50 text-[11px] text-gray-500">
              <div className="px-3 py-2">
                <p className="uppercase tracking-wider">Rows</p>
                <p className="mt-0.5 text-xs font-medium text-gray-800">
                  {profileState.profile.rowCount.toLocaleString()}
                </p>
              </div>
              <div className="px-3 py-2 border-l border-gray-200">
                <p className="uppercase tracking-wider">Columns</p>
                <p className="mt-0.5 text-xs font-medium text-gray-800">
                  {profileState.profile.columnCount.toLocaleString()}
                </p>
              </div>
              <div className="px-3 py-2 border-l border-gray-200">
                <p className="uppercase tracking-wider">Built</p>
                <p className="mt-0.5 text-xs font-medium text-gray-800">
                  {new Date(profileState.profile.generatedAt).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </p>
              </div>
            </div>

            <div className="divide-y divide-gray-100">
              {profileState.profile.columns.map((column) => (
                <div key={column.name} className="px-3 py-2">
                  <div className="flex items-baseline gap-2">
                    <span className="min-w-0 truncate font-mono text-xs font-medium text-gray-800">
                      {column.name}
                    </span>
                    <span className="ml-auto shrink-0 text-[11px] text-gray-400">
                      {column.type}
                    </span>
                  </div>
                  <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-gray-500">
                    <span>Null {formatPercent(column.nullPercent)}</span>
                    <span>Distinct {column.distinctCount?.toLocaleString() ?? "n/a"}</span>
                  </div>
                  <p className="mt-1 text-[11px] leading-4 text-gray-600">
                    {describeColumn(column)}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
