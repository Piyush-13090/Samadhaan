import Link from 'next/link';
import { Logo } from '@/components/brand/logo';
import { Button } from '@/components/ui/button';

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4 text-center">
      <Logo size="lg" />

      <p className="mt-8 type-overline text-primary">404</p>
      <h1 className="mt-1.5 type-h1 text-ink">Page not found</h1>
      <p className="mt-3 max-w-sm type-body text-ink-muted">
        The page you are looking for does not exist or has moved.
      </p>

      <div className="mt-8 flex flex-col gap-3 sm:flex-row">
        <Button variant="primary" asChild>
          <Link href="/">Back to home</Link>
        </Button>
        <Button variant="secondary" asChild>
          <Link href="/explore">Explore problems</Link>
        </Button>
      </div>
    </div>
  );
}
