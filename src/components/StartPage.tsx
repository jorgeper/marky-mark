// PRD 007 Req 21/22: the start page's action list — one component for all
// four flavors, fed by the pure capability→actions mapping in
// lib/startActions.ts. Nothing here knows which flavor is running: it renders
// the list it is handed, so the hosted page's three buttons and the desktop's
// four come from the same code and the same rules as the File menu.

import { START_ACTION_LABELS, type StartActionId } from '../lib/startActions';

export function StartPage({
  actions,
  onAction,
  disabledActions,
}: {
  actions: StartActionId[];
  onAction: (id: StartActionId) => void;
  /**
   * PRD 017 Req 10: actions the deployment refuses for this caller — VISIBLE
   * but disabled, each with the one-line hint to render beneath it (worded
   * from the server's `createRefusal`). Absent means nothing is refused.
   */
  disabledActions?: Partial<Record<StartActionId, string>>;
}) {
  return (
    <div className="start-actions" data-testid="start-actions">
      {/* The drop target: always present, on every flavor — a Markdown file
          dragged onto the window opens, hosted included (client-side, never
          uploaded). It is a hint, not a button, so it carries no action id. */}
      <p className="splash-drop" data-testid="start-drop">
        Drop a file to open
      </p>
      <div className="start-action-row">
        {actions.map((id) => {
          const hint = disabledActions?.[id];
          return (
            <div key={id} className="start-action-cell">
              <button
                type="button"
                className="start-action"
                data-testid={`start-${id}`}
                disabled={hint !== undefined}
                onClick={() => onAction(id)}
              >
                {START_ACTION_LABELS[id]}
              </button>
              {/* PRD 017 Req 10: the reason rides under the greyed action. */}
              {hint !== undefined && (
                <p className="start-action-hint" data-testid={`start-${id}-hint`}>
                  {hint}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
