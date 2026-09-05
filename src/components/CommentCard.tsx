import { useState } from 'react';
import { type CommentColor, type CommentData, isComment, MARKER_COLORS } from '../lib/anchoring';
import { timeAgo } from '../lib/time';
import { Button } from './ui/Button';

/** Ported from ../md-with-comments — margin comment card with threads. */

interface Props {
  comment: CommentData;
  author: string;
  orphaned: boolean;
  active: boolean;
  /** Resolved card rendered ghosted in the margin flow (SPEC6 §3). */
  ghost?: boolean;
  /**
   * PRD 004 Req 15: the document has a comment store this build cannot
   * interpret, so every authoring control is withheld — the thread still
   * reads, it just cannot be replied to, edited, resolved or deleted.
   * Default false: every other call site keeps its editable card.
   */
  readOnly?: boolean;
  onActivate: (id: string) => void;
  onUpdate: (next: CommentData) => void;
  onDelete: (id: string) => void;
  /** PRD 022 Req 8 (issue #232): a swatch on the active card recolors the highlight. */
  onRecolor: (id: string, color: CommentColor) => void;
}

function newId(): string {
  return crypto.randomUUID();
}

export function CommentCard({
  comment: c,
  author,
  orphaned,
  active,
  ghost,
  readOnly = false,
  onActivate,
  onUpdate,
  onDelete,
  onRecolor,
}: Props) {
  // PRD 023 §1 (issue #283): the card branches on the kind discriminant —
  // a comment record carries the note/thread/resolve lifecycle; a highlight
  // record's card (active-only, per the PRD 022 Req 9 standing-card rule)
  // offers recolor, "add note" and remove.
  const noted = isComment(c) ? c : null;
  const resolved = noted?.resolved ?? false;
  const [replying, setReplying] = useState(false);
  const [replyDraft, setReplyDraft] = useState('');
  const [editing, setEditing] = useState<string | null>(null); // 'root' or reply id
  const [editDraft, setEditDraft] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const submitReply = () => {
    const body = replyDraft.trim();
    if (!body || !noted) return;
    onUpdate({
      ...noted,
      thread: [...noted.thread, { id: newId(), author, createdAt: new Date().toISOString(), body }],
    });
    setReplyDraft('');
    setReplying(false);
  };

  const saveEdit = () => {
    const body = editDraft.trim();
    if (!body || editing === null) return;
    if (editing === 'root') {
      if (noted) {
        onUpdate({ ...noted, body });
      } else if (c.kind === 'highlight') {
        // PRD 023 §1 (issue #283): adding a note to a highlight authors a
        // kind:"comment" record in its place — same id and anchor, the color
        // dropped (a comment renders in the fixed comment tint, never a
        // marker hue).
        const { color: _color, ...base } = c;
        onUpdate({ ...base, kind: 'comment', body, resolved: false, thread: [] });
      }
    } else if (noted) {
      onUpdate({ ...noted, thread: noted.thread.map((r) => (r.id === editing ? { ...r, body } : r)) });
    }
    setEditing(null);
  };

  const editorKeys = (e: React.KeyboardEvent, submit: () => void, cancel: () => void) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    } else if (e.key === 'Escape') {
      cancel();
    }
  };

  const stop = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <div
      className={`card${active ? ' active' : ''}${orphaned ? ' orphaned' : ''}${resolved ? ' resolved-card' : ''}${ghost ? ' resolved-ghost' : ''}`}
      data-testid="comment-card"
      data-cid={c.id}
      data-flowcard={resolved && !ghost ? undefined : c.id}
      onClick={() => onActivate(c.id)}
    >
      {orphaned && (
        <div className="orphan-row">
          <span className="badge orphan" data-testid="orphan-badge">
            Orphaned
          </span>
          <blockquote className="orphan-quote">“{c.anchor.exact}”</blockquote>
        </div>
      )}

      <div className="entry" data-testid="thread-entry">
        <div className="entry-meta">
          <strong>{c.author}</strong> <span className="time">{timeAgo(c.createdAt)}</span>
        </div>
        {editing === 'root' ? (
          <div onClick={stop}>
            <textarea
              className="field"
              data-testid="edit-input"
              value={editDraft}
              autoFocus
              onChange={(e) => setEditDraft(e.target.value)}
              onKeyDown={(e) => editorKeys(e, saveEdit, () => setEditing(null))}
            />
            <div className="row">
              <Button variant="quiet" size="sm" data-testid="save-edit" onClick={saveEdit}>
                Save
              </Button>
              <Button variant="quiet" size="sm" onClick={() => setEditing(null)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          // PRD 023 §1 (issue #283): a highlight record has no note to show —
          // no body paragraph, just the swatches and controls below.
          noted && (
            <p className="body" data-testid="card-body">
              {noted.body}
            </p>
          )
        )}
      </div>

      {noted && noted.thread.map((r) => (
        <div className="entry reply" data-testid="thread-entry" key={r.id}>
          <div className="entry-meta">
            <strong>{r.author}</strong> <span className="time">{timeAgo(r.createdAt)}</span>
          </div>
          {editing === r.id ? (
            <div onClick={stop}>
              <textarea
                className="field"
                data-testid="edit-input"
                value={editDraft}
                autoFocus
                onChange={(e) => setEditDraft(e.target.value)}
                onKeyDown={(e) => editorKeys(e, saveEdit, () => setEditing(null))}
              />
              <div className="row">
                <Button variant="quiet" size="sm" data-testid="save-edit" onClick={saveEdit}>
                  Save
                </Button>
                <Button variant="quiet" size="sm" onClick={() => setEditing(null)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <p className="body" data-testid="reply-body">
              {r.body}
            </p>
          )}
          {!readOnly && (
            <div className="row small" onClick={stop}>
              <Button
                variant="quiet"
                size="sm"
                data-testid="edit-reply"
                onClick={() => {
                  setEditing(r.id);
                  setEditDraft(r.body);
                }}
              >
                Edit
              </Button>
              <Button
                variant="quiet"
                size="sm"
                data-testid="delete-reply"
                onClick={() => onUpdate({ ...noted, thread: noted.thread.filter((x) => x.id !== r.id) })}
              >
                Delete
              </Button>
            </div>
          )}
        </div>
      ))}

      {replying && (
        <div onClick={stop}>
          <textarea
            className="field"
            data-testid="reply-input"
            placeholder="Reply…"
            value={replyDraft}
            autoFocus
            onChange={(e) => setReplyDraft(e.target.value)}
            onKeyDown={(e) => editorKeys(e, submitReply, () => setReplying(false))}
          />
          <div className="row">
            <Button variant="quiet" size="sm" data-testid="submit-reply" onClick={submitReply}>
              Reply
            </Button>
            <Button variant="quiet" size="sm" onClick={() => setReplying(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* PRD 022 Req 8 (issue #232), narrowed by PRD 023 §1 (issue #283): the
          active HIGHLIGHT card offers recolor — the four marker swatches in
          MARKER_COLORS order, the entry's current color wearing the ring. A
          comment record has no color to change, so its card has no swatch
          row. An authoring control, withheld read-only like the rest. */}
      {active && !readOnly && c.kind === 'highlight' && (
        <div className="row card-swatches" data-testid="card-swatches" onClick={stop}>
          {MARKER_COLORS.map((color) => (
            <button
              key={color}
              className={`icon-btn marker-swatch marker-swatch-${color}${c.color === color ? ' armed' : ''}`}
              data-testid={`card-swatch-${color}`}
              aria-label={`Recolor ${color}`}
              aria-pressed={c.color === color}
              onClick={() => onRecolor(c.id, color)}
            />
          ))}
        </div>
      )}

      {!readOnly && (
        <div className="row controls" onClick={stop}>
          {confirmingDelete ? (
            <>
              <span className="confirm-label">Delete thread?</span>
              <Button
                variant="quiet"
                size="sm"
                className="btn-danger"
                data-testid="confirm-delete"
                onClick={() => onDelete(c.id)}
              >
                Delete
              </Button>
              <Button variant="quiet" size="sm" data-testid="cancel-delete" onClick={() => setConfirmingDelete(false)}>
                Cancel
              </Button>
            </>
          ) : (
            <>
              {noted && !noted.resolved && (
                <>
                  <Button variant="quiet" size="sm" data-testid="reply-btn" onClick={() => setReplying(true)}>
                    Reply
                  </Button>
                  <Button
                    variant="quiet"
                    size="sm"
                    data-testid="edit-btn"
                    onClick={() => {
                      setEditing('root');
                      setEditDraft(noted.body);
                    }}
                  >
                    Edit
                  </Button>
                  <Button
                    variant="quiet"
                    size="sm"
                    data-testid="resolve-btn"
                    onClick={() => onUpdate({ ...noted, resolved: true })}
                  >
                    Resolve
                  </Button>
                </>
              )}
              {/* PRD 023 §1 (issue #283): "add note" on a highlight card opens
                  note editing; submitting authors a comment record in the
                  highlight's place (saveEdit above). */}
              {!noted && editing !== 'root' && (
                <Button
                  variant="quiet"
                  size="sm"
                  data-testid="card-add-note"
                  onClick={() => {
                    setEditing('root');
                    setEditDraft('');
                  }}
                >
                  Add note
                </Button>
              )}
              {noted && noted.resolved && (
                <Button
                  variant="quiet"
                  size="sm"
                  data-testid="reopen-btn"
                  onClick={() => onUpdate({ ...noted, resolved: false })}
                >
                  Reopen
                </Button>
              )}
              {/* PRD 022 Req 8: every card offers remove; only a comment has
                  a thread to lose, so only it keeps the delete confirmation. */}
              <Button
                variant="quiet"
                size="sm"
                data-testid="delete-btn"
                onClick={() => (noted ? setConfirmingDelete(true) : onDelete(c.id))}
              >
                {noted ? 'Delete' : 'Remove'}
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
