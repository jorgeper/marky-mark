import { useEffect, useRef, useState } from 'react';
import type { Platform } from '../platform';

type Phase =
  | { kind: 'checking' }
  | { kind: 'none' }
  | { kind: 'available'; version: string; notes: string }
  | { kind: 'progress'; pct: number }
  | { kind: 'ready' }
  | { kind: 'error'; message: string };

/**
 * SPEC19 §2: the Check for Updates… dialog. Walks checking → up-to-date /
 * available → downloading → restart, with honest dismissable errors. All
 * network happens behind the platform seam (Rust-side, user-initiated).
 */
export function UpdateDialog({
  currentVersion,
  updates,
  onClose,
}: {
  currentVersion: string;
  updates: NonNullable<Platform['updates']>;
  onClose(): void;
}) {
  const [phase, setPhase] = useState<Phase>({ kind: 'checking' });
  const disposedRef = useRef(false);

  useEffect(() => {
    disposedRef.current = false;
    void (async () => {
      try {
        const found = await updates.check();
        if (disposedRef.current) return;
        setPhase(found ? { kind: 'available', version: found.version, notes: found.notes } : { kind: 'none' });
      } catch (err) {
        if (!disposedRef.current) setPhase({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
      }
    })();
    return () => {
      disposedRef.current = true;
    };
  }, [updates]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const install = () => {
    setPhase({ kind: 'progress', pct: 0 });
    void (async () => {
      try {
        await updates.downloadAndInstall((pct) => {
          if (!disposedRef.current) setPhase({ kind: 'progress', pct });
        });
        if (!disposedRef.current) setPhase({ kind: 'ready' });
      } catch (err) {
        if (!disposedRef.current) setPhase({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
      }
    })();
  };

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal update-modal" data-testid="update-dialog">
        <h2>Check for Updates</h2>

        {phase.kind === 'checking' && (
          <p className="update-line" data-testid="update-checking">
            Checking for updates…
          </p>
        )}

        {phase.kind === 'none' && (
          <p className="update-line" data-testid="update-none">
            You're up to date — Marky Mark v{currentVersion} is the latest version.
          </p>
        )}

        {phase.kind === 'available' && (
          <div data-testid="update-available">
            <p className="update-line">
              <strong>Marky Mark v{phase.version}</strong> is available (you have v{currentVersion}).
            </p>
            {phase.notes && <p className="update-notes">{phase.notes}</p>}
            <div className="actions">
              <button data-testid="update-later" onClick={onClose}>
                Later
              </button>
              <button className="primary" data-testid="update-install" onClick={install}>
                Install Update
              </button>
            </div>
          </div>
        )}

        {phase.kind === 'progress' && (
          <div data-testid="update-progress" data-pct={phase.pct}>
            <p className="update-line">Downloading… {phase.pct}%</p>
            <div className="update-bar">
              <div className="update-bar-fill" style={{ width: `${phase.pct}%` }} />
            </div>
          </div>
        )}

        {phase.kind === 'ready' && (
          <div>
            <p className="update-line">Update installed. Restart to finish.</p>
            <div className="actions">
              <button className="primary" data-testid="update-restart" onClick={() => void updates.restart()}>
                Restart Marky Mark
              </button>
            </div>
          </div>
        )}

        {phase.kind === 'error' && (
          <div data-testid="update-error">
            <p className="update-line">Couldn't check for updates: {phase.message}</p>
            <div className="actions">
              <button onClick={onClose}>Close</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
