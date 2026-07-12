import type { FrontMatterEntry } from '../lib/frontmatter';

/**
 * SPEC26 §2: the dim metadata card shown above the rendered document when
 * it carries YAML front matter. App UI — never part of the rendered
 * markdown, so exports and the comment anchor space never see it. The ✕
 * hides the card for the session (same as unchecking View → Front Matter).
 */
export function FrontMatterCard({ entries, onClose }: { entries: FrontMatterEntry[]; onClose(): void }) {
  return (
    <div className="fm-card" data-testid="fm-card">
      <button className="fm-close" data-testid="fm-close" aria-label="Hide front matter" title="Hide front matter" onClick={onClose}>
        ×
      </button>
      <dl>
        {entries.map((e, i) =>
          e.key ? (
            <div className="fm-row" key={i}>
              <dt>{e.key}</dt>
              <dd>{e.value}</dd>
            </div>
          ) : (
            <div className="fm-row" key={i}>
              <dd className="fm-raw">{e.value}</dd>
            </div>
          )
        )}
      </dl>
    </div>
  );
}
