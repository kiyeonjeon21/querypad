"use client";

import { useMemo, useCallback } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  type Node,
  type Edge,
} from "@xyflow/react";
import dagre from "@dagrejs/dagre";
import { extractEdges } from "@/lib/pipeline/graph";
import type { PipelineStep, PipelineExecutionResult } from "@/types/pipeline";
import "@xyflow/react/dist/style.css";

interface PipelineDagProps {
  steps: PipelineStep[];
  results: Record<string, PipelineExecutionResult>;
  selectedStepId: string | null;
  onSelectStep: (id: string) => void;
}

const NODE_WIDTH = 180;
const NODE_HEIGHT = 50;

function getLayoutedElements(nodes: Node[], edges: Edge[]) {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "TB", nodesep: 50, ranksep: 80 });

  nodes.forEach((node) => {
    g.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  });
  edges.forEach((edge) => {
    g.setEdge(edge.source, edge.target);
  });

  dagre.layout(g);

  const layoutedNodes = nodes.map((node) => {
    const pos = g.node(node.id);
    return {
      ...node,
      position: {
        x: pos.x - NODE_WIDTH / 2,
        y: pos.y - NODE_HEIGHT / 2,
      },
    };
  });

  return { nodes: layoutedNodes, edges };
}

export default function PipelineDag({
  steps,
  results,
  selectedStepId,
  onSelectStep,
}: PipelineDagProps) {
  const { nodes, edges } = useMemo(() => {
    const rawEdges = extractEdges(steps);

    const nodes: Node[] = steps.map((step) => {
      const r = results[step.id];
      let bg = "#fff";
      let border = "#d1d5db";
      if (r) {
        if (r.error) {
          bg = "#fef2f2";
          border = "#f87171";
        } else {
          bg = "#f0fdf4";
          border = "#4ade80";
        }
      }
      if (step.id === selectedStepId) {
        border = "#3b82f6";
      }

      return {
        id: step.id,
        data: { label: step.name || "(unnamed)" },
        position: { x: 0, y: 0 },
        style: {
          background: bg,
          border: `2px solid ${border}`,
          borderRadius: 8,
          padding: "8px 16px",
          fontSize: 13,
          fontFamily: "monospace",
          fontWeight: 500,
          cursor: "pointer",
          width: NODE_WIDTH,
        },
      };
    });

    const edges: Edge[] = rawEdges.map(([source, target]) => ({
      id: `${source}-${target}`,
      source,
      target,
      animated: true,
      style: { stroke: "#94a3b8", strokeWidth: 2 },
    }));

    return getLayoutedElements(nodes, edges);
  }, [steps, results, selectedStepId]);

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      onSelectStep(node.id);
    },
    [onSelectStep]
  );

  if (steps.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-gray-400">
        Add steps to see the DAG
      </div>
    );
  }

  return (
    <div className="h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodeClick={onNodeClick}
        fitView
        proOptions={{ hideAttribution: true }}
        nodesDraggable={false}
        nodesConnectable={false}
      >
        <Background color="#e5e7eb" gap={16} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
