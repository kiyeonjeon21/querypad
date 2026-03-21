"use client";

import { useCollaborationStore } from "@/stores/collaboration-store";
import { disconnectFromRoom } from "@/lib/collaboration/sync";

export default function RoomBar() {
  const roomId = useCollaborationStore((s) => s.roomId);
  const connected = useCollaborationStore((s) => s.connected);
  const remotePeers = useCollaborationStore((s) => s.remotePeers);
  const localPeer = useCollaborationStore((s) => s.localPeer);

  if (!roomId) return null;

  return (
    <div className="flex items-center gap-2 text-xs">
      {/* Connection status */}
      <div className="flex items-center gap-1.5">
        <div
          className={`w-2 h-2 rounded-full ${
            connected ? "bg-green-500" : "bg-yellow-500 animate-pulse"
          }`}
        />
        <span className="text-gray-500 font-mono">{roomId.slice(0, 8)}</span>
      </div>

      {/* Peers */}
      <div className="flex items-center -space-x-1">
        {/* Local peer */}
        <div
          className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold text-white border-2 border-white"
          style={{ backgroundColor: localPeer.color }}
          title={`${localPeer.name} (you)`}
        >
          {localPeer.name[0]}
        </div>
        {remotePeers.map((peer) => (
          <div
            key={peer.id}
            className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold text-white border-2 border-white"
            style={{ backgroundColor: peer.color }}
            title={peer.name}
          >
            {peer.name[0]}
          </div>
        ))}
      </div>

      <span className="text-gray-400">
        {1 + remotePeers.length} online
      </span>

      <button
        onClick={disconnectFromRoom}
        className="px-2 py-0.5 text-[10px] text-gray-500 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
      >
        Leave
      </button>
    </div>
  );
}
