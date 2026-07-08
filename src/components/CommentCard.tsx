import { useState } from 'react';
import type { CommentData } from '../lib/anchoring';
import { timeAgo } from '../lib/time';

/** Ported from ../md-with-comments — margin comment card with threads. */

interface Props {
  comment: CommentData;
  author: string;
  orphaned: boolean;
  active: boolean;
  /** Resolved card rendered ghosted in the margin flow (SPEC6 §3). */
  ghost?: boolean;
  onActivate: (id: string) => void;
  onUpdate: (next: CommentData) => void;
  onDelete: (id: string) => void;
}

function newId(): string {
  return crypto.randomUUID();
}

export function CommentCard({ comment: c, author, orphaned, active, ghost, onActivate, onUpdate, onDelete }: Props) {
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
              data-testid="edit-input"
              value={editDraft}
              autoFocus
              onChange={(e) => setEditDraft(e.target.value)}
              onKeyDown={(e) => editorKeys(e, saveEdit, () => setEditing(null))}
            />
            <div className="row">
              <button data-testid="save-edit" onClick={saveEdit}>
                Save
              </button>
              <button onClick={() => setEditing(null)}>Cancel</button>
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
                data-testid="edit-input"
                value={editDraft}
                autoFocus
                onChange={(e) => setEditDraft(e.target.value)}
                onKeyDown={(e) => editorKeys(e, saveEdit, () => setEditing(null))}
              />
              <div className="row">
                <button data-testid="save-edit" onClick={saveEdit}>
                  Save
                </button>
                <button onClick={() => setEditing(null)}>Cancel</button>
              </div>
            </div>
          ) : (
            <p className="body" data-testid="reply-body">
              {r.body}
            </p>
          )}
          <div className="row small" onClick={stop}>
            <button
              data-testid="edit-reply"
              onClick={() => {
                setEditing(r.id);
                setEditDraft(r.body);
              }}
            >
              Edit
            </button>
            <button
              data-testid="delete-reply"
              onClick={() => onUpdate({ ...c, thread: c.thread.filter((x) => x.id !== r.id) })}
            >
              Delete
            </button>
          </div>
        </div>
      ))}

      {replying && (
        <div onClick={stop}>
          <textarea
            data-testid="reply-input"
            placeholder="Reply…"
            value={replyDraft}
            autoFocus
            onChange={(e) => setReplyDraft(e.target.value)}
            onKeyDown={(e) => editorKeys(e, submitReply, () => setReplying(false))}
          />
          <div className="row">
            <button data-testid="submit-reply" onClick={submitReply}>
              Reply
            </button>
            <button onClick={() => setReplying(false)}>Cancel</button>
          </div>
        </div>
      )}

      <div className="row controls" onClick={stop}>
        {confirmingDelete ? (
          <>
            <span className="confirm-label">Delete thread?</span>
            <button data-testid="confirm-delete" className="danger" onClick={() => onDelete(c.id)}>
              Delete
            </button>
            <button data-testid="cancel-delete" onClick={() => setConfirmingDelete(false)}>
              Cancel
            </button>
          </>
        ) : (
          <>
            {!c.resolved && (
              <>
                <button data-testid="reply-btn" onClick={() => setReplying(true)}>
                  Reply
                </button>
                <button
                  data-testid="edit-btn"
                  onClick={() => {
                    setEditing('root');
                    setEditDraft(c.body);
                  }}
                >
                  Edit
                </button>
                <button data-testid="resolve-btn" onClick={() => onUpdate({ ...c, resolved: true })}>
                  Resolve
                </button>
              </>
            )}
            {c.resolved && (
              <button data-testid="reopen-btn" onClick={() => onUpdate({ ...c, resolved: false })}>
                Reopen
              </button>
            )}
            <button data-testid="delete-btn" onClick={() => setConfirmingDelete(true)}>
              Delete
            </button>
          </>
        )}
      </div>
    </div>
  );
}
