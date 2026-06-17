import { create } from "zustand";
import type { TableInfo, EditorTab, TableProfileState } from "@/types";
import type {
  Relationship,
  RelationshipDiscoveryState,
  RelationshipVerdict,
} from "@/types/discovery";
import type { Pipeline, PipelineStep, PipelineExecutionResult } from "@/types/pipeline";
import type { LoadedPlugin } from "@/types/plugin";
import {
  saveWorkspace,
  loadWorkspace,
  clearPersistedWorkspace,
} from "@/lib/persistence/indexeddb";
import { getConnection } from "@/lib/duckdb/instance";
import {
  discoverRelationships as runDiscovery,
  relationshipKey,
} from "@/lib/discovery/relationships";
import { createBrowserQueryRunner } from "@/lib/duckdb/browser-runner";

interface FileEntry {
  name: string;
  fileName: string;
  data: Uint8Array;
}

const IDLE_DISCOVERY: RelationshipDiscoveryState = {
  status: "idle",
  relationships: [],
  error: null,
};

/** Merge user overrides onto a base relationship list (override wins, by key). */
function mergeOverrides(
  base: Relationship[],
  overrides: Relationship[]
): Relationship[] {
  const byKey = new Map<string, Relationship>();
  for (const rel of base) byKey.set(relationshipKey(rel), rel);
  for (const rel of overrides) byKey.set(relationshipKey(rel), rel);
  return [...byKey.values()];
}

const MAX_TABS = 20;

function createTab(index: number): EditorTab {
  return {
    id: crypto.randomUUID(),
    title: `Query ${index}`,
    query: "",
    result: null,
    error: null,
    isExecuting: false,
    createdAt: Date.now(),
  };
}

const initialTab = createTab(1);

interface WorkspaceState {
  // DuckDB
  dbReady: boolean;
  setDbReady: (ready: boolean) => void;

  // Hydration
  _hydrated: boolean;
  restoreFromIndexedDB: () => Promise<void>;

  // Tables
  tables: TableInfo[];
  fileEntries: FileEntry[];
  tableProfiles: Record<string, TableProfileState>;
  addTable: (table: TableInfo, fileName: string, data: Uint8Array) => void;
  removeTable: (name: string) => void;
  loadTableProfile: (name: string) => Promise<void>;
  clearTableProfile: (name: string) => void;

  // Relationship discovery + verification
  discovery: RelationshipDiscoveryState;
  relationshipVerdicts: Record<string, RelationshipVerdict>;
  relationshipOverrides: Relationship[];
  discoverRelationships: () => Promise<void>;
  setRelationshipVerdict: (key: string, verdict: RelationshipVerdict | null) => void;
  editRelationship: (oldKey: string, next: Relationship) => void;

  // Clear
  clearWorkspace: () => Promise<void>;

  // Tabs
  tabs: EditorTab[];
  activeTabId: string;
  addTab: () => void;
  removeTab: (id: string) => void;
  setActiveTab: (id: string) => void;
  updateTab: (id: string, patch: Partial<EditorTab>) => void;
  renameTab: (id: string, title: string) => void;

  // Sharing
  shareUrl: string | null;
  setShareUrl: (url: string | null) => void;

  // Pipelines (Feature 1)
  pipelines: Pipeline[];
  activePipelineId: string | null;
  pipelineResults: Record<string, PipelineExecutionResult>;
  viewMode: "sql" | "pipeline";
  addPipeline: () => void;
  removePipeline: (id: string) => void;
  setActivePipeline: (id: string) => void;
  addPipelineStep: (pipelineId: string) => void;
  removePipelineStep: (pipelineId: string, stepId: string) => void;
  updatePipelineStep: (
    pipelineId: string,
    stepId: string,
    patch: Partial<PipelineStep>
  ) => void;
  setPipelineResults: (results: Record<string, PipelineExecutionResult>) => void;
  setViewMode: (mode: "sql" | "pipeline") => void;

  // Plugins (Feature 2)
  plugins: LoadedPlugin[];
  loadPlugin: (url: string) => Promise<void>;
  unloadPlugin: (id: string) => void;
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  dbReady: false,
  setDbReady: (ready) => set({ dbReady: ready }),

