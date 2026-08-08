/**
 * PRD 011 Reqs 17+18+19+21+22: the rendered semantic-zoom view and its docked
 * level control.
 *
 * The component holds no rules: `lib/semanticZoom.ts` decides what a level
 * shows, what a level means, whether it is read-only and where a click lands.
 * Nothing here reaches an LLM — every block is an excerpt (Req 22), and the
 * copy says so once for the whole view.
 *
 * PRD 011 Req 17: document text reaches the DOM as JSX text nodes, escaped by
 * React. No `innerHTML`, no hand-built HTML string.
 */

import type { LlmAreaState } from '../lib/llmSettings';
import {
  canStepZoom,
  stepZoomLevel,
  EXCERPT_CONFIGURE_HINT,
  EXCERPT_NOTICE,
  ZOOM_LEVEL_LABELS,
  type ZoomDocument,
} from '../lib/semanticZoom';
import { clampZoomLevel, ZOOM_LEVEL_MAX, ZOOM_LEVEL_MIN, type ZoomLevel } from '../lib/zoomLevels';

interface ControlProps {
  level: ZoomLevel;
  onLevel: (level: ZoomLevel) => void;
}

/**
 * PRD 011 Req 21: the docked level indicator — the current level and what it
 * means, `+` / `−`, and a draggable handle across all five levels. It branches
 * on nothing: not on `platform.kind`, not on LLM availability. Every route
 * clamps through `clampZoomLevel()`, so neither end wraps.
 */
export function SemanticZoomControl({ level, onLevel }: ControlProps) {
  return (
    <div className="semantic-zoom-control" data-testid="semantic-zoom-control">
      <button
        className="semantic-zoom-step"
        data-testid="semantic-zoom-out"
        aria-label="Zoom out semantically"
        title="Zoom Out Semantically (Mod+Shift+-)"
        disabled={!canStepZoom(level, -1)}
        onClick={() => onLevel(stepZoomLevel(level, -1))}
      >
        −
      </button>
      <input
        className="semantic-zoom-slider"
        data-testid="semantic-zoom-slider"
        type="range"
        min={ZOOM_LEVEL_MIN}
        max={ZOOM_LEVEL_MAX}
        step={1}
        value={level}
        aria-label="Semantic zoom level"
        onChange={(e) => onLevel(clampZoomLevel(Number(e.target.value)))}
      />
      <button
        className="semantic-zoom-step"
        data-testid="semantic-zoom-in"
        aria-label="Zoom in semantically"
        title="Zoom In Semantically (Mod+Shift+=)"
        disabled={!canStepZoom(level, 1)}
        onClick={() => onLevel(stepZoomLevel(level, 1))}
      >
        +
      </button>
      <span className="semantic-zoom-level" data-testid="semantic-zoom-level">
        <b>L{level}</b> {ZOOM_LEVEL_LABELS[level]}
      </span>
    </div>
  );
}

interface ViewProps {
  doc: ZoomDocument;
  /** PRD 011 Req 22: read to decide whether a route to a provider can exist. */
  llmArea: LlmAreaState;
  /** PRD 011 Req 19: a click on a heading or a block — one level toward L5. */
  onDive: (sectionId: string) => void;
  /** PRD 011 Req 19: back to the full document, from any level. */
  onFull: () => void;
  /** PRD 011 Req 22: open the LLM providers settings area. */
  onConfigureLlm: () => void;
}

/**
 * The entry's heading size: the whole-document entry (depth 0) reads as a
 * title, and anything past h6 stops growing.
 */
function depthClass(depth: number): string {
  return `depth-${Math.min(6, Math.max(1, depth))}`;
}

/**
 * PRD 011 Reqs 17+18: levels 1–4. The editor is not mounted here and no text
 * is editable — the buffer is only read, so entering a level from edit mode
 * leaves it byte-identical and returning to L5 restores it untouched.
 */
export function SemanticZoomView({ doc, llmArea, onDive, onFull, onConfigureLlm }: ViewProps) {
  // PRD 011 Req 22 + Req 9: where no LLM path exists at all, say so rather
  // than offering a control that cannot work.
  const noPath = llmArea.state === 'no-path';
  return (
    <div className="workspace semantic-zoom" data-testid="semantic-zoom-view">
      <div className="docwrap">
        <div className="doc semantic-zoom-doc">
          <div className="semantic-zoom-head">
            <h1 className="semantic-zoom-title" data-testid="semantic-zoom-title">
              {doc.title}
            </h1>
            <button className="linklike" data-testid="semantic-zoom-full" onClick={onFull}>
              ← Back to full document
            </button>
          </div>

          {/* PRD 011 Req 22: stated ONCE for the view, never per block. */}
          <p className="semantic-zoom-notice" data-testid="semantic-zoom-excerpt-note">
            {EXCERPT_NOTICE}{' '}
            {noPath ? (
              <span data-testid="semantic-zoom-no-llm">{llmArea.message}</span>
            ) : (
              <button className="linklike" data-testid="semantic-zoom-configure" onClick={onConfigureLlm}>
                {EXCERPT_CONFIGURE_HINT}
              </button>
            )}
          </p>

          {doc.blocks.map((block) => (
            <section
              key={block.id}
              className="semantic-zoom-entry"
              data-testid="semantic-zoom-entry"
              data-section-id={block.id}
              data-depth={block.depth}
            >
              <button
                className={`semantic-zoom-heading ${depthClass(block.depth)}`}
                data-testid="semantic-zoom-heading"
                data-section-id={block.id}
                onClick={() => onDive(block.id)}
              >
                {block.title}
              </button>
              <p
                className={`semantic-zoom-body${block.body.placeholder ? ' placeholder' : ''}`}
                data-testid="semantic-zoom-body"
                onClick={() => onDive(block.id)}
              >
                {block.body.text}
              </p>
              {/* PRD 011 Req 17: folded descendants are named, never dropped. */}
              {block.folded.length > 0 && (
                <p className="semantic-zoom-folded" data-testid="semantic-zoom-folded">
                  Folded in: {block.folded.map((f) => f.title || 'Untitled section').join(' · ')}
                </p>
              )}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
