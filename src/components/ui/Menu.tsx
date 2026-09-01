import type { ButtonHTMLAttributes, HTMLAttributes } from 'react';

// PRD 018 §B9: the thin menu wrappers — class composition and prop
// forwarding only. The .menu primitive is the visual shell; positioning
// (and any open/close state) stays with the call site and
// src/components/anchoredMenu.ts. PRD 018 §B11: `className` is appended
// to the primitive class, never replaced.

export function Menu({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={className ? `menu ${className}` : 'menu'} {...rest} />;
}

// PRD 018 §B9: a menu row is a native button (rows are actions), with
// `type` defaulting to "button" like the Button wrapper.
export function MenuItem({ className, type = 'button', ...rest }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type={type} className={className ? `menu-item ${className}` : 'menu-item'} {...rest} />;
}

export function MenuSeparator({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={className ? `menu-sep ${className}` : 'menu-sep'} {...rest} />;
}
