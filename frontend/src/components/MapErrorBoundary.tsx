import { Component, type ErrorInfo, type ReactNode } from "react";

interface MapErrorBoundaryProps {
  children: ReactNode;
  resetKey?: string | number;
  fallbackText?: string;
  boundaryName?: string;
}

interface MapErrorBoundaryState {
  hasError: boolean;
}

export default class MapErrorBoundary extends Component<
  MapErrorBoundaryProps,
  MapErrorBoundaryState
> {
  state: MapErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): MapErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    const name = this.props.boundaryName ?? "map-boundary";
    // Keep map failures isolated while still surfacing diagnostics in devtools.
    console.error(`[${name}] map render failed`, error, info.componentStack);
  }

  componentDidUpdate(prevProps: MapErrorBoundaryProps) {
    if (
      this.state.hasError &&
      this.props.resetKey !== undefined &&
      this.props.resetKey !== prevProps.resetKey
    ) {
      this.setState({ hasError: false });
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="map-loading">
          {this.props.fallbackText ?? "Map unavailable"}
        </div>
      );
    }
    return this.props.children;
  }
}
