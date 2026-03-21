import { useCollaborationStore } from "@/stores/collaboration-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { loadBufferAsTable } from "@/lib/duckdb/files";

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

/**
 * Broadcast a file to all peers via Y.js shared map.
 * Only files under 5MB are synced.
 */
export function broadcastFile(
  name: string,
  fileName: string,
  data: Uint8Array
) {
  const { ydoc } = useCollaborationStore.getState();
  if (!ydoc) return;
  if (data.byteLength > MAX_FILE_SIZE) {
    console.warn(`File ${fileName} exceeds 5MB, not syncing to peers`);
    return;
  }

  const yFiles = ydoc.getMap("files");
  yFiles.set(name, {
    name,
    fileName,
    data: Array.from(data), // Y.js serializable
  });
}

/**
 * Start observing file changes from peers and load them locally.
 */
export function observeRemoteFiles() {
  const { ydoc } = useCollaborationStore.getState();
  if (!ydoc) return;

  const yFiles = ydoc.getMap("files");
  const loadedNames = new Set<string>();

  yFiles.observe(async () => {
    const { tables } = useWorkspaceStore.getState();
    const existingNames = new Set(tables.map((t) => t.name));

    yFiles.forEach(
      (value: { name: string; fileName: string; data: number[] }, key: string) => {
        if (existingNames.has(key) || loadedNames.has(key)) return;
        loadedNames.add(key);

        const buffer = new Uint8Array(value.data);
        loadBufferAsTable(value.name, value.fileName, buffer)
          .then((table) => {
            useWorkspaceStore.getState().addTable(table, value.fileName, buffer);
          })
          .catch((err) => {
            console.error(`Failed to load remote file ${value.fileName}:`, err);
          });
      }
    );
  });
}
