import { Component, type ReactNode } from 'react';

/**
 * Issue #136: the root error boundary. The app previously rendered bare under
 * StrictMode, so any render-time throw unmounted the whole tree and left a
 * permanently blank window with no way back. This boundary replaces that
 * failure mode with a visible error surface and a recovery action (reload the
 * app — a full restart back to the start page / restored session). Per
 * CODING_STANDARDS § Style there is no console call site: the throw's message
 * is shown in the surface itself.
 *
 * Styling is inline on purpose: the boundary must render even when the crash
 * came from theme or layout state, so it depends on nothing but React.
 */

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div
        data-testid="error-boundary"
        role="alert"
        style={{
          position: 'fixed',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '12px',
          padding: '24px',
          background: '#1e1e1e',
          color: '#e8e8e8',
          fontFamily: 'system-ui, sans-serif',
          textAlign: 'center',
        }}
      >
        <div style={{ fontSize: '18px', fontWeight: 600 }}>Something went wrong</div>
        <div style={{ fontSize: '13px', opacity: 0.8, maxWidth: '560px', overflowWrap: 'anywhere' }}>
          {this.state.error.message || String(this.state.error)}
        </div>
        <button
          type="button"
          data-testid="error-reload"
          onClick={() => window.location.reload()}
          style={{
            marginTop: '8px',
            padding: '8px 20px',
            fontSize: '14px',
            borderRadius: '6px',
            border: '1px solid #555',
            background: '#2d2d2d',
            color: '#e8e8e8',
            cursor: 'pointer',
          }}
        >
          Reload Marky Mark
        </button>
      </div>
    );
  }
}
