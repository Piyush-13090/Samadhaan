import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import type {
  KnowledgeAnswerView,
  KnowledgeAuthoring,
  KnowledgeSourceView,
} from '@samadhaan/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SourceLinks } from '@/components/coordinator/source-links';
import { ToastProvider } from '@/components/ui/toast';
import { ApiError } from '@/lib/api-error';
import { navigationFor } from '@/lib/navigation';
import { renderWithProviders, screen, waitFor } from '@/test/render';
import { AskKnowledge } from './ask-knowledge';
import { SourceDialog } from './source-dialog';

const service = vi.hoisted(() => ({
  askKnowledge: vi.fn(),
  createSource: vi.fn(),
  uploadSourceFile: vi.fn(),
}));
vi.mock('@/services/knowledge.service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/knowledge.service')>()),
  ...service,
}));

const render = (ui: ReactElement) =>
  renderWithProviders(<ToastProvider>{ui}</ToastProvider>);

const citation = {
  ref: 'E1',
  sourceId: 's1',
  documentId: 'd1',
  chunkId: 'c1',
  title: 'Storm drain maintenance',
  sourceType: 'CIVIC_GUIDELINE' as const,
  sectionTitle: 'Clearing blocked culverts',
  pageNumber: 3,
  relevanceScore: 0.71,
  excerpt: 'Aim to clear such blockages within 48 hours of a verified report.',
  href: '/knowledge/sources/s1#chunk-c1',
  cited: true,
};

