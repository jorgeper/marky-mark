import { useEffect, useState } from 'react';
import type { Theme } from '../lib/themes';

export interface ExportRequest {
  format: 'html' | 'pdf';
  includeComments: boolean;
  includeWordCount: boolean;
  /** 'current' or a theme id. */
  theme: string;
}

/**
 * SPEC17 §1 / SPEC18: the Export dialog. Format (static HTML page / PDF via the OS
 * print dialog), include-comments, include-word-count, and the sticky theme
 * select. Pure UI — the owner runs the export and persists the theme choice.
 */
export function ExportDialog({
  themes,
  initialTheme,
  canPdf,
  onThemeChange,
  onExport,
  onClose,
}: {
  themes: Theme[];
  initialTheme: string;
  canPdf: boolean;
  onThemeChange(theme: string): void;
  onExport(req: ExportRequest): void;
  onClose(): void;
}) {
  const [format, setFormat] = useState<'html' | 'pdf'>('html');
  const [includeComments, setIncludeComments] = useState(true);
  const [includeWordCount, setIncludeWordCount] = useState(true);
  const [theme, setTheme] = useState(initialTheme);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal export-modal" data-testid="export-dialog">
        <h2>Export</h2>

        <div className="field">
          <label>Format</label>
          <div className="inline-row">
            <label className="radio-label">
              <input
                type="radio"
                name="export-format"
                data-testid="export-format-html"
                checked={format === 'html'}
                onChange={() => setFormat('html')}
              />
              HTML — static reading page
            </label>
          </div>
          <div className="inline-row">
            <label className="radio-label">
              <input
                type="radio"
                name="export-format"
                data-testid="export-format-pdf"
                checked={format === 'pdf'}
                disabled={!canPdf}
                onChange={() => setFormat('pdf')}
              />
              PDF — via the system print dialog
            </label>
          </div>
        </div>

        <div className="checkbox-row">
          <input
            id="export-include-comments"
            type="checkbox"
            data-testid="export-include-comments"
            checked={includeComments}
            onChange={(e) => setIncludeComments(e.target.checked)}
          />
          <label htmlFor="export-include-comments" style={{ margin: 0, fontWeight: 400 }}>
            Include comments
          </label>
        </div>
        <div className="checkbox-row">
          <input
            id="export-include-wordcount"
            type="checkbox"
            data-testid="export-include-wordcount"
            checked={includeWordCount}
            onChange={(e) => setIncludeWordCount(e.target.checked)}
          />
          <label htmlFor="export-include-wordcount" style={{ margin: 0, fontWeight: 400 }}>
            Include word count
          </label>
        </div>

        <div className="field" style={{ marginTop: 10 }}>
          <label htmlFor="export-theme">Theme</label>
          <select
            id="export-theme"
            data-testid="export-theme"
            value={theme}
            onChange={(e) => {
              setTheme(e.target.value);
              onThemeChange(e.target.value); // sticky immediately (SPEC17 §4.2)
            }}
          >
            <option value="current">Current theme</option>
            {themes.map((t) => (
              <option value={t.id} key={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>

        <div className="actions">
          <button data-testid="export-cancel" onClick={onClose}>
            Cancel
          </button>
          <button
            className="primary"
            data-testid="export-run"
            onClick={() => onExport({ format, includeComments, includeWordCount, theme })}
          >
            Export
          </button>
        </div>
      </div>
    </div>
  );
}