  _hydrated: false,
  restoreFromIndexedDB: async () => {
    try {
      const persisted = await loadWorkspace();
      if (persisted && persisted.fileEntries.length > 0) {
        const { loadBufferAsTable } = await import("@/lib/duckdb/files");
        const tables: TableInfo[] = [];
        const fileEntries: FileEntry[] = [];
        for (const entry of persisted.fileEntries) {
          const safeCopy = new Uint8Array(entry.data);
          const table = await loadBufferAsTable(
            entry.name,
            entry.fileName,
            entry.data
          );
          tables.push(table);
          fileEntries.push({ ...entry, data: safeCopy });
        }

        // Restore tabs or migrate from old query field
        let tabs: EditorTab[];
        let activeTabId: string;
        if (persisted.tabs && persisted.tabs.length > 0) {
          tabs = persisted.tabs.map((pt) => ({
            id: pt.id,
            title: pt.title,
            query: pt.query,
            result: null,
            error: null,
            isExecuting: false,
            createdAt: pt.createdAt,
          }));
          activeTabId = persisted.activeTabId || tabs[0].id;
        } else {
          // Migration from old format
          const tab = createTab(1);
          tab.query = persisted.query || "";
          tabs = [tab];
          activeTabId = tab.id;
        }

        const patch: Record<string, unknown> = { tables, fileEntries, tabs, activeTabId };

        // Restore pipelines
        if (persisted.pipelines && persisted.pipelines.length > 0) {
          patch.pipelines = persisted.pipelines;
          patch.activePipelineId = persisted.activePipelineId ?? persisted.pipelines[0].id;
        }
        if (persisted.viewMode) {
          patch.viewMode = persisted.viewMode;
        }
        if (persisted.relationshipVerdicts) {
          patch.relationshipVerdicts = persisted.relationshipVerdicts;
        }
        if (persisted.relationshipOverrides) {
          patch.relationshipOverrides = persisted.relationshipOverrides;
        }

        set(patch);

        // Restore plugins from URLs
        if (persisted.pluginUrls && persisted.pluginUrls.length > 0) {
          const { loadPluginFromUrl } = await import("@/lib/plugins/registry");
          for (const url of persisted.pluginUrls) {
            try {
              const plugin = await loadPluginFromUrl(url);
              set((s) => ({
                plugins: [...s.plugins.filter((p) => p.manifest.id !== plugin.manifest.id), plugin],
              }));
            } catch (err) {
              console.error(`Failed to reload plugin from ${url}:`, err);
            }
          }
        }
      }
    } catch (err) {
      console.error("Failed to restore from IndexedDB:", err);
    } finally {
      set({ _hydrated: true });
    }
  },

  tables: [],
  fileEntries: [],
  tableProfiles: {},
  addTable: (table, fileName, data) =>
    set((state) => ({
      tables: [...state.tables.filter((t) => t.name !== table.name), table],
      fileEntries: [
        ...state.fileEntries.filter((f) => f.name !== table.name),
        { name: table.name, fileName, data: new Uint8Array(data) },
      ],
      tableProfiles: {
        ...state.tableProfiles,
        [table.name]: { status: "idle", profile: null, error: null },
      },
      // Tables changed — the relationship graph must be re-derived.
      discovery: IDLE_DISCOVERY,
    })),
  removeTable: async (name) => {
    set((state) => ({
      tables: state.tables.filter((t) => t.name !== name),
      fileEntries: state.fileEntries.filter((f) => f.name !== name),
      tableProfiles: Object.fromEntries(
        Object.entries(state.tableProfiles).filter(([tableName]) => tableName !== name)
      ),
      discovery: IDLE_DISCOVERY,
      relationshipOverrides: state.relationshipOverrides.filter(
        (rel) => rel.from.table !== name && rel.to.table !== name
      ),
    }));
    try {
      const conn = await getConnection();
      await conn.query(`DROP TABLE IF EXISTS "${name}"`);
    } catch (err) {
      console.error("Failed to drop table:", err);
    }
  },

  clearWorkspace: async () => {
    // Drop all tables from DuckDB before clearing store
    const currentTables = get().tables;
    try {
      const conn = await getConnection();
      for (const t of currentTables) {
        await conn.query(`DROP TABLE IF EXISTS "${t.name}"`);
      }
    } catch (err) {
      console.error("Failed to drop tables:", err);
    }
    await clearPersistedWorkspace();
    const tab = createTab(1);
    set({
      tables: [],
      fileEntries: [],
      tableProfiles: {},
      discovery: IDLE_DISCOVERY,
      relationshipVerdicts: {},
      relationshipOverrides: [],
      tabs: [tab],
      activeTabId: tab.id,
      shareUrl: null,
    });
  },

