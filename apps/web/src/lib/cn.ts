import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Joins class names and resolves Tailwind conflicts.
 *
 * `twMerge` is what makes the component API honest: a caller passing
 * `className="p-8"` to a component whose base is `p-4` gets `p-8`, rather than
 * two competing declarations whose winner depends on stylesheet order.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
