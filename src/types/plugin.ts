import type { ComponentType } from "react";
import type { QueryResult } from "./index";

export type PluginExtension =
  | {
      type: "visualization";
      component: ComponentType<{ result: QueryResult }>;
    }
  | {
      type: "exporter";
      label: string;
      export: (result: QueryResult, query: string) => Promise<Blob>;
    }
  | {
      type: "fileLoader";
      extensions: string[];
      load: (buffer: Uint8Array, fileName: string) => Promise<string>;
    }
  | {
      type: "transform";
      name: string;
      sql: string;
    };

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  extensions: PluginExtension[];
}

export interface LoadedPlugin {
  url: string;
  manifest: PluginManifest;
}
