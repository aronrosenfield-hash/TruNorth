// Phase 3.3 — Tab-level error boundary.
// Replaces white-screen crashes with a recoverable "Something went wrong" card.
// Auto-tracks errors to PostHog so we see them in analytics.

import { Component } from "react";
import { track } from "./analytics";

export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, errorMsg: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, errorMsg: String(error?.message || error || "unknown error") };
  }

  componentDidCatch(error, errorInfo) {
    // Log to console for dev + send to PostHog for production.
    // eslint-disable-next-line no-console
    console.error(`[ErrorBoundary:${this.props.name}]`, error, errorInfo);
    try {
      track("error_boundary_hit", {
        boundary: this.props.name || "unknown",
        message: String(error?.message || error).slice(0, 200),
        stack: String(error?.stack || "").slice(0, 500),
      });
    } catch { /* analytics errors silently */ }
  }

  reset = () => this.setState({ hasError: false, errorMsg: null });

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div style={{
        padding: "32px 20px",
        textAlign: "center",
        color: "#f2f2f2",
        minHeight: 240,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
      }}>
        <div style={{
          fontSize: 36,
          marginBottom: 12,
          opacity: 0.7,
        }} aria-hidden="true">⚠️</div>
        <div style={{
          fontSize: 16,
          fontWeight: 600,
          marginBottom: 6,
        }}>Something went wrong</div>
        <div style={{
          fontSize: 13,
          color: "#888",
          marginBottom: 20,
          maxWidth: 280,
          lineHeight: 1.5,
        }}>
          The {this.props.name || "page"} hit a snag. Try again, or switch tabs.
        </div>
        <button
          onClick={this.reset}
          style={{
            background: "#38C0CE",
            color: "white",
            border: "none",
            borderRadius: 10,
            padding: "10px 20px",
            fontSize: 14,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Try again
        </button>
        {import.meta.env.DEV && this.state.errorMsg && (
          <div style={{
            marginTop: 20,
            padding: "8px 12px",
            background: "#1a1a1a",
            border: "1px solid #2a2a2a",
            borderRadius: 8,
            fontSize: 11,
            color: "#888",
            fontFamily: "monospace",
            maxWidth: 320,
            wordBreak: "break-word",
          }}>
            {this.state.errorMsg}
          </div>
        )}
      </div>
    );
  }
}
