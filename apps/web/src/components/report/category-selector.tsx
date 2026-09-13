'use client';

import { PROBLEM_CATEGORIES, type ProblemCategory } from '@samadhaan/shared';
import { cn } from '@/lib/cn';
import { CATEGORY_DISPLAY } from '@/lib/domain-display';

/**
 * Category picker.
 *
 * A radio group rather than a `<select>`: fourteen options are hard to scan in
 * a native dropdown on a phone, and the choice determines how the problem is
 * routed, so it deserves to be visible rather than hidden behind a tap.
 *
 * Native radio inputs, visually replaced — keyboard arrow-key navigation and
 * screen-reader semantics come for free, which a div-based picker would have to
 * reimplement and usually gets wrong.
 */
export function CategorySelector({
  value,
  onChange,
  error,
  id = 'category',
}: {
  value: ProblemCategory | null;
  onChange: (category: ProblemCategory) => void;
  error?: string;
  id?: string;
}) {
  return (
    <fieldset aria-describedby={error ? `${id}-error` : undefined}>
      <legend className="type-label text-ink">
        Category
        <span className="ml-0.5 text-danger" aria-hidden="true">
          *
        </span>
      </legend>
      <p className="mt-1 type-caption text-ink-subtle">
        Pick the closest match. Samadhaan will refine this after you submit.
      </p>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {PROBLEM_CATEGORIES.map((category) => {
          const selected = value === category;

          return (
            <label
              key={category}
              className={cn(
                'relative flex cursor-pointer items-center rounded-control border px-3 py-2.5',
                'type-body-sm transition-colors duration-fast',
                // Focus lands on the hidden input; forward the ring to the label.
                'has-[:focus-visible]:outline has-[:focus-visible]:outline-2',
                'has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-primary',
                selected
                  ? 'border-primary bg-primary-soft font-medium text-primary'
                  : 'border-border-strong bg-surface text-ink-muted hover:bg-subtle hover:text-ink',
              )}
            >
              <input
                type="radio"
                name={id}
                value={category}
                checked={selected}
                onChange={() => onChange(category)}
                className="sr-only"
              />
              {CATEGORY_DISPLAY[category].label}
            </label>
          );
        })}
      </div>

      {error && (
        <p id={`${id}-error`} role="alert" className="mt-2 type-caption text-danger">
          {error}
        </p>
      )}
    </fieldset>
  );
}