function answer(overrides: Partial<KnowledgeAnswerView> = {}): KnowledgeAnswerView {
  return {
    id: 'a1',
    question: 'How fast?',
    context: 'PROJECT',
    answer: 'Within 48 hours of a verified report [E1].',
    insufficientEvidence: false,
    weakRetrieval: false,
    suggestions: ['Photograph the culvert before and after.'],
    sources: [
      citation,
      {
        ...citation,
        ref: 'E2',
        chunkId: 'c2',
        href: '/knowledge/sources/s1#chunk-c2',
        cited: false,
      },
    ],
    model: {
      provider: 'anthropic',
      name: 'claude-x',
      version: '1',
      promptVersion: 'knowledge-answer-2026-10-v1',
    },
    retrieval: {
      embeddingModel: 'all-MiniLM-L6-v2',
      embeddingVersion: '1',
      retrievalVersion: 'hybrid-baseline-v1',
      candidates: 12,
      returned: 2,
    },
    answeredAt: '2026-10-06T10:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('AskKnowledge', () => {
  it('offers the contexts it was given, and sends only the chosen one', async () => {
    service.askKnowledge.mockResolvedValue(answer());
    render(<AskKnowledge projectId="p1" problemId="SAM-1023" />);
    expect(screen.getByRole('radio', { name: 'This project' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await userEvent.click(screen.getByRole('radio', { name: 'This problem' }));
    await userEvent.type(screen.getByRole('textbox'), 'How fast should it be cleared?');
    await userEvent.click(screen.getByRole('button', { name: 'Ask' }));
    expect(service.askKnowledge).toHaveBeenCalledWith({
      query: 'How fast should it be cleared?',
      contextType: 'PROBLEM',
      problemId: 'SAM-1023',
    });
  });

  it('hides context choices when only general knowledge applies', () => {
    render(<AskKnowledge />);
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument();
  });

  it('links citations to the exact passage and keeps suggestions apart', async () => {
    service.askKnowledge.mockResolvedValue(answer());
    render(<AskKnowledge projectId="p1" />);
    await userEvent.type(screen.getByRole('textbox'), 'How fast?');
    await userEvent.click(screen.getByRole('button', { name: 'Ask' }));

    const marker = await screen.findByRole('link', { name: '[E1]' });
    expect(marker).toHaveAttribute('href', '/knowledge/sources/s1#chunk-c1');
    expect(screen.getByText(/not stated by the sources/)).toBeInTheDocument();
    expect(
      screen.getByText('Photograph the culvert before and after.'),
    ).toBeInTheDocument();
    expect(screen.getByText(/retrieved, not cited/)).toBeInTheDocument();
    expect(screen.getByText(/claude-x \(anthropic\)/)).toBeInTheDocument();
  });

  it('never turns a reference without a source into a link', async () => {
    service.askKnowledge.mockResolvedValue(
      answer({ answer: 'Approved by someone [E9].' }),
    );
    render(<AskKnowledge />);
    await userEvent.type(screen.getByRole('textbox'), 'Who approved?');
    await userEvent.click(screen.getByRole('button', { name: 'Ask' }));
    await screen.findByText(/Approved by someone/);
    expect(screen.queryByRole('link', { name: '[E9]' })).not.toBeInTheDocument();
  });

  it('says plainly when the sources do not cover the question', async () => {
    service.askKnowledge.mockResolvedValue(
      answer({
        answer: 'The knowledge base does not contain enough information to answer this.',
        insufficientEvidence: true,
        sources: [],
        suggestions: [],
        model: null,
      }),
    );
    render(<AskKnowledge />);
    await userEvent.type(screen.getByRole('textbox'), 'Zebra crossings?');
    await userEvent.click(screen.getByRole('button', { name: 'Ask' }));
    expect(await screen.findByRole('status')).toHaveTextContent(
      'does not contain enough information',
    );
    expect(screen.getByText(/No model ran/)).toBeInTheDocument();
  });

  it('warns when retrieval was weak', async () => {
    service.askKnowledge.mockResolvedValue(answer({ weakRetrieval: true }));
    render(<AskKnowledge />);
    await userEvent.type(screen.getByRole('textbox'), 'Something vague');
    await userEvent.click(screen.getByRole('button', { name: 'Ask' }));
    expect(await screen.findByText(/only loosely related/)).toBeInTheDocument();
  });

  it('shows the API error when answering fails', async () => {
    service.askKnowledge.mockRejectedValue(
      new ApiError({
        code: 'UPSTREAM_UNAVAILABLE',
        message: 'Answers are unavailable right now.',
        status: 503,
      }),
    );
    render(<AskKnowledge />);
    await userEvent.type(screen.getByRole('textbox'), 'How fast?');
    await userEvent.click(screen.getByRole('button', { name: 'Ask' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Answers are unavailable right now.',
    );
  });
});

describe('SourceDialog', () => {
  const authoring: KnowledgeAuthoring = {
    visibilities: [
      {
        visibility: 'ORGANIZATION',
        organizations: [{ id: 'o1', name: 'Clean City Foundation' }],
        projects: [],
      },
      { visibility: 'PRIVATE', organizations: [], projects: [] },
    ],
  };

  it('offers only the scopes the API allows, and sends no ownership it was not given', async () => {
    service.createSource.mockResolvedValue({ id: 's1' } as KnowledgeSourceView);
    const onCreated = vi.fn();
    render(
      <SourceDialog
        open
        authoring={authoring}
        onClose={() => undefined}
        onCreated={onCreated}
      />,
    );
    const visibility = screen.getByLabelText('Who can read it');
    expect(
      Array.from((visibility as HTMLSelectElement).options).map((o) => o.value),
    ).toEqual(['ORGANIZATION', 'PRIVATE']);

    await userEvent.type(screen.getByLabelText(/Title/), 'Crew rota');
    await userEvent.type(screen.getByLabelText('Or paste the text'), 'Monday: culverts.');
    await userEvent.click(screen.getByRole('button', { name: 'Add and index' }));
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    const sent = service.createSource.mock.calls[0]![0];
    expect(sent).toMatchObject({
      title: 'Crew rota',
      visibility: 'ORGANIZATION',
      organizationId: 'o1',
      content: 'Monday: culverts.',
    });
    expect(sent).not.toHaveProperty('uploadedById');
    expect(sent).not.toHaveProperty('projectId');
  });

  it('requires content', async () => {
    render(
      <SourceDialog
        open
        authoring={authoring}
        onClose={() => undefined}
        onCreated={vi.fn()}
      />,
    );
    await userEvent.type(screen.getByLabelText(/Title/), 'Empty');
    await userEvent.click(screen.getByRole('button', { name: 'Add and index' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Paste the text or choose a file.',
    );
    expect(service.createSource).not.toHaveBeenCalled();
  });
});

describe('wiring', () => {
  it('labels knowledge sources in coordinator findings', () => {
    renderWithProviders(
      <SourceLinks
        sources={[
          {
            kind: 'knowledge',
            id: 'c1',
            label: 'Storm drain maintenance',
            href: '/knowledge/sources/s1#chunk-c1',
          },
        ]}
      />,
    );
    expect(
      screen.getByRole('link', { name: 'Guidance · Storm drain maintenance' }),
    ).toHaveAttribute('href', '/knowledge/sources/s1#chunk-c1');
  });

  it('puts Knowledge in every role’s navigation', () => {
    for (const role of ['CITIZEN', 'NGO', 'GOVERNMENT', 'ADMIN'] as const) {
      const hrefs = navigationFor(role).flatMap((s) => s.items.map((i) => i.href));
      expect(hrefs).toContain('/knowledge');
    }
  });
});
