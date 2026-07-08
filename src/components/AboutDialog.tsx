import { useEffect } from 'react';
import { AppBadge } from './Toolbar';

/**
 * The About dialog (SPEC10 §3): app badge + name, the build-time version
 * (__APP_VERSION__, pre-release identifier intact), an alpha notice, the
 * developer credit, and the license. Escape / backdrop / Close dismiss it.
 */
export function AboutDialog({ onClose }: { onClose(): void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="modal about-dialog" data-testid="about-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className="about-head">
          <AppBadge size={40} testId="about-badge" />
          <div>
            <h2 data-testid="about-name">Marky Mark</h2>
            <p className="about-version" data-testid="about-version">
              v{__APP_VERSION__}
            </p>
          </div>
        </div>
        <p className="about-alpha" data-testid="about-alpha">
          Alpha — pre-release software, expect rough edges.
        </p>
        <p className="about-meta" data-testid="about-developer">
          Developer: Jorge Pereira
        </p>
        <p className="about-meta" data-testid="about-license">
          MIT License
        </p>
        <p className="about-meta">
          <a href="https://github.com/jorgeper/marky-mark" target="_blank" rel="noreferrer" data-testid="about-repo">
            github.com/jorgeper/marky-mark
          </a>
        </p>
        <div className="actions">
          <button data-testid="about-close" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
