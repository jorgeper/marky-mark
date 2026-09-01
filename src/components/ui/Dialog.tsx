import type { HTMLAttributes, ReactNode } from 'react';

export interface DialogProps extends HTMLAttributes<HTMLDivElement> {
  header?: ReactNode;
  actions?: ReactNode;
}

// PRD 018 §B9: the thin Dialog wrapper — the .dialog modal shell with
// header / body / actions slots and nothing else: no backdrop, no portal,
// no dismiss behaviour (those stay with the call site). `children` fill
// the .dialog-body slot; absent header/actions render no slot element.
// PRD 018 §B11: `className` is appended to the primitive class, never
// replaced.
export function Dialog({ header, actions, className, children, ...rest }: DialogProps) {
  return (
    <div className={className ? `dialog ${className}` : 'dialog'} {...rest}>
      {header != null && <div className="dialog-header">{header}</div>}
      <div className="dialog-body">{children}</div>
      {actions != null && <div className="dialog-actions">{actions}</div>}
    </div>
  );
}
