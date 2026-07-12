/**
 * SPEC13 §4.1: which React root this window mounts. The main window has no
 * ?window= param; aux windows are created with ?window=settings|about.
 * Pure — unit-testable, no DOM.
 */
export type WindowRole = 'main' | 'settings' | 'about';

export function windowRole(search: string): WindowRole {
  const v = new URLSearchParams(search).get('window');
  return v === 'settings' || v === 'about' ? v : 'main';
}
