'use client';

import { Check, X } from 'lucide-react';
import { useMemo } from 'react';
import { PASSWORD_MIN_LENGTH } from '@samadhaan/shared';
import { cn } from '@/lib/cn';

/**
 * Password strength meter.
 *
 * Mirrors the server's rules for immediate feedback — the server remains
 * authoritative and re-checks on submit. Showing the requirements as a checklist
 * rather than a bare bar means a rejected password comes with the reason, which
 * is the difference between guidance and a guessing game.
 */

export interface PasswordRule {
  id: string;
  label: string;
  satisfied: boolean;
}

export function evaluatePassword(
  password: string,
  context: { email?: string; fullName?: string } = {},
): { rules: PasswordRule[]; score: number; valid: boolean } {
  const lower = password.toLowerCase();
  const localPart = context.email?.split('@')[0]?.toLowerCase() ?? '';
  const nameParts = (context.fullName ?? '')
    .toLowerCase()
    .split(/\s+/)
    .filter((part) => part.length >= 3);

  const rules: PasswordRule[] = [
    {
      id: 'length',
      label: `At least ${PASSWORD_MIN_LENGTH} characters`,
      satisfied: password.length >= PASSWORD_MIN_LENGTH,
    },
    {
      id: 'variety',
      label: 'Mixes letters with numbers or symbols',
      satisfied: /[a-zA-Z]/.test(password) && /[\d\W]/.test(password),
    },
    {
      id: 'personal',
      label: 'Does not contain your name or email',
      satisfied:
        password.length > 0 &&
        !(localPart.length >= 3 && lower.includes(localPart)) &&
        !nameParts.some((part) => lower.includes(part)),
    },
  ];

  const satisfied = rules.filter((rule) => rule.satisfied).length;
  // Length beyond the minimum earns the top band; the rules alone cap at 3.
  const score = satisfied === rules.length && password.length >= 14 ? 4 : satisfied;

  return { rules, score, valid: rules.every((rule) => rule.satisfied) };
}

const BAND = [
  { label: 'Too weak', className: 'bg-danger' },
  { label: 'Weak', className: 'bg-danger' },
  { label: 'Fair', className: 'bg-warning' },
  { label: 'Good', className: 'bg-success' },
  { label: 'Strong', className: 'bg-success' },
] as const;

export function PasswordStrength({
  password,
  context,
  className,
}: {
  password: string;
  context?: { email?: string; fullName?: string };
  className?: string;
}) {
  const { rules, score } = useMemo(
    () => evaluatePassword(password, context),
    [password, context],
  );

  if (!password) return null;

  const band = BAND[score] ?? BAND[0];

  return (
    <div className={cn('mt-2', className)}>
      <div className="flex items-center gap-2">
        <div className="flex flex-1 gap-1" aria-hidden="true">
          {[0, 1, 2, 3].map((segment) => (
            <span
              key={segment}
              className={cn(
                'h-1 flex-1 rounded-full transition-colors duration-base',
                segment < score ? band.className : 'bg-subtle',
              )}
            />
          ))}
        </div>
        <span className="type-caption text-ink-muted" aria-live="polite">
          {band.label}
        </span>
      </div>

      <ul className="mt-2.5 space-y-1">
        {rules.map((rule) => (
          <li
            key={rule.id}
            className={cn(
              'flex items-center gap-1.5 type-caption',
              rule.satisfied ? 'text-success' : 'text-ink-subtle',
            )}
          >
            {rule.satisfied ? (
              <Check className="size-3.5 shrink-0" aria-hidden="true" />
            ) : (
              <X className="size-3.5 shrink-0" aria-hidden="true" />
            )}
            <span>{rule.label}</span>
            <span className="sr-only">{rule.satisfied ? '— met' : '— not met'}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
