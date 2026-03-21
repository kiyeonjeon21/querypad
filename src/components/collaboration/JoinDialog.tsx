"use client";

import { useState, useCallback } from "react";

interface JoinDialogProps {
  onJoin: (roomId: string, host: string) => void;
  onCreate: (host: string) => void;
  onClose: () => void;
  connecting: boolean;
}

const DEFAULT_HOST = "localhost:1999";

export default function JoinDialog({
  onJoin,
  onCreate,
  onClose,
  connecting,
}: JoinDialogProps) {
  const [mode, setMode] = useState<"create" | "join">("create");
  const [roomId, setRoomId] = useState("");
  const [host, setHost] = useState(DEFAULT_HOST);

  const handleSubmit = useCallback(() => {
    if (mode === "create") {
      onCreate(host);
    } else {
      if (!roomId.trim()) return;
      onJoin(roomId.trim(), host);
    }
  }, [mode, roomId, host, onJoin, onCreate]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-sm mx-4">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
          <h2 className="text-sm font-semibold text-gray-800">Collaborate</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-700 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-4">
          {/* Mode toggle */}
          <div className="flex gap-1 mb-4 p-0.5 bg-gray-100 rounded-lg">
            <button
              onClick={() => setMode("create")}
              className={`flex-1 py-1.5 text-xs rounded-md transition-colors ${
                mode === "create"
                  ? "bg-white text-gray-800 font-medium shadow-sm"
                  : "text-gray-500"
              }`}
            >
              Create Room
            </button>
            <button
              onClick={() => setMode("join")}
              className={`flex-1 py-1.5 text-xs rounded-md transition-colors ${
                mode === "join"
                  ? "bg-white text-gray-800 font-medium shadow-sm"
                  : "text-gray-500"
              }`}
            >
              Join Room
            </button>
          </div>

          {mode === "join" && (
            <div className="mb-3">
              <label className="block text-[11px] text-gray-500 mb-1">
                Room ID
              </label>
              <input
                value={roomId}
                onChange={(e) => setRoomId(e.target.value)}
                placeholder="Enter room ID"
                className="w-full px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg outline-none focus:border-blue-400"
              />
            </div>
          )}

          <div className="mb-4">
            <label className="block text-[11px] text-gray-500 mb-1">
              PartyKit Host
            </label>
            <input
              value={host}
              onChange={(e) => setHost(e.target.value)}
              placeholder="localhost:1999"
              className="w-full px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg outline-none focus:border-blue-400"
            />
          </div>

          <button
            onClick={handleSubmit}
            disabled={connecting || (mode === "join" && !roomId.trim())}
            className="w-full py-2 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {connecting
              ? "Connecting..."
              : mode === "create"
              ? "Create Room"
              : "Join Room"}
          </button>
        </div>
      </div>
    </div>
  );
}