  loadTableProfile: async (name) => {
    const table = get().tables.find((t) => t.name === name);
    if (!table) return;

    const current = get().tableProfiles[name];
    if (current?.status === "loading") return;

    set((state) => ({
      tableProfiles: {
        ...state.tableProfiles,
        [name]: { status: "loading", profile: current?.profile ?? null, error: null },
      },
    }));

    try {
      const { profileTable } = await import("@/lib/duckdb/profile");
      const profile = await profileTable(table);
      if (!get().tables.some((t) => t.name === name)) return;
      set((state) => ({
        tableProfiles: {
          ...state.tableProfiles,
          [name]: { status: "ready", profile, error: null },
        },
      }));
    } catch (err) {
      if (!get().tables.some((t) => t.name === name)) return;
      set((state) => ({
        tableProfiles: {
          ...state.tableProfiles,
          [name]: {
            status: "error",
            profile: null,
            error: err instanceof Error ? err.message : String(err),
          },
        },
      }));
    }
  },

  clearTableProfile: (name) =>
    set((state) => ({
      tableProfiles: Object.fromEntries(
        Object.entries(state.tableProfiles).filter(([tableName]) => tableName !== name)
      ),
    })),

  discovery: IDLE_DISCOVERY,
  relationshipVerdicts: {},
  relationshipOverrides: [],

  discoverRelationships: async () => {
    const tables = get().tables;
    const names = new Set(tables.map((t) => t.name));
    const validOverrides = () =>
      get().relationshipOverrides.filter(
        (rel) => names.has(rel.from.table) && names.has(rel.to.table)
      );

    if (tables.length < 2) {
      set({
        discovery: { status: "ready", relationships: validOverrides(), error: null },
      });
      return;
    }

    set((state) => ({ discovery: { ...state.discovery, status: "loading", error: null } }));
    try {
      const { profileTable } = await import("@/lib/duckdb/profile");
      const profiles = [];
      for (const table of tables) profiles.push(await profileTable(table));
      const base = await runDiscovery(profiles, createBrowserQueryRunner());
      set({
        discovery: {
          status: "ready",
          relationships: mergeOverrides(base, validOverrides()),
          error: null,
        },
      });
    } catch (err) {
      set({
        discovery: {
          status: "error",
          relationships: [],
          error: err instanceof Error ? err.message : String(err),
        },
      });
    }
  },

  setRelationshipVerdict: (key, verdict) =>
    set((state) => {
      const next = { ...state.relationshipVerdicts };
      if (verdict === null) delete next[key];
      else next[key] = verdict;
      return { relationshipVerdicts: next };
    }),

  editRelationship: (oldKey, next) =>
    set((state) => {
      const nextKey = relationshipKey(next);
      const verdicts = { ...state.relationshipVerdicts };
      delete verdicts[oldKey];
      verdicts[nextKey] = "accepted";
      const overrides = state.relationshipOverrides.filter(
        (rel) => relationshipKey(rel) !== oldKey && relationshipKey(rel) !== nextKey
      );
      overrides.push(next);
      const relationships = mergeOverrides(
        state.discovery.relationships.filter((rel) => relationshipKey(rel) !== oldKey),
        [next]
      );
      return {
        relationshipVerdicts: verdicts,
        relationshipOverrides: overrides,
        discovery: { ...state.discovery, relationships },
      };
    }),

  tabs: [initialTab],
  activeTabId: initialTab.id,

  addTab: () =>
    set((state) => {
      if (state.tabs.length >= MAX_TABS) return state;
      const tab = createTab(state.tabs.length + 1);
      return { tabs: [...state.tabs, tab], activeTabId: tab.id };
    }),

  removeTab: (id) =>
    set((state) => {
      if (state.tabs.length <= 1) return state;
      const idx = state.tabs.findIndex((t) => t.id === id);
      const newTabs = state.tabs.filter((t) => t.id !== id);
      let newActiveId = state.activeTabId;
      if (state.activeTabId === id) {
        const newIdx = Math.min(idx, newTabs.length - 1);
        newActiveId = newTabs[newIdx].id;
      }
      return { tabs: newTabs, activeTabId: newActiveId };
    }),

  setActiveTab: (id) => set({ activeTabId: id }),

  updateTab: (id, patch) =>
    set((state) => ({
      tabs: state.tabs.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    })),

