import type { HTMLAttributes } from 'react';

// Issue #249 (PRD 018 §B): the settings-page section header — the ONE
// second-level heading of the Settings dialog. Every tab's sections (the
// Workspace tab's included, which used to render a bare <h2> and pick up
// `.dialog h2`'s title look) render through this wrapper, so their type and
// colour cannot drift apart again.
//
// It always emits an <h3>: `.dialog h2` styles a dialog TITLE and would win
// on specificity over the primitive class, so the element is fixed here
// rather than left to the call site.
export type SectionHeaderProps = HTMLAttributes<HTMLHeadingElement>;

// PRD 018 §B11: `className` is appended, never replaced — a call site adds a
// layout-only hook (`.hotkey-group`'s rule and spacing) without restating
// type or colour.
export function SectionHeader({ className, ...rest }: SectionHeaderProps) {
  return <h3 className={className ? `section-header ${className}` : 'section-header'} {...rest} />;
}
