'use client';

import { AlertTriangle, CheckCircle2, Info, Sparkles, X, XCircle } from 'lucide-react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { cn } from '@/lib/cn';
import type { Tone } from '@/types/ui';

/**
 * Application toast system.
 *
 * Transport-agnostic on purpose: `toast()` takes a plain object, so the code
 * that later reports a real API result calls exactly the same function this
 * milestone's UI calls. Nothing here talks to a backend.
 *
 * Accessibility: the region is a polite live region, so a toast is announced
 * without interrupting. Errors are `assertive` because a failed action needs
 * to reach the user before they move on.
 */

export interface ToastOptions {
  title: string;
  description?: string;
  tone?: Tone;
  /** Milliseconds before auto-dismiss. `null` keeps it until dismissed. */
  duration?: number | null;
  /** Single inline action, e.g. "Undo" or "View". */
  action?: { label: string; onClick: () => void };
}

interface ToastRecord extends ToastOptions {
  id: string;
}

interface ToastContextValue {
  toast: (options: ToastOptions) => string;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

/** Access the toast API. Throws if used outside the provider — a wiring bug. */
export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a <ToastProvider>');
  }
  return context;
}

const DEFAULT_DURATION = 5000;
/** Keeps the stack readable; older toasts drop off the top. */
const MAX_VISIBLE = 4;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: string) => {
    setToasts((current) => current.filter((entry) => entry.id !== id));

    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const toast = useCallback(
    (options: ToastOptions) => {
      const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

      setToasts((current) => [...current, { ...options, id }].slice(-MAX_VISIBLE));

      const duration =
        options.duration === undefined ? DEFAULT_DURATION : options.duration;
      if (duration !== null) {
        timers.current.set(
          id,
          setTimeout(() => dismiss(id), duration),
        );
      }

      return id;
    },
    [dismiss],
  );

  // Clear pending timers on unmount so a dismissed provider cannot set state.
  useEffect(() => {
    const pending = timers.current;
    return () => {
      pending.forEach(clearTimeout);
      pending.clear();
    };
  }, []);

  const value = useMemo(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

const TONE_ICONS: Record<Tone, ReactNode> = {
  neutral: <Info className="size-4.5 text-ink-subtle" />,
  primary: <Info className="size-4.5 text-primary" />,
  ai: <Sparkles className="size-4.5 text-ai" />,
  info: <Info className="size-4.5 text-info" />,
  success: <CheckCircle2 className="size-4.5 text-success" />,
  warning: <AlertTriangle className="size-4.5 text-warning" />,
  danger: <XCircle className="size-4.5 text-danger" />,
};

function ToastViewport({
  toasts,
  onDismiss,
}: {
  toasts: ToastRecord[];
  onDismiss: (id: string) => void;
}) {
  return (
    <div
      // Bottom on mobile so it clears the bottom navigation; top-right on desktop.
      className={cn(
        'pointer-events-none fixed inset-x-0 bottom-0 flex flex-col gap-2 p-4',
        'sm:inset-x-auto sm:top-0 sm:right-0 sm:bottom-auto sm:w-96',
      )}
      style={{ zIndex: 'var(--z-toast)' }}
    >
      {toasts.map((entry) => (
        <div
          key={entry.id}
          role={entry.tone === 'danger' ? 'alert' : 'status'}
          aria-live={entry.tone === 'danger' ? 'assertive' : 'polite'}
          className={cn(
            'pointer-events-auto flex items-start gap-3 rounded-card border border-border',
            'bg-overlay p-3.5 shadow-overlay animate-slide-up',
          )}
        >
          <span className="mt-px shrink-0" aria-hidden="true">
            {TONE_ICONS[entry.tone ?? 'neutral']}
          </span>

          <div className="min-w-0 flex-1">
            <p className="type-body-sm font-medium text-ink">{entry.title}</p>
            {entry.description && (
              <p className="mt-0.5 type-caption text-ink-muted">{entry.description}</p>
            )}
            {entry.action && (
              <button
                type="button"
                onClick={() => {
                  entry.action?.onClick();
                  onDismiss(entry.id);
                }}
                className="mt-2 type-caption font-medium text-primary underline-offset-2 hover:underline"
              >
                {entry.action.label}
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={() => onDismiss(entry.id)}
            className="shrink-0 rounded-control p-1 text-ink-subtle transition-colors hover:bg-subtle hover:text-ink"
          >
            <X className="size-3.5" />
            <span className="sr-only">Dismiss notification</span>
          </button>
        </div>
      ))}
    </div>
  );
}