  renameTab: (id, title) =>
    set((state) => ({
      tabs: state.tabs.map((t) => (t.id === id ? { ...t, title } : t)),
    })),

  shareUrl: null,
  setShareUrl: (shareUrl) => set({ shareUrl }),

  // Pipelines
  pipelines: [],
  activePipelineId: null,
  pipelineResults: {},
  viewMode: "sql",

  addPipeline: () =>
    set((state) => {
      const pipeline: Pipeline = {
        id: crypto.randomUUID(),
        title: `Pipeline ${state.pipelines.length + 1}`,
        steps: [],
        createdAt: Date.now(),
      };
      return {
        pipelines: [...state.pipelines, pipeline],
        activePipelineId: pipeline.id,
        pipelineResults: {},
      };
    }),

  removePipeline: (id) =>
    set((state) => {
      const newPipelines = state.pipelines.filter((p) => p.id !== id);
      return {
        pipelines: newPipelines,
        activePipelineId:
          state.activePipelineId === id
            ? newPipelines[0]?.id ?? null
            : state.activePipelineId,
        pipelineResults:
          state.activePipelineId === id ? {} : state.pipelineResults,
      };
    }),

  setActivePipeline: (id) =>
    set({ activePipelineId: id, pipelineResults: {} }),

  addPipelineStep: (pipelineId) =>
    set((state) => ({
      pipelines: state.pipelines.map((p) => {
        if (p.id !== pipelineId) return p;
        const step: PipelineStep = {
          id: crypto.randomUUID(),
          name: `step_${p.steps.length + 1}`,
          query: "",
        };
        return { ...p, steps: [...p.steps, step] };
      }),
    })),

  removePipelineStep: (pipelineId, stepId) =>
    set((state) => ({
      pipelines: state.pipelines.map((p) => {
        if (p.id !== pipelineId) return p;
        return { ...p, steps: p.steps.filter((s) => s.id !== stepId) };
      }),
    })),

  updatePipelineStep: (pipelineId, stepId, patch) =>
    set((state) => ({
      pipelines: state.pipelines.map((p) => {
        if (p.id !== pipelineId) return p;
        return {
          ...p,
          steps: p.steps.map((s) =>
            s.id === stepId ? { ...s, ...patch } : s
          ),
        };
      }),
    })),

  setPipelineResults: (pipelineResults) => set({ pipelineResults }),

  setViewMode: (viewMode) => set({ viewMode }),

  // Plugins
  plugins: [],

  loadPlugin: async (url: string) => {
    const { loadPluginFromUrl } = await import("@/lib/plugins/registry");
    const plugin = await loadPluginFromUrl(url);
    set((state) => {
      // Replace if same id
      const filtered = state.plugins.filter(
        (p) => p.manifest.id !== plugin.manifest.id
      );
      return { plugins: [...filtered, plugin] };
    });
  },

  unloadPlugin: (id) =>
    set((state) => ({
      plugins: state.plugins.filter((p) => p.manifest.id !== id),
    })),
}));

// Auto-save to IndexedDB with debounce
let saveTimer: ReturnType<typeof setTimeout> | null = null;

useWorkspaceStore.subscribe((state, prevState) => {
  if (
    state.fileEntries !== prevState.fileEntries ||
    state.tabs !== prevState.tabs ||
    state.activeTabId !== prevState.activeTabId ||
    state.pipelines !== prevState.pipelines ||
    state.activePipelineId !== prevState.activePipelineId ||
    state.viewMode !== prevState.viewMode ||
    state.plugins !== prevState.plugins ||
    state.relationshipVerdicts !== prevState.relationshipVerdicts ||
    state.relationshipOverrides !== prevState.relationshipOverrides
  ) {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveWorkspace({
        fileEntries: state.fileEntries,
        query: "", // legacy field
        tabs: state.tabs.map((t) => ({
          id: t.id,
          title: t.title,
          query: t.query,
          createdAt: t.createdAt,
        })),
        activeTabId: state.activeTabId,
        pipelines: state.pipelines,
        activePipelineId: state.activePipelineId,
        viewMode: state.viewMode,
        pluginUrls: state.plugins
          .filter((p) => p.url)
          .map((p) => p.url),
        relationshipVerdicts: state.relationshipVerdicts,
        relationshipOverrides: state.relationshipOverrides,
      }).catch(console.error);
    }, 500);
  }
});
