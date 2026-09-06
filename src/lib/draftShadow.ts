/**
 * SPEC30 §3.2: the crash-safe draft's shadow-write sequencing, pure so the
 * in-flight race is unit-testable. The app owns the debounce and the I/O
 * (config dir, serialization); this module owns the one rule the I/O's
 * latency makes subtle:
 *
 * Issue #319: a write that RESOLVES after the buffer has turned clean (a save
 * landed while the write was in flight — on hosted, a network PUT) or after
 * an explicit discard must not survive. Before this rule the clean transition
 * only deleted a draft it already knew had landed, so a save inside that
 * window left `draft.json` behind with pre-save content, and the next launch
 * offered a "Restore unsaved changes?" for a document the user had saved.
 *
 * Best-effort throughout: io failures are swallowed, never thrown.
 */
import type { Draft } from './drafts.ts';

export interface DraftShadowIo {
  /** Land the draft at its path (overwrite). */
  write(draft: Draft): Promise<void>;
  /** Remove the draft file if present. */
  remove(): Promise<void>;
}

export class DraftShadow {
  /** True once a write landed that nothing since has removed. */
  private written = false;
  /** Bumped by every clean/discard, so a landing write knows one happened. */
  private drops = 0;

  constructor(private readonly io: DraftShadowIo) {}

  /**
   * SPEC30 §3.2: write the shadow copy. `stillDirty` is asked again once the
   * write lands: if the buffer went clean meanwhile — or a clean/discard ran
   * during the flight — the copy that just landed is removed instead of kept.
   */
  async write(draft: Draft, stillDirty: () => boolean): Promise<void> {
    const drops = this.drops;
    try {
      await this.io.write(draft);
    } catch {
      return; // best effort — nothing landed, nothing to track
    }
    if (drops !== this.drops || !stillDirty()) {
      await this.discard();
      return;
    }
    this.written = true;
  }

  /** SPEC30 §3.2: the buffer turned clean — drop the shadow if one landed. */
  async clean(): Promise<void> {
    this.drops++;
    if (!this.written) return;
    await this.discard();
  }

  /** SPEC30 §3.2: an explicit discard / restore decision — remove unconditionally. */
  async discard(): Promise<void> {
    this.drops++;
    this.written = false;
    try {
      await this.io.remove();
    } catch {
      /* best effort */
    }
  }
}
