"use client";

import { useState, useRef, useCallback } from "react";
import { useWorkspaceStore } from "@/stores/workspace-store";

export default function TabBar() {
  const tabs = useWorkspaceStore((s) => s.tabs);
  const activeTabId = useWorkspaceStore((s) => s.activeTabId);
  const addTab = useWorkspaceStore((s) => s.addTab);
  const removeTab = useWorkspaceStore((s) => s.removeTab);
  const setActiveTab = useWorkspaceStore((s) => s.setActiveTab);
  const renameTab = useWorkspaceStore((s) => s.renameTab);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDoubleClick = useCallback(
    (id: string, title: string) => {
      setEditingId(id);
      setEditValue(title);
      setTimeout(() => inputRef.current?.select(), 0);
    },
    []
  );

  const commitRename = useCallback(() => {
    if (editingId && editValue.trim()) {
      renameTab(editingId, editValue.trim());
    }
    setEditingId(null);
  }, [editingId, editValue, renameTab]);

  return (
    <div className="flex items-center border-b border-gray-200 bg-gray-50 overflow-x-auto shrink-0">
      {tabs.map((tab) => (
        <div
          key={tab.id}
          onClick={() => setActiveTab(tab.id)}
          onDoubleClick={() => handleDoubleClick(tab.id, tab.title)}
          className={`group flex items-center gap-1 px-3 py-1.5 text-xs cursor-pointer border-r border-gray-200 shrink-0 select-none ${
            tab.id === activeTabId
              ? "bg-white text-gray-800 border-b-2 border-b-blue-500 font-medium"
              : "text-gray-500 hover:bg-gray-100"
          }`}
        >
          {editingId === tab.id ? (
            <input
              ref={inputRef}
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitRename();
                if (e.key === "Escape") setEditingId(null);
              }}
              className="w-20 px-1 py-0 text-xs border border-blue-300 rounded outline-none bg-white"
              autoFocus
            />
          ) : (
            <span className="max-w-[120px] truncate">{tab.title}</span>
          )}
          {tabs.length > 1 && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                removeTab(tab.id);
              }}
              className="opacity-0 group-hover:opacity-100 ml-1 text-gray-400 hover:text-gray-700 transition-opacity"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      ))}
      <button
        onClick={addTab}
        className="flex items-center justify-center w-7 h-7 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded transition-colors shrink-0 mx-1"
        title="New tab"
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
        </svg>
      </button>
    </div>
  );
}
