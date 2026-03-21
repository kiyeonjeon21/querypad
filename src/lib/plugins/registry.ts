import type { PluginManifest, LoadedPlugin } from "@/types/plugin";

/**
 * Load a plugin from a URL via dynamic import.
 * The module must export a `manifest` conforming to PluginManifest.
 */
export async function loadPluginFromUrl(url: string): Promise<LoadedPlugin> {
  const mod = await import(/* webpackIgnore: true */ url);
  const manifest = mod.default ?? mod.manifest;

  if (!manifest || !manifest.id || !manifest.name || !manifest.extensions) {
    throw new Error(
      `Invalid plugin manifest from ${url}. Must export { id, name, version, description, extensions }.`
    );
  }

  validateManifest(manifest);

  return { url, manifest };
}

function validateManifest(manifest: PluginManifest) {
  if (typeof manifest.id !== "string" || !manifest.id) {
    throw new Error("Plugin manifest.id must be a non-empty string");
  }
  if (typeof manifest.name !== "string" || !manifest.name) {
    throw new Error("Plugin manifest.name must be a non-empty string");
  }
  if (!Array.isArray(manifest.extensions)) {
    throw new Error("Plugin manifest.extensions must be an array");
  }
  for (const ext of manifest.extensions) {
    if (!["visualization", "exporter", "fileLoader", "transform"].includes(ext.type)) {
      throw new Error(`Unknown extension type: ${ext.type}`);
    }
  }
}
