"use client";

import { useCollaborationStore } from "@/stores/collaboration-store";

/**
 * Renders remote peer cursor indicators.
 * In practice, y-monaco handles cursor rendering inside Monaco.
 * This component shows a legend of connected peers outside the editor.
 */
export default function PeerCursors() {
  const remotePeers = useCollaborationStore((s) => s.remotePeers);

  if (remotePeers.length === 0) return null;

  return (
    <div className="flex items-center gap-1.5 px-2 py-1 text-[10px]">
      {remotePeers.map((peer) => (
        <span
          key={peer.id}
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full"
          style={{ backgroundColor: `${peer.color}15`, color: peer.color }}
        >
          <span
            className="w-1.5 h-1.5 rounded-full"
            style={{ backgroundColor: peer.color }}
          />
          {peer.name}
        </span>
      ))}
    </div>
  );
}
