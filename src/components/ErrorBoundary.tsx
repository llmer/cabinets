import { Component, ErrorInfo, ReactNode } from "react";
import { color, font } from "@/theme";

interface Props {
  children: ReactNode;
  /** Friendly message shown in place of the crashed subtree. */
  label?: string;
  /** Reset the boundary when this value changes (e.g. the active view). */
  resetKey?: unknown;
}

interface State {
  error: Error | null;
}

/**
 * Catches render/runtime errors in a subtree so one failing view (e.g. 3D when
 * WebGL is unavailable) degrades gracefully instead of white-screening the app.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("View error:", error, info.componentStack);
  }

  override componentDidUpdate(prev: Props) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  override render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 40, maxWidth: 560 }}>
          <div style={{ fontFamily: font.serif, fontStyle: "italic", fontSize: 24, marginBottom: 8 }}>
            {this.props.label ?? "Something went wrong in this view."}
          </div>
          <div style={{ fontFamily: font.mono, fontSize: 12, color: color.faint, lineHeight: 1.6 }}>
            {this.state.error.message}
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
