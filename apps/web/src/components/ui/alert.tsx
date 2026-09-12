import { AlertTriangle, CheckCircle2, Info, Sparkles, XCircle } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import type { Tone } from '@/types/ui';

/**
 * Inline message attached to a region of the page — distinct from a toast,
 * which is transient and global.
 */

const TONE_STYLES: Record<Tone, string> = {
  neutral: 'border-border bg-subtle',
  primary: 'border-primary-border bg-primary-soft',
  ai: 'border-ai-border bg-ai-soft',
  info: 'border-info-border bg-info-soft',
  success: 'border-success-border bg-success-soft',
  warning: 'border-warning-border bg-warning-soft',
  danger: 'border-danger-border bg-danger-soft',
};

const TONE_ICONS: Record<Tone, ReactNode> = {
  neutral: <Info className="size-4.5 text-ink-subtle" />,
  primary: <Info className="size-4.5 text-primary" />,
  ai: <Sparkles className="size-4.5 text-ai" />,
  info: <Info className="size-4.5 text-info" />,
  success: <CheckCircle2 className="size-4.5 text-success" />,
  warning: <AlertTriangle className="size-4.5 text-warning" />,
  danger: <XCircle className="size-4.5 text-danger" />,
};

export interface AlertProps {
  title: string;
  tone?: Tone;
  children?: ReactNode;
  /** Trailing action — a retry button, a link. */
  action?: ReactNode;
  className?: string;
}

export function Alert({ title, tone = 'info', children, action, className }: AlertProps) {
  return (
    <div
      // `alert` interrupts; reserve it for failures the user must notice.
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cn(
        'flex items-start gap-3 rounded-card border px-4 py-3',
        TONE_STYLES[tone],
        className,
      )}
    >
      <span className="mt-px shrink-0" aria-hidden="true">
        {TONE_ICONS[tone]}
      </span>

      <div className="min-w-0 flex-1">
        <p className="type-body-sm font-medium text-ink">{title}</p>
        {children && <div className="mt-1 type-body-sm text-ink-muted">{children}</div>}
      </div>

      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
