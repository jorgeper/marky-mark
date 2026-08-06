import { useEffect, useState } from 'react';
import { checkPickerName, type PickerFolder, type SavePickerKind } from '../lib/savePicker';

/**
 * PRD 009 Req 13+14: the in-workspace name/folder picker — the ONE naming
 * surface New File and Save As… share on a flavor with no local save dialog.
 * The folder is chosen from the workspace's own folders (a select, never a
 * typed path), so nothing outside the workspace can be named; the name is
 * judged by the same `validateEntryName` rules the sidebar's rename row uses
 * and a collision in the target folder is refused outright. Pure UI: the
 * owner lists the folder and performs the write.
 */
export function SavePicker({
  kind,
  folders,
  initialFolder,
  initialName,
  listNames,
  onCancel,
  onCommit,
}: {
  kind: SavePickerKind;
  folders: PickerFolder[];
  initialFolder: string;
  initialName: string;
  /** The names already in a folder — asked again whenever the folder changes. */
  listNames(dir: string): Promise<string[]>;
  onCancel(): void;
  onCommit(folder: string, name: string): void;
}) {
  const [folder, setFolder] = useState(initialFolder);
  const [name, setName] = useState(initialName);
  const [existing, setExisting] = useState<string[] | null>(null);
  // The reason stays hidden until the user has typed or tried to commit —
  // Save As… opens pre-filled with the document's own name, which collides
  // with itself, and an error on an untouched dialog reads as a failure.
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    let live = true;
    setExisting(null);
    void listNames(folder).then((names) => {
      if (live) setExisting(names);
    });
    return () => {
      live = false;
    };
  }, [folder, listNames]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const check = checkPickerName(name, existing ?? []);
  const error = check.ok ? null : check.error;
  const commit = () => {
    setTouched(true);
    // A listing still in flight cannot rule out a collision yet — waiting is
    // the only answer that cannot clobber a file.
    if (existing === null || !check.ok) return;
    onCommit(folder, check.name);
  };

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="modal" data-testid="save-picker">
        <h2>{kind === 'new' ? 'New File' : 'Save As'}</h2>

        <div className="field">
          <label htmlFor="save-picker-name">Name</label>
          <input
            id="save-picker-name"
            data-testid="save-picker-name"
            type="text"
            className={touched && error ? 'invalid' : undefined}
            autoFocus
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setTouched(true);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commit();
              }
            }}
          />
        </div>

        <div className="field" style={{ marginTop: 10 }}>
          <label htmlFor="save-picker-folder">Folder</label>
          <select
            id="save-picker-folder"
            data-testid="save-picker-folder"
            value={folder}
            onChange={(e) => setFolder(e.target.value)}
          >
            {folders.map((f) => (
              <option value={f.path} key={f.path}>
                {f.label}
              </option>
            ))}
          </select>
        </div>

        {touched && error && (
          <p className="picker-error" data-testid="save-picker-error" style={{ fontSize: 13, marginTop: 10 }}>
            {error}
          </p>
        )}

        <div className="actions">
          <button data-testid="save-picker-cancel" onClick={onCancel}>
            Cancel
          </button>
          <button className="primary" data-testid="save-picker-confirm" onClick={commit}>
            {kind === 'new' ? 'Create' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
