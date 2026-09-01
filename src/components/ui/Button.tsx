import type { ButtonHTMLAttributes } from 'react';

// PRD 018 §B9: the thin Button wrapper — class composition and prop
// forwarding only. Visuals live entirely on the .btn* primitives in
// styles.css; no state, no portals, no positioning here.
export type ButtonVariant = 'neutral' | 'primary' | 'quiet' | 'danger';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: 'sm';
  pill?: boolean;
}

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  neutral: '',
  primary: 'btn-primary',
  quiet: 'btn-quiet',
  danger: 'btn-danger',
};

// PRD 018 §B9: `type` defaults to "button" so a Button inside a form never
// submits it by accident; any explicit `type` prop wins.
// PRD 018 §B11: `className` is appended after the primitive classes, never
// replacing them, so call sites can carry a layout hook.
export function Button({ variant = 'neutral', size, pill, className, type = 'button', ...rest }: ButtonProps) {
  const classes = ['btn', VARIANT_CLASS[variant], size === 'sm' ? 'btn-sm' : '', pill ? 'btn-pill' : '', className ?? '']
    .filter(Boolean)
    .join(' ');
  return <button type={type} className={classes} {...rest} />;
}
