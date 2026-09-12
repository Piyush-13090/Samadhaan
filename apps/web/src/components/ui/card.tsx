import { cva, type VariantProps } from 'class-variance-authority';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * The primary surface of the interface: white on the warm canvas, separated by
 * a hairline border. Elevation is reserved for things that genuinely float —
 * a card sitting in a grid does not.
 */
const cardVariants = cva('rounded-card bg-surface', {
  variants: {
    variant: {
      /** Default: border-defined, minimal shadow. */
      default: 'border border-border shadow-card',
      /** For cards that float above content — a drag preview, a summary panel. */
      raised: 'border border-border shadow-raised',
      /** Recedes into the page; use inside an already-bordered container. */
      flat: 'border border-border-subtle',
      /** No chrome at all — grouping only. */
      plain: '',
    },
    /** Adds hover feedback. Set on cards that are links or buttons. */
    interactive: {
      true: cn(
        'cursor-pointer transition-[border-color,box-shadow,transform] duration-fast ease-standard',
        'hover:border-border-strong hover:shadow-raised',
        'focus-within:border-primary',
        'active:translate-y-px',
      ),
      false: '',
    },
  },
  defaultVariants: { variant: 'default', interactive: false },
});

export interface CardProps extends VariantProps<typeof cardVariants> {
  children: ReactNode;
  className?: string;
  /** Element to render as. Use `article` for feed items, `section` for panels. */
  as?: 'div' | 'section' | 'article' | 'li';
}

export function Card({
  variant,
  interactive,
  as: Component = 'section',
  className,
  children,
}: CardProps) {
  return (
    <Component className={cn(cardVariants({ variant, interactive }), className)}>
      {children}
    </Component>
  );
}

export function CardHeader({
  title,
  description,
  action,
  icon,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  /** Right-aligned control — a button, a badge, a menu. */
  action?: ReactNode;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4',
        className,
      )}
    >
      <div className="flex min-w-0 items-start gap-3">
        {icon && <span className="mt-0.5 shrink-0 text-ink-subtle">{icon}</span>}
        <div className="min-w-0">
          <h2 className="type-h4 text-ink">{title}</h2>
          {description && (
            <p className="mt-1 type-body-sm text-ink-muted">{description}</p>
          )}
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function CardBody({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn('px-5 py-4', className)}>{children}</div>;
}

export function CardFooter({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-3 border-t border-border bg-subtle/50 px-5 py-3',
        className,
      )}
    >
      {children}
    </div>
  );
}

export { cardVariants };
