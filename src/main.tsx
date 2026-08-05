import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { AuxWindow } from './AuxWindow';
import { HostedShell } from './components/HostedSignIn';
import { detectHostedMode } from './lib/hostedGate';
import { windowRole } from './lib/windowRole';
import './styles.css';

// SPEC13 §4.1: aux windows load the same bundle with ?window=settings|about.
const role = windowRole(window.location.search);

// PRD 007 Req 5: only HTML served by the hosted backend carries the injected
// marker, so Tauri, the dev shim, and static web hosting resolve null here
// and boot exactly as before — the sign-in gate exists for them nowhere.
const hostedMode = detectHostedMode(document);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {role !== 'main' ? <AuxWindow kind={role} /> : hostedMode ? <HostedShell mode={hostedMode} /> : <App />}
  </React.StrictMode>
);
