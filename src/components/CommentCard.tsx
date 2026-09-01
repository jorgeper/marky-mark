import { useState } from 'react';
import type { CommentData } from '../lib/anchoring';
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
}: Props) {
  const [replying, setReplying] = useState(false);
  const [replyDraft, setReplyDraft] = useState('');
  const [editing, setEditing] = useState<string | null>(null); // 'root' or reply id
  const [editDraft, setEditDraft] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const submitReply = () => {
    const body = replyDraft.trim();
    if (!body) return;
    onUpdate({
      ...c,
      thread: [...c.thread, { id: newId(), author, createdAt: new Date().toISOString(), body }],
    });
    setReplyDraft('');
    setReplying(false);
  };

  const saveEdit = () => {
    const body = editDraft.trim();
    if (!body || editing === null) return;
    if (editing === 'root') {
      onUpdate({ ...c, body });
    } else {
      onUpdate({ ...c, thread: c.thread.map((r) => (r.id === editing ? { ...r, body } : r)) });
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
      className={`card${active ? ' active' : ''}${orphaned ? ' orphaned' : ''}${c.resolved ? ' resolved-card' : ''}${ghost ? ' resolved-ghost' : ''}`}
      data-testid="comment-card"
      data-cid={c.id}
      data-flowcard={c.resolved && !ghost ? undefined : c.id}
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
          <p className="body" data-testid="card-body">
            {c.body}
          </p>
        )}
      </div>

      {c.thread.map((r) => (
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
                onClick={() => onUpdate({ ...c, thread: c.thread.filter((x) => x.id !== r.id) })}
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
              {!c.resolved && (
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
                      setEditDraft(c.body);
                    }}
                  >
                    Edit
                  </Button>
                  <Button
                    variant="quiet"
                    size="sm"
                    data-testid="resolve-btn"
                    onClick={() => onUpdate({ ...c, resolved: true })}
                  >
                    Resolve
                  </Button>
                </>
              )}
              {c.resolved && (
                <Button
                  variant="quiet"
                  size="sm"
                  data-testid="reopen-btn"
                  onClick={() => onUpdate({ ...c, resolved: false })}
                >
                  Reopen
                </Button>
              )}
              <Button variant="quiet" size="sm" data-testid="delete-btn" onClick={() => setConfirmingDelete(true)}>
                Delete
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
