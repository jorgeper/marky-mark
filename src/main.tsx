import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { AuxWindow } from './AuxWindow';
import { ErrorBoundary } from './components/ErrorBoundary';
import { HostedShell } from './components/HostedSignIn';
import { detectHostedMode } from './lib/hostedGate';
import { windowRole } from './lib/windowRole';
import './styles.css';
// PRD 021 Req 7 (issue #238): the editor/preview/split styles ship with the
// package. Imported AFTER styles.css — the package sheet's rules must keep
// winning the same-specificity ties they won by source order in the one file
// (e.g. .smart-edit-menu over .theme-menu, .table-chip over .icon-btn). The
// app does NOT import the package's default-theme.css: themes stay injected
// at runtime by src/themeRuntime.ts.
import '@marky-mark/editor/styles.css';

// SPEC13 §4.1: aux windows load the same bundle with ?window=settings|about.
const role = windowRole(window.location.search);

// PRD 007 Req 5: only HTML served by the hosted backend carries the injected
// marker, so Tauri, the dev shim, and static web hosting resolve null here
// and boot exactly as before — the sign-in gate exists for them nowhere.
const hostedMode = detectHostedMode(document);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {/* Issue #136: a render-time throw used to unmount the bare tree to a
        permanently blank window — the boundary keeps a recoverable surface. */}
    <ErrorBoundary>
      {role !== 'main' ? <AuxWindow kind={role} /> : hostedMode ? <HostedShell mode={hostedMode} /> : <App />}
    </ErrorBoundary>
  </React.StrictMode>
);
