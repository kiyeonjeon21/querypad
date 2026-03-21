"use client";

import { Component, type ReactNode } from "react";
import type { QueryResult } from "@/types";
import type { PluginExtension } from "@/types/plugin";

interface ErrorBoundaryProps {
  children: ReactNode;
  pluginName: string;
}

interface ErrorBoundaryState {
  error: Error | null;
}

class PluginErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="p-4">
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-sm font-medium text-red-800">
              Plugin &quot;{this.props.pluginName}&quot; crashed
            </p>
            <pre className="mt-1 text-xs text-red-600 whitespace-pre-wrap font-mono">
              {this.state.error.message}
            </pre>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

interface PluginVisualizationProps {
  extension: Extract<PluginExtension, { type: "visualization" }>;
  pluginName: string;
  result: QueryResult;
}

export default function PluginVisualization({
  extension,
  pluginName,
  result,
}: PluginVisualizationProps) {
  const VisComponent = extension.component;
  return (
    <PluginErrorBoundary pluginName={pluginName}>
      <VisComponent result={result} />
    </PluginErrorBoundary>
  );
}
