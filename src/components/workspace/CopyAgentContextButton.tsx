"use client";

import { useMemo, useState } from "react";
import { buildAgentContext } from "@/lib/agent/context";
import { useWorkspaceStore } from "@/stores/workspace-store";

async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
}

export default function CopyAgentContextButton() {
  const tables = useWorkspaceStore((s) => s.tables);
  const tableProfiles = useWorkspaceStore((s) => s.tableProfiles);
  const activeTab = useWorkspaceStore((s) =>
    s.tabs.find((tab) => tab.id === s.activeTabId)
  );
  const [copied, setCopied] = useState(false);

  const contextText = useMemo(
    () =>
      buildAgentContext({
        tables,
        tableProfiles,
        activeQuery: activeTab?.query ?? "",
        activeResult: activeTab?.result ?? null,
        activeError: activeTab?.error ?? null,
      }),
    [activeTab?.error, activeTab?.query, activeTab?.result, tableProfiles, tables]
  );

  const disabled =
    tables.length === 0 &&
    !activeTab?.query.trim() &&
    !activeTab?.result &&
    !activeTab?.error;

  const handleCopy = async () => {
    if (disabled) return;
    await copyText(contextText);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <button
      onClick={handleCopy}
      disabled={disabled}
      className="inline-flex items-center gap-1.5 px-2 py-1 text-[11px] text-gray-500 hover:text-gray-800 hover:bg-gray-100 disabled:opacity-40 disabled:hover:bg-transparent rounded transition-colors"
      title="Copy context for Codex or Claude Code"
    >
      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V5a2 2 0 012-2h8a2 2 0 012 2v8a2 2 0 01-2 2h-2M6 7h8a2 2 0 012 2v8a2 2 0 01-2 2H6a2 2 0 01-2-2V9a2 2 0 012-2z" />
      </svg>
      {copied ? "Copied" : "Copy context"}
    </button>
  );
}
