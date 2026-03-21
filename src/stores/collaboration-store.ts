import { create } from "zustand";
import type { PeerInfo } from "@/types/collaboration";

const PEER_COLORS = [
  "#3b82f6", "#ef4444", "#22c55e", "#f59e0b",
  "#8b5cf6", "#ec4899", "#14b8a6", "#f97316",
];

function randomColor() {
  return PEER_COLORS[Math.floor(Math.random() * PEER_COLORS.length)];
}

function randomName() {
  const adjectives = ["Swift", "Bold", "Calm", "Keen", "Warm"];
  const animals = ["Fox", "Owl", "Bear", "Wolf", "Deer"];
  return `${adjectives[Math.floor(Math.random() * adjectives.length)]} ${animals[Math.floor(Math.random() * animals.length)]}`;
}

interface CollaborationState {
  // Room
  roomId: string | null;
  connected: boolean;
  connecting: boolean;

  // Peers
  localPeer: PeerInfo;
  remotePeers: PeerInfo[];

  // Y.js doc & provider (stored as any to avoid importing yjs at module level)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ydoc: any | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  provider: any | null;

  // Actions
  setRoom: (roomId: string | null) => void;
  setConnected: (connected: boolean) => void;
  setConnecting: (connecting: boolean) => void;
  setRemotePeers: (peers: PeerInfo[]) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setYDoc: (doc: any) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setProvider: (provider: any) => void;
  reset: () => void;
}

export const useCollaborationStore = create<CollaborationState>((set) => ({
  roomId: null,
  connected: false,
  connecting: false,
  localPeer: {
    id: crypto.randomUUID(),
    name: randomName(),
    color: randomColor(),
  },
  remotePeers: [],
  ydoc: null,
  provider: null,

  setRoom: (roomId) => set({ roomId }),
  setConnected: (connected) => set({ connected }),
  setConnecting: (connecting) => set({ connecting }),
  setRemotePeers: (remotePeers) => set({ remotePeers }),
  setYDoc: (ydoc) => set({ ydoc }),
  setProvider: (provider) => set({ provider }),
  reset: () =>
    set({
      roomId: null,
      connected: false,
      connecting: false,
      remotePeers: [],
      ydoc: null,
      provider: null,
    }),
}));
