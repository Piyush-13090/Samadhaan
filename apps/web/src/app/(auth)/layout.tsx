import Link from 'next/link';
import type { ReactNode } from 'react';
import { Logo } from '@/components/brand/logo';

/**
 * Chrome for the sign-in and registration pages.
 *
 * Deliberately bare — no navigation, no footer links competing for attention.
 * These pages have exactly one job each, and the design system's generous
 * whitespace does the work of making that feel calm rather than empty.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <header className="px-4 py-6 sm:px-6">
        <Link href="/" aria-label="Samadhaan home" className="inline-flex">
          <Logo size="md" />
        </Link>
      </header>

      <main
        id="main"
        className="flex flex-1 items-start justify-center px-4 pb-16 sm:items-center sm:pb-24"
      >
        <div className="w-full max-w-sm">{children}</div>
      </main>
    </div>
  );
}
