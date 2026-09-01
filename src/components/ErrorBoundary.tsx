import { Component, type ReactNode } from 'react';
import { Button } from './ui/Button';

/**
 * Issue #136: the root error boundary. The app previously rendered bare under
 * StrictMode, so any render-time throw unmounted the whole tree and left a
 * permanently blank window with no way back. This boundary replaces that
 * failure mode with a visible error surface and a recovery action (reload the
 * app — a full restart back to the start page / restored session). Per
 * CODING_STANDARDS § Style there is no console call site: the throw's message
 * is shown in the surface itself.
 *
 * Styling lives in styles.css under `.error-boundary` (PRD 018 Req 18): that
 * rule defines local `--mm-*` fallback values, so the surface stays
 * self-contained even though it renders outside `.theme-root` — a crash in
 * theme or layout state still gets a legible error screen.
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
      <div data-testid="error-boundary" role="alert" className="error-boundary">
        <div className="eb-title">Something went wrong</div>
        <div className="eb-detail">{this.state.error.message || String(this.state.error)}</div>
        <Button data-testid="error-reload" onClick={() => window.location.reload()}>
          Reload Marky Mark
        </Button>
      </div>
    );
  }
}
