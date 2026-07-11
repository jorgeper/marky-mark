import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { AuxWindow } from './AuxWindow';
import { windowRole } from './lib/windowRole';
import './styles.css';

// SPEC13 §4.1: aux windows load the same bundle with ?window=settings|about.
const role = windowRole(window.location.search);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>{role === 'main' ? <App /> : <AuxWindow kind={role} />}</React.StrictMode>
);
