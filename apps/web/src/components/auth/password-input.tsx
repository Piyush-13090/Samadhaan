'use client';

import { Eye, EyeOff } from 'lucide-react';
import { useState } from 'react';
import { Input, type InputProps } from '@/components/ui/input';

/**
 * Password field with a reveal toggle.
 *
 * Letting people check what they typed reduces failed sign-ins and, on mobile,
 * discourages the short easy-to-type passwords that a hidden field encourages.
 * The toggle's state is announced via `aria-pressed` and its label changes, so
 * it is not a mystery to a screen reader.
 */
export function PasswordInput(props: Omit<InputProps, 'type' | 'trailingSlot'>) {
  const [visible, setVisible] = useState(false);

  return (
    <Input
      {...props}
      type={visible ? 'text' : 'password'}
      trailingSlot={
        <button
          type="button"
          onClick={() => setVisible((value) => !value)}
          aria-pressed={visible}
          aria-label={visible ? 'Hide password' : 'Show password'}
          className="rounded-sm text-ink-subtle transition-colors hover:text-ink"
        >
          {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      }
    />
  );
}
