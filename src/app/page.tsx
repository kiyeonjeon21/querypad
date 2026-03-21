"use client";

import dynamic from "next/dynamic";

const Workspace = dynamic(() => import("@/components/workspace/Workspace"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-screen bg-white">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-sm text-gray-500">Loading...</p>
      </div>
    </div>
  ),
});

export default function Home() {
  return <Workspace />;
}
