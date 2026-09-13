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

/**
 * jsdom does not implement scrolling, and calling it throws — which would halt
 * any component that scrolls after a state change, such as the reporting form
 * moving between steps. Stubbed so tests exercise the real navigation logic.
 */
window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;

/**
 * Object URLs are equally unimplemented. The image uploader creates one per
 * preview and revokes it on removal, so both halves need to exist.
 */
if (!URL.createObjectURL) {
  URL.createObjectURL = vi.fn(() => 'blob:mock');
  URL.revokeObjectURL = vi.fn();
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
