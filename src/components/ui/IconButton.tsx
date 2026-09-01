import type { ButtonHTMLAttributes } from 'react';

// PRD 018 §B9: an icon-only button has no text for assistive tech to read,
// so the type demands an accessible name: at least one of `aria-label` or
// `title` must be present (either satisfies the union).
type IconButtonLabel = { 'aria-label': string } | { title: string };

export type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & IconButtonLabel;

// PRD 018 §B9: the thin IconButton wrapper — emits the .icon-btn primitive
// and forwards everything else; `type` defaults to "button" like Button.
// PRD 018 §B11: `className` is appended, never replaced.
export function IconButton({ className, type = 'button', ...rest }: IconButtonProps) {
  return <button type={type} className={className ? `icon-btn ${className}` : 'icon-btn'} {...rest} />;
}
