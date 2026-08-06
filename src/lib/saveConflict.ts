/**
 * PRD 007 Req 20: optimistic-concurrency conflict handling — the error a
 * platform with conditional writes throws when the stored file changed since
 * this session read it, and the pure state machine the app's prompt runs on.
 * No DOM, no platform imports: any flavor whose write seam can express
 * "only if unchanged" throws the same error, and App reacts to the error
 * type, never to the flavor (PRD 007 Req 2).
 */

/**
 * Thrown INSTEAD of writing when the conditional save's precondition failed.
 * The stored content is untouched: the server refused the write (412), so
 * whatever the other member saved is still what the blob holds.
 */
export class SaveConflictError extends Error {
  readonly path: string;
  constructor(path: string) {
    super(`save conflict: ${path} changed on the server since it was loaded`);
    this.name = 'SaveConflictError';
    this.path = path;
  }
}

export function isSaveConflict(error: unknown): error is SaveConflictError {
  return error instanceof SaveConflictError;
}

/** The three real answers to the prompt. Dismissing it is `cancel`. */
export type SaveConflictChoice = 'reload' | 'overwrite' | 'cancel';

/**
 * What each answer does. Every branch is spelled out because the failure
 * mode this feature exists to prevent is a silent one: cancelling must leave
 * the buffer dirty and UNSAVED (never a quiet success), reloading must
 * replace the buffer with the server's newer bytes and land clean, and
 * overwriting must write unconditionally and re-arm the version tag so the
 * NEXT save is guarded again.
 */
export interface SaveConflictPlan {
  /** Re-read the file and replace the buffer (local edits discarded). */
  reload: boolean;
  /** Write again with the precondition dropped. */
  write: boolean;
  /** Whether the buffer stays dirty afterwards. */
  dirty: boolean;
  /** Whether the user is told the save succeeded. */
  saved: boolean;
}

export function planSaveConflict(choice: SaveConflictChoice): SaveConflictPlan {
  if (choice === 'reload') return { reload: true, write: false, dirty: false, saved: false };
  if (choice === 'overwrite') return { reload: false, write: true, dirty: false, saved: true };
  return { reload: false, write: false, dirty: true, saved: false };
}
