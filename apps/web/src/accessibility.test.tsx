import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  Button,
  Drawer,
  DrawerContent,
  DrawerTrigger,
  ErrorState,
  Field,
  Input,
  Modal,
  ModalContent,
  ModalTrigger,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  ToastProvider,
  useToast,
} from '@/components/ui';

/**
 * Accessibility regressions for the shared primitives (Prompt 29). Every
 * screen builds its dialogs, drawers, forms, tabs and error states from these,
 * so their keyboard and screen-reader contracts are checked once here.
 *
 * Behavioural checks with Testing Library, not an automated WCAG scan: they
 * prove specific interactions, not overall conformance (docs/TEST_STRATEGY.md).
 */
describe('Dialogs and drawers', () => {
  it('moves focus into a modal, names it from its title, and returns focus on Escape', async () => {
    const user = userEvent.setup();
    render(
      <Modal>
        <ModalTrigger asChild>
          <Button>Allocate problem</Button>
        </ModalTrigger>
        <ModalContent title="Allocate SAM-1042" description="Choose an organisation.">
          <Button>Confirm allocation</Button>
        </ModalContent>
      </Modal>,
    );
    const trigger = screen.getByRole('button', { name: 'Allocate problem' });
    await user.click(trigger);

    const dialog = await screen.findByRole('dialog', { name: 'Allocate SAM-1042' });
    expect(dialog).toHaveAccessibleDescription('Choose an organisation.');
    expect(dialog.contains(document.activeElement)).toBe(true);
    // The icon-only close control has a screen-reader name.
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });

  it('keeps Tab focus inside an open modal', async () => {
    const user = userEvent.setup();
    render(
      <>
        <Button>Outside</Button>
        <Modal defaultOpen>
          <ModalContent title="Close room">
            <Button>Cancel</Button>
            <Button>Close room</Button>
          </ModalContent>
        </Modal>
      </>,
    );
    const dialog = await screen.findByRole('dialog', { name: 'Close room' });
    for (let i = 0; i < 6; i++) {
      await user.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
  });

  it('gives drawers the same focus and naming contract', async () => {
    const user = userEvent.setup();
    render(
      <Drawer>
        <DrawerTrigger asChild>
          <Button>Filters</Button>
        </DrawerTrigger>
        <DrawerContent title="Search filters">
          <Button>Apply</Button>
        </DrawerContent>
      </Drawer>,
    );
    await user.click(screen.getByRole('button', { name: 'Filters' }));
    const drawer = await screen.findByRole('dialog', { name: 'Search filters' });
    expect(drawer.contains(document.activeElement)).toBe(true);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Filters' })).toHaveFocus();
  });
});

describe('Forms', () => {
  it('labels controls and announces validation errors', () => {
    render(
      <Field label="Email address" required error="Enter a valid email address.">
        <Input type="email" />
      </Field>,
    );
    const input = screen.getByLabelText(/Email address/);
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAttribute('aria-required', 'true');
    const error = screen.getByRole('alert');
    expect(error).toHaveTextContent('Enter a valid email address.');
    expect(input).toHaveAccessibleDescription('Enter a valid email address.');
  });

  it('describes a valid control by its hint, without claiming it is invalid', () => {
    render(
      <Field label="Ward" hint="As printed on your property tax bill.">
        <Input />
      </Field>,
    );
    const input = screen.getByLabelText('Ward');
    expect(input).not.toHaveAttribute('aria-invalid');
    expect(input).toHaveAccessibleDescription('As printed on your property tax bill.');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('Failure and retry states', () => {
  it('announces a network failure and offers a keyboard-reachable retry', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(
      <ErrorState
        title="Could not load problems"
        description="Check your connection and try again."
        onRetry={onRetry}
        reference="req-7f3a"
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load problems');
    await user.tab();
    expect(screen.getByRole('button', { name: 'Try again' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/req-7f3a/)).toBeInTheDocument();
  });

  it('offers no retry when the failure is not retryable', () => {
    render(<ErrorState title="You do not have access to this workspace" />);
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  });
});

describe('Tabs', () => {
  it('moves between tabs with the arrow keys', async () => {
    const user = userEvent.setup();
    render(
      <Tabs defaultValue="overview">
        <TabsList aria-label="Problem sections">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
        </TabsList>
        <TabsContent value="overview">Overview panel</TabsContent>
        <TabsContent value="activity">Activity panel</TabsContent>
      </Tabs>,
    );
    expect(screen.getByRole('tablist', { name: 'Problem sections' })).toBeInTheDocument();
    await user.tab();
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    const activity = screen.getByRole('tab', { name: 'Activity' });
    expect(activity).toHaveFocus();
    expect(activity).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Activity panel');
  });
});

describe('Toasts (Prompt 30)', () => {
  function Trigger({ tone }: { tone: 'success' | 'danger' }) {
    const { toast } = useToast();
    return (
      <Button
        onClick={() => toast({ tone, title: `${tone} message`, description: 'Details.' })}
      >
        Notify {tone}
      </Button>
    );
  }

  it('announces through persistent live regions, and keeps errors until dismissed', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      const { container } = render(
        <ToastProvider>
          <Trigger tone="success" />
          <Trigger tone="danger" />
        </ToastProvider>,
      );
      const polite = container.ownerDocument.querySelector(
        '[aria-live="polite"][aria-atomic="true"]',
      );
      const assertive = container.ownerDocument.querySelector(
        '[aria-live="assertive"][aria-atomic="true"]',
      );
      // The regions exist before anything is announced.
      expect(polite).toBeInTheDocument();
      expect(assertive).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'Notify success' }));
      await user.click(screen.getByRole('button', { name: 'Notify danger' }));
      expect(polite).toHaveTextContent('success message. Details.');
      expect(assertive).toHaveTextContent('danger message. Details.');

      await act(async () => {
        vi.advanceTimersByTime(10_000);
      });
      // Success dismissed itself; the error is still there to read.
      expect(screen.getAllByText('danger message').length).toBeGreaterThan(0);
      expect(
        screen.getAllByRole('button', { name: 'Dismiss notification' }),
      ).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
