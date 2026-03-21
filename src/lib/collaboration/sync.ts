import type { Doc as YDoc } from "yjs";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useCollaborationStore } from "@/stores/collaboration-store";
import type { PeerInfo } from "@/types/collaboration";

let isRemoteUpdate = false;
let unsubscribeStore: (() => void) | null = null;

/**
 * Connect to a collaboration room using PartyKit + Y.js.
 * All Y.js/PartyKit imports are dynamic to keep the bundle small when not collaborating.
 */
export async function connectToRoom(roomId: string, host: string) {
  const collabStore = useCollaborationStore.getState();
  collabStore.setConnecting(true);

  try {
    const Y = await import("yjs");
    const { WebsocketProvider } = await import("y-partykit/provider");

    const ydoc = new Y.Doc();
    const provider = new WebsocketProvider(host, roomId, ydoc);

    collabStore.setYDoc(ydoc);
    collabStore.setProvider(provider);
    collabStore.setRoom(roomId);

    // Awareness for peer cursors
    const awareness = provider.awareness;
    const localPeer = collabStore.localPeer;
    awareness.setLocalStateField("peer", localPeer);

    awareness.on("change", () => {
      const states = awareness.getStates();
      const peers: PeerInfo[] = [];
      states.forEach((state: Record<string, unknown>, clientId: number) => {
        if (clientId !== awareness.clientID && state.peer) {
          peers.push(state.peer as PeerInfo);
        }
      });
      useCollaborationStore.getState().setRemotePeers(peers);
    });

    provider.on("status", ({ status }: { status: string }) => {
      useCollaborationStore
        .getState()
        .setConnected(status === "connected");
    });

    // Sync tabs from workspace to Y.js
    const yTabs = ydoc.getArray("tabs");

    // Initial sync: if Y.js has data, pull it; otherwise push local
    if (yTabs.length > 0) {
      syncYTabsToStore(yTabs);
    } else {
      syncStoreTabsToY(ydoc);
    }

    // Y.js → Store
    yTabs.observe(() => {
      if (isRemoteUpdate) return;
      isRemoteUpdate = true;
      syncYTabsToStore(yTabs);
      isRemoteUpdate = false;
    });

    // Store → Y.js
    unsubscribeStore = useWorkspaceStore.subscribe((state, prev) => {
      if (isRemoteUpdate) return;
      if (state.tabs !== prev.tabs || state.activeTabId !== prev.activeTabId) {
        isRemoteUpdate = true;
        syncStoreTabsToY(ydoc);
        isRemoteUpdate = false;
      }
    });

    collabStore.setConnecting(false);
    collabStore.setConnected(true);
  } catch (err) {
    collabStore.setConnecting(false);
    throw err;
  }
}

export function disconnectFromRoom() {
  const { provider, ydoc } = useCollaborationStore.getState();
  if (provider) {
    provider.disconnect();
    provider.destroy();
  }
  if (ydoc) {
    ydoc.destroy();
  }
  if (unsubscribeStore) {
    unsubscribeStore();
    unsubscribeStore = null;
  }
  useCollaborationStore.getState().reset();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function syncYTabsToStore(yTabs: any) {
  const tabs = yTabs.toArray().map((yTab: Record<string, unknown>) => ({
    id: yTab.id as string,
    title: yTab.title as string,
    query: yTab.query as string,
    result: null,
    error: null,
    isExecuting: false,
    createdAt: yTab.createdAt as number,
  }));

  if (tabs.length > 0) {
    useWorkspaceStore.setState({ tabs, activeTabId: tabs[0].id });
  }
}

function syncStoreTabsToY(ydoc: YDoc) {
  const { tabs } = useWorkspaceStore.getState();
  const yTabs = ydoc.getArray("tabs");

  ydoc.transact(() => {
    yTabs.delete(0, yTabs.length);
    for (const tab of tabs) {
      yTabs.push([
        {
          id: tab.id,
          title: tab.title,
          query: tab.query,
          createdAt: tab.createdAt,
        },
      ]);
    }
  });
}

/**
 * Get Y.Text for a specific tab's query, used by MonacoBinding.
 */
export function getYTextForTab(tabId: string): import("yjs").Text | null {
  const { ydoc } = useCollaborationStore.getState();
  if (!ydoc) return null;
  return ydoc.getText(`tab-query-${tabId}`);
}

/**
 * Get the awareness instance from the provider.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getAwareness(): any | null {
  const { provider } = useCollaborationStore.getState();
  return provider?.awareness ?? null;
}
