import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { AuthProvider } from '@/components/auth/auth-provider';
import { ToastProvider } from '@/components/ui/toast';
import { TooltipProvider } from '@/components/ui/tooltip';
import { env } from '@/lib/env';
import { getCurrentUser } from '@/lib/auth-server';
import './globals.css';

/**
 * Geist: a contemporary grotesque with a large x-height and genuinely good
 * tabular figures, which a product full of severity scores, distances and
 * counts depends on. Loaded as variable fonts and exposed as CSS variables that
 * `--font-sans` / `--font-mono` in the design tokens point at.
 */
const geist = Geist({
  subsets: ['latin'],
  variable: '--font-geist',
  display: 'swap',
});

const geistMono = Geist_Mono({
  subsets: ['latin'],
  variable: '--font-geist-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: `${env.appName} — See a problem. Start a solution.`,
    template: `%s — ${env.appName}`,
  },
  description:
    'Samadhaan turns everyday civic problems into organised action — powered by AI, strengthened by communities, and solved through collaboration.',
  applicationName: env.appName,
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  // Matches --color-canvas so browser chrome blends with the page.
  themeColor: '#fafaf8',
};

/**
 * Root layout.
 *
 * Providers that every surface needs live here — auth, tooltips and toasts.
 * Route groups supply their own chrome: `(marketing)` gets the public header
 * and footer, `(app)` gets the application shell, `(auth)` gets a bare frame.
 */
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Resolved on the server so the first paint already knows whether someone is
  // signed in — otherwise every load would flash a signed-out header.
  const user = await getCurrentUser();

  return (
    <html lang="en" className={`${geist.variable} ${geistMono.variable}`}>
      <body className="min-h-dvh font-sans antialiased">
        {/* First tab stop on every page — keyboard users should not have to
            traverse the whole sidebar to reach content. */}
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[100] focus:rounded-control focus:bg-primary focus:px-4 focus:py-2 focus:type-body-sm focus:font-medium focus:text-ink-inverse"
        >
          Skip to content
        </a>

        <AuthProvider initialUser={user}>
          <TooltipProvider>
            <ToastProvider>{children}</ToastProvider>
          </TooltipProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
