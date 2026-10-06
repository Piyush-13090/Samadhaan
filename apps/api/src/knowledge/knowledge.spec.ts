import { describe, expect, it } from 'vitest';
import { parseAnswerResponse, parseChunkResponse } from '../ai/dto/knowledge.dto.js';
import { detectKnowledgeFile } from './knowledge-sources.service.js';
import {
  contextRelevance,
  diversify,
  normaliseWeights,
  recency,
  score,
  sourceRelevance,
  type Candidate,
} from './scoring.js';

const weights = {
  semantic: 0.6,
  keyword: 0.15,
  source: 0.1,
  context: 0.1,
  recency: 0.05,
};
const now = new Date('2026-10-08T00:00:00Z');

function candidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    chunkId: 'c1',
    documentId: 'd1',
    sourceId: 's1',
    content: 'Clear blocked culverts within 48 hours.',
    sectionTitle: null,
    pageNumber: null,
    title: 'Drainage guideline',
    sourceType: 'CIVIC_GUIDELINE',
    categories: ['DRAINAGE'],
    city: null,
    updatedAt: now,
    semantic: 0.8,
    keyword: 0.4,
    ...overrides,
  };
}

describe('hybrid scoring', () => {
  it('is the documented weighted sum', () => {
    const [s] = score(
      [candidate()],
      { kind: 'PROBLEM', category: 'DRAINAGE', city: null },
      weights,
      now,
    );
    // 0.6·0.8 + 0.15·0.4 + 0.1·1 + 0.1·1 + 0.05·1
    expect(s!.score).toBeCloseTo(0.79, 4);
    expect(s!.signals).toEqual({
      semantic: 0.8,
      keyword: 0.4,
      source: 1,
      context: 1,
      recency: 1,
    });
  });

  it('normalises weights that do not sum to one', () => {
    const w = normaliseWeights({
      semantic: 6,
      keyword: 1.5,
      source: 1,
      context: 1,
      recency: 0.5,
    });
    expect(w.semantic + w.keyword + w.source + w.context + w.recency).toBeCloseTo(1);
    expect(
      normaliseWeights({ semantic: 0, keyword: 0, source: 0, context: 0, recency: 0 })
        .semantic,
    ).toBe(1);
  });

  it('prefers matching categories and cities, and treats general guidance as neutral', () => {
    const ctx = { kind: 'PROBLEM' as const, category: 'DRAINAGE', city: 'Pune' };
    expect(contextRelevance({ categories: ['DRAINAGE'], city: 'Pune' }, ctx)).toBe(1);
    expect(contextRelevance({ categories: [], city: null }, ctx)).toBe(0.5);
    expect(contextRelevance({ categories: ['POTHOLES'], city: null }, ctx)).toBe(0.1);
    expect(contextRelevance({ categories: ['DRAINAGE'], city: 'Delhi' }, ctx)).toBe(0.5);
    expect(
      contextRelevance(
        { categories: ['POTHOLES'], city: null },
        { kind: 'GENERAL', category: null, city: null },
      ),
    ).toBe(0.5);
  });

  it('weights project documents up in a project context', () => {
    expect(
      sourceRelevance('PROJECT_DOCUMENT', {
        kind: 'PROJECT',
        category: null,
        city: null,
      }),
    ).toBe(1);
    expect(
      sourceRelevance('PROJECT_DOCUMENT', {
        kind: 'GENERAL',
        category: null,
        city: null,
      }),
    ).toBe(0.6);
  });

  it('decays with a one-year half-life', () => {
    expect(recency(new Date('2025-10-08T00:00:00Z'), now)).toBeCloseTo(0.5, 2);
  });

  it('orders by score, deterministically', () => {
    const scored = score(
      [
        candidate({ chunkId: 'b', semantic: 0.5 }),
        candidate({ chunkId: 'a', semantic: 0.9 }),
        candidate({ chunkId: 'c', semantic: 0.5 }),
      ],
      { kind: 'GENERAL', category: null, city: null },
      weights,
      now,
    );
    expect(scored.map((s) => s.chunkId)).toEqual(['a', 'b', 'c']);
  });

  it('diversifies away from near-duplicates', () => {
    const scored = score(
      [
        candidate({ chunkId: 'a', semantic: 0.9, embedding: [1, 0] }),
        candidate({ chunkId: 'b', semantic: 0.89, embedding: [1, 0.01] }),
        candidate({ chunkId: 'c', semantic: 0.7, embedding: [0, 1] }),
      ],
      { kind: 'GENERAL', category: null, city: null },
      weights,
      now,
    );
    expect(diversify(scored, 2, 3).map((s) => s.chunkId)).toEqual(['a', 'c']);
  });
});

describe('detectKnowledgeFile', () => {
  it('reads the type from the bytes and requires the extension to agree', () => {
    expect(detectKnowledgeFile(Buffer.from('%PDF-1.7 ...'), 'guide.pdf')).toBe(
      'application/pdf',
    );
    expect(detectKnowledgeFile(Buffer.from('%PDF-1.7 ...'), 'guide.txt')).toBeNull();
    expect(detectKnowledgeFile(Buffer.from('# Guide'), 'guide.md')).toBe('text/markdown');
    expect(detectKnowledgeFile(Buffer.from('<p>x</p>'), 'page.html')).toBe('text/html');
    expect(detectKnowledgeFile(Buffer.from('MZ\0\0binary'), 'tool.txt')).toBeNull();
    expect(detectKnowledgeFile(Buffer.from('plain'), 'script.exe')).toBeNull();
    expect(detectKnowledgeFile(Buffer.from([0xff, 0xfe, 0x41]), 'latin.txt')).toBeNull();
  });
});

describe('AI responses', () => {
  it('drops citations to evidence that was not sent', () => {
    const parsed = parseAnswerResponse(
      {
        answer: 'Clear within 48 hours [E1]. Approved by the minister [E7].',
        insufficient_evidence: false,
        evidence_refs: ['E1', 'E7'],
        suggestions: ['Photograph before and after.'],
        provider: 'fake',
        model_name: 'm',
        model_version: '1',
        prompt_version: 'p',
      },
      new Set(['E1', 'E2']),
    );
    expect(parsed!.answer).toBe('Clear within 48 hours [E1]. Approved by the minister .');
    expect(parsed!.evidenceRefs).toEqual(['E1']);
  });

  it('an answer that cites nothing is insufficient', () => {
    const parsed = parseAnswerResponse(
      {
        answer: 'Probably a week.',
        insufficient_evidence: false,
        provider: 'f',
        model_name: 'm',
        model_version: '1',
        prompt_version: 'p',
      },
      new Set(['E1']),
    );
    expect(parsed!.insufficientEvidence).toBe(true);
  });

  it('rejects malformed chunking output', () => {
    expect(
      parseChunkResponse(
        {
          chunks: [{ index: 0, content: 'x' }],
          chunker_version: 'v',
          detected_type: 't',
        },
        10,
      ),
    ).toBeNull();
    expect(
      parseChunkResponse({ chunks: [], chunker_version: 'v', detected_type: 't' }, 10),
    ).toEqual(expect.objectContaining({ chunks: [] }));
  });
});
