import type { ProblemCategory } from './problem.js';

/**
 * Knowledge & RAG (Prompt 20).
 *
 * Sources (guidelines, policies, project documents) are extracted, chunked and
 * embedded; questions retrieve passages the asker may see — filtered in SQL
 * before any model is involved — and an answer is generated from them with
 * citations that map to real chunks. Retrieved text is evidence, never
 * authority and never instructions.
 */

export const KNOWLEDGE_SOURCE_TYPES = [
  'CIVIC_GUIDELINE',
  'GOVERNMENT_POLICY',
  'PROJECT_DOCUMENT',
  'PROJECT_NOTE',
  'PROBLEM_CONTEXT',
  'ORGANIZATION_DOCUMENT',
  'WEB_REFERENCE',
  'OTHER',
] as const;
export type KnowledgeSourceType = (typeof KNOWLEDGE_SOURCE_TYPES)[number];

export const KNOWLEDGE_VISIBILITIES = ['PUBLIC', 'GOVERNMENT', 'ORGANIZATION', 'PROJECT', 'PRIVATE'] as const;
export type KnowledgeVisibility = (typeof KNOWLEDGE_VISIBILITIES)[number];

export type KnowledgeIngestionStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';

export const KNOWLEDGE_CONTEXTS = ['GENERAL', 'PROBLEM', 'PROJECT'] as const;
export type KnowledgeContext = (typeof KNOWLEDGE_CONTEXTS)[number];

export const KNOWLEDGE_TITLE_MAX = 200;
export const KNOWLEDGE_DESCRIPTION_MAX = 2000;
export const KNOWLEDGE_INLINE_TEXT_MAX = 500_000;
export const KNOWLEDGE_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;
export const KNOWLEDGE_QUESTION_MAX = 1000;
export const KNOWLEDGE_UPLOAD_TYPES = ['text/plain', 'text/markdown', 'text/html', 'application/pdf'] as const;

export interface KnowledgeSourceView {
  id: string;
  title: string;
  description: string | null;
  sourceType: KnowledgeSourceType;
  visibility: KnowledgeVisibility;
  organization: { name: string; slug: string; type: string } | null;
  project: { id: string; roomId: string; name: string } | null;
  uploadedBy: { name: string } | null;
  externalUrl: string | null;
  file: { name: string; mimeType: string; sizeBytes: number; url: string } | null;
  hasInlineText: boolean;
  categories: ProblemCategory[];
  city: string | null;
  status: KnowledgeIngestionStatus;
  failureMessage: string | null;
  attempts: number;
  chunkCount: number;
  embeddingModel: string | null;
  embeddingVersion: string | null;
  chunkerVersion: string | null;
  ingestedAt: string | null;
  createdAt: string;
  updatedAt: string;
  permissions: { canEdit: boolean; canDelete: boolean; canIngest: boolean };
}

export interface KnowledgeSourcePage {
  items: KnowledgeSourceView[];
  page: number;
  limit: number;
  totalCount: number;
  totalPages: number;
}

export interface KnowledgeChunkView {
  id: string;
  chunkIndex: number;
  content: string;
  sectionTitle: string | null;
  pageNumber: number | null;
  tokenCount: number;
}

/** Which scopes the caller may publish to, and where. */
export interface KnowledgeAuthoring {
  visibilities: Array<{
    visibility: KnowledgeVisibility;
    organizations: Array<{ id: string; name: string }>;
    projects: Array<{ id: string; name: string }>;
  }>;
}

/** A retrieved passage, as cited. Maps to a real chunk. */
export interface KnowledgeCitation {
  /** E1, E2… as the answer cites it. */
  ref: string;
  sourceId: string;
  documentId: string;
  chunkId: string;
  title: string;
  sourceType: KnowledgeSourceType;
  sectionTitle: string | null;
  pageNumber: number | null;
  /** 0–1 hybrid score from the baseline ranker. Not a probability. */
  relevanceScore: number;
  excerpt: string;
  /** Opens the source at this chunk. */
  href: string;
  /** Whether the answer actually cited it. */
  cited: boolean;
}

/** `POST /knowledge/query` */
export interface KnowledgeAnswerView {
  id: string | null;
  question: string;
  context: KnowledgeContext;
  /** Null in retrieve-only mode. */
  answer: string | null;
  insufficientEvidence: boolean;
  /** The best match was weak: treat any answer with extra care. */
  weakRetrieval: boolean;
  suggestions: string[];
  sources: KnowledgeCitation[];
  model: { provider: string; name: string; version: string; promptVersion: string } | null;
  retrieval: {
    embeddingModel: string;
    embeddingVersion: string;
    retrievalVersion: string;
    candidates: number;
    returned: number;
  };
  answeredAt: string;
}
