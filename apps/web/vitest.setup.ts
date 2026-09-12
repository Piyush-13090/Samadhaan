import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

/**
 * Shared test setup.
 *
 * Next's navigation hooks require a router context that does not exist in
 * jsdom, so they are mocked here once rather than in every test file. Tests
 * that assert on navigation read the spies from `@/test/router-mock`.
 */

export const routerMock = {
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
  back: vi.fn(),
  forward: vi.fn(),
  prefetch: vi.fn(),
};

export const searchParamsMock = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useRouter: () => routerMock,
  useSearchParams: () => searchParamsMock,
  usePathname: () => '/',
  redirect: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
