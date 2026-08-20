/**
 * PRD 013 Reqs 1–4: the file tab strip — a pure view of the SPEC36 §1 open
 * set, in the FolderPanel mold: props in, callbacks out, no platform access
 * beyond the passed `basename` seam. The owner (App) holds the open list,
 * the active path and all activation I/O; this component renders one tab per
 * open file (plus the ephemeral untitled tab) and forwards clicks. It holds
 * no list of its own — `openFiles` IS the SPEC36 state, already tree-ordered.
 */

export interface FileTabStripProps {
  /** SPEC36 §1: the open set, tree-ordered — exactly one tab each. */
  openFiles: string[];
  /** The active document's path (its tab renders active); null = none. */
  activePath: string | null;
  /**
   * PRD 013 Req 8 (scoped to #144): an untitled buffer is open — it renders
   * as an active tab labeled "Untitled" after the open set's tabs. Its close
   * affordance and Save As replacement land in issue #146.
   */
  untitled: boolean;
  basename(path: string): string;
  /**
   * PRD 013 Req 3: activate through the owner's existing SPEC36 path — the
   * very call the sidebar's open row makes (openDocGuarded), so park/restore,
   * dirty flags, scroll, undo history and mode behave identically. Only ever
   * called for an INACTIVE tab; the active-tab no-op guard lives here.
   */
  onActivate(path: string): void;
}

/** One tab: a real keyboard-reachable button, ellipsis-clipped, tooltipped. */
function Tab({ active, label, title, path, onClick }: {
  active: boolean;
  label: string;
  title: string;
  path: string;
  onClick?: () => void;
}) {
  return (
    <button
      className={`file-tab${active ? ' active' : ''}`}
      data-testid="file-tab"
      // `data-tab`, deliberately NOT the sidebar's `data-path`: e2e drives
      // rows through page-level `[data-path=…]` locators, and a second
      // element carrying the attribute would break their strict resolution.
      data-tab={path}
      // PRD 013 Req 3: a state a test can assert, beside the class and
      // aria-selected — the basic active/inactive distinction (the full
      // plane-and-shadow treatment is issue #148).
      data-active={active ? 'true' : 'false'}
      role="tab"
      aria-selected={active}
      // PRD 013 Req 4: the tooltip carries the full path, so duplicate
      // basenames across folders stay tellable apart.
      title={title}
      onClick={onClick}
    >
      <span className="file-tab-label">{label}</span>
    </button>
  );
}

export function FileTabStrip(p: FileTabStripProps) {
  return (
    <div className="file-tab-strip" data-testid="file-tab-strip" role="tablist">
      {p.openFiles.map((path) => {
        const active = path === p.activePath;
        return (
          <Tab
            key={path}
            active={active}
            label={p.basename(path)}
            title={path}
            path={path}
            // PRD 013 Req 3: clicking the ACTIVE tab is a no-op — no re-open,
            // no re-read from disk, no park/restore churn. The guard sits
            // here so the owner's handler stays exactly the sidebar's call.
            onClick={active ? undefined : () => p.onActivate(path)}
          />
        );
      })}
      {p.untitled && (
        // PRD 013 Req 8 (scoped to #144): the untitled buffer sits outside
        // the SPEC36 set (§2.6), so its tab is appended here rather than
        // derived from openFiles; it is always the active one (docPath is
        // null while untitled), and clicking it is inert.
        <Tab active label="Untitled" title="Untitled" path="" />
      )}
    </div>
  );
}
