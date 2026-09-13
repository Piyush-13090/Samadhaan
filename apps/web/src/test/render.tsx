import { render, type RenderOptions, type RenderResult } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { TooltipProvider } from '@/components/ui/tooltip';

/**
 * Renders a component inside the providers the app always supplies.
 *
 * Components that use `Tooltip` throw outside `TooltipProvider` — correctly, it
 * is a wiring bug in the app. Tests should exercise the component in the
 * context it really runs in rather than working around that.
 */
function Providers({ children }: { children: ReactNode }) {
  return <TooltipProvider>{children}</TooltipProvider>;
}

export function renderWithProviders(
  ui: ReactElement,
  options?: Omit<RenderOptions, 'wrapper'>,
): RenderResult {
  return render(ui, { wrapper: Providers, ...options });
}

export * from '@testing-library/react';
