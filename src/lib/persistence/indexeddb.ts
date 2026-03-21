import { get, set, del } from "idb-keyval";

const WORKSPACE_KEY = "querypad-workspace";

import type { Pipeline } from "@/types/pipeline";

interface PersistedTab {
  id: string;
  title: string;
  query: string;
  createdAt: number;
}

export interface PersistedWorkspace {
  fileEntries: { name: string; fileName: string; data: Uint8Array }[];
  query: string; // legacy, kept for migration
  tabs?: PersistedTab[];
  activeTabId?: string;
  // Phase 3
  pipelines?: Pipeline[];
  activePipelineId?: string | null;
  viewMode?: "sql" | "pipeline";
  pluginUrls?: string[];
}

export async function saveWorkspace(
  workspace: PersistedWorkspace
): Promise<void> {
  // Clone Uint8Arrays to avoid "detached ArrayBuffer" errors
  const clone: PersistedWorkspace = {
    query: workspace.query,
    fileEntries: workspace.fileEntries.map((e) => ({
      name: e.name,
      fileName: e.fileName,
      data: new Uint8Array(e.data),
    })),
    tabs: workspace.tabs,
    activeTabId: workspace.activeTabId,
    pipelines: workspace.pipelines,
    activePipelineId: workspace.activePipelineId,
    viewMode: workspace.viewMode,
    pluginUrls: workspace.pluginUrls,
  };
  await set(WORKSPACE_KEY, clone);
}

export async function loadWorkspace(): Promise<PersistedWorkspace | undefined> {
  return get<PersistedWorkspace>(WORKSPACE_KEY);
}

export async function clearPersistedWorkspace(): Promise<void> {
  await del(WORKSPACE_KEY);
}
