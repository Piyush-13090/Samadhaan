import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import {
  cloneElement,
  isValidElement,
  type ButtonHTMLAttributes,
  type ReactElement,
  type ReactNode,
} from 'react';
import { cn } from '@/lib/cn';
import { Spinner } from './spinner';

/**
 * Button hierarchy, deliberately narrow:
 *
 * - `primary`   one per view — the action we want taken
 * - `secondary` the common case: bordered, neutral
 * - `ghost`     toolbar and navigation actions, no chrome until hover
 * - `subtle`    tinted, for secondary emphasis inside an accent context
 * - `danger`    destructive, always requires confirmation elsewhere
 * - `link`      inline, reads as text
 *
 * More variants than this and the hierarchy stops meaning anything.
 */
const buttonVariants = cva(
  [
    'inline-flex shrink-0 items-center justify-center gap-2 rounded-control font-medium',
    'whitespace-nowrap transition-[background-color,border-color,color,box-shadow]',
    'duration-fast ease-standard select-none',
    'disabled:pointer-events-none disabled:opacity-45',
    // Icons inside buttons never shrink and never capture the pointer.
    '[&_svg]:pointer-events-none [&_svg]:shrink-0',
  ],
  {
    variants: {
      variant: {
        primary:
          'bg-primary text-ink-inverse shadow-card hover:bg-primary-hover active:bg-primary-active',
        secondary:
          'border border-border-strong bg-surface text-ink shadow-card hover:bg-subtle active:bg-subtle',
        ghost: 'text-ink-muted hover:bg-subtle hover:text-ink active:bg-subtle',
        subtle:
          'bg-primary-soft text-primary hover:bg-primary-border/60 active:bg-primary-border',
        danger:
          'bg-danger text-ink-inverse shadow-card hover:bg-danger/90 active:bg-danger',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        sm: 'h-8 px-3 type-body-sm [&_svg]:size-4',
        md: 'h-10 px-4 type-body-sm [&_svg]:size-4',
        lg: 'h-12 px-6 type-body [&_svg]:size-5',
      },
      /** Square button for a lone icon. Requires an accessible label. */
      iconOnly: {
        true: 'px-0',
        false: '',
      },
      fullWidth: {
        true: 'w-full',
        false: '',
      },
    },
    compoundVariants: [
      { iconOnly: true, size: 'sm', class: 'size-8' },
      { iconOnly: true, size: 'md', class: 'size-10' },
      { iconOnly: true, size: 'lg', class: 'size-12' },
      // `link` has no box, so box-model styling would misalign it inline.
      { variant: 'link', size: 'sm', class: 'h-auto px-0' },
      { variant: 'link', size: 'md', class: 'h-auto px-0' },
      { variant: 'link', size: 'lg', class: 'h-auto px-0' },
    ],
    defaultVariants: {
      variant: 'secondary',
      size: 'md',
      iconOnly: false,
      fullWidth: false,
    },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  /** Render as the child element (e.g. a Next `<Link>`) instead of `<button>`. */
  asChild?: boolean;
  /**
   * Shows a spinner and disables interaction. The label stays in place so the
   * button does not change width mid-action.
   */
  loading?: boolean;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
}

export function Button({
  className,
  variant,
  size,
  iconOnly,
  fullWidth,
  asChild = false,
  loading = false,
  leadingIcon,
  trailingIcon,
  disabled,
  children,
  ...props
}: ButtonProps) {
  const classes = cn(buttonVariants({ variant, size, iconOnly, fullWidth }), className);
  const leading = loading ? <Spinner className="size-4" /> : leadingIcon;
  const trailing = loading ? null : trailingIcon;

  if (asChild) {
    // `Slot` merges props onto exactly one child, so the icons cannot be passed
    // as extra siblings. Compose them into the child's own children instead —
    // that keeps `<Button asChild leadingIcon={…}><Link/></Button>` working, so
    // a link-shaped button is not a second-class API.
    if (!isValidElement(children)) {
      throw new Error('<Button asChild> expects a single React element child.');
    }

    const child = children as ReactElement<{ children?: ReactNode }>;

    return (
      <Slot className={classes} aria-busy={loading || undefined} {...props}>
        {cloneElement(
          child,
          undefined,
          <>
            {leading}
            {child.props.children}
            {trailing}
          </>,
        )}
      </Slot>
    );
  }

  return (
    <button
      className={classes}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {leading}
      {children}
      {trailing}
    </button>
  );
}

export { buttonVariants };
