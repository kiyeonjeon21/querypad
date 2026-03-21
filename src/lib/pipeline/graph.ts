import type { PipelineStep } from "@/types/pipeline";

export interface AdjacencyList {
  [stepId: string]: string[]; // stepId -> list of dependent stepIds
}

/**
 * Build adjacency list from pipeline steps.
 * Detects references by checking if a step name appears as a word boundary in another step's SQL.
 */
export function buildAdjacencyList(steps: PipelineStep[]): AdjacencyList {
  const adj: AdjacencyList = {};
  for (const step of steps) {
    adj[step.id] = [];
  }

  for (const step of steps) {
    for (const other of steps) {
      if (step.id === other.id) continue;
      const regex = new RegExp(`\\b${escapeRegex(other.name)}\\b`, "i");
      if (regex.test(step.query)) {
        // other -> step (step depends on other)
        if (!adj[other.id].includes(step.id)) {
          adj[other.id].push(step.id);
        }
      }
    }
  }

  return adj;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Extract edges for DAG visualization: [sourceStepId, targetStepId]
 */
export function extractEdges(steps: PipelineStep[]): [string, string][] {
  const edges: [string, string][] = [];
  for (const step of steps) {
    for (const other of steps) {
      if (step.id === other.id) continue;
      const regex = new RegExp(`\\b${escapeRegex(other.name)}\\b`, "i");
      if (regex.test(step.query)) {
        edges.push([other.id, step.id]);
      }
    }
  }
  return edges;
}

/**
 * Topological sort using Kahn's algorithm. Returns null if cycle detected.
 */
export function topologicalSort(steps: PipelineStep[]): PipelineStep[] | null {
  const adj = buildAdjacencyList(steps);
  const inDegree: Record<string, number> = {};

  for (const step of steps) {
    inDegree[step.id] = 0;
  }

  for (const [, targets] of Object.entries(adj)) {
    for (const t of targets) {
      inDegree[t] = (inDegree[t] ?? 0) + 1;
    }
  }

  const queue: string[] = [];
  for (const step of steps) {
    if (inDegree[step.id] === 0) {
      queue.push(step.id);
    }
  }

  const sorted: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    sorted.push(id);
    for (const neighbor of adj[id] ?? []) {
      inDegree[neighbor]--;
      if (inDegree[neighbor] === 0) {
        queue.push(neighbor);
      }
    }
  }

  if (sorted.length !== steps.length) {
    return null; // cycle detected
  }

  const idToStep = new Map(steps.map((s) => [s.id, s]));
  return sorted.map((id) => idToStep.get(id)!);
}
