import type {
  CoordinatorView,
  ExtractedUpdateView,
  ProjectUpdateView,
} from '@samadhaan/shared';
import { api } from '@/lib/api';

/**
 * AI Project Coordinator calls (Prompt 19). Reading insights never runs the
 * model; only `refreshInsights` does, and the API rate-limits it.
 */
const base = (projectId: string) =>
  `/resolution-projects/${encodeURIComponent(projectId)}`;

export function fetchCoordinator(projectId: string): Promise<CoordinatorView> {
  return api.get<CoordinatorView>(`${base(projectId)}/ai-coordinator`, {
    cache: 'no-store',
  });
}

export function refreshInsights(projectId: string): Promise<CoordinatorView> {
  return api.post<CoordinatorView>(`${base(projectId)}/ai-coordinator/refresh`);
}

export function answerQuestion(
  projectId: string,
  questionId: string,
  input: { quick?: 'COMPLETED' | 'NOT_YET'; answer?: string },
): Promise<CoordinatorView> {
  return api.post<CoordinatorView>(
    `${base(projectId)}/ai-coordinator/questions/${encodeURIComponent(questionId)}/answer`,
    input,
  );
}

export function dismissQuestion(
  projectId: string,
  questionId: string,
): Promise<CoordinatorView> {
  return api.post<CoordinatorView>(
    `${base(projectId)}/ai-coordinator/questions/${encodeURIComponent(questionId)}/dismiss`,
  );
}

export function draftUpdate(
  projectId: string,
  input: { text?: string; fromRecentMessages?: boolean },
): Promise<ExtractedUpdateView> {
  return api.post<ExtractedUpdateView>(
    `${base(projectId)}/ai-coordinator/extract-update`,
    input,
  );
}

export function fetchUpdates(
  projectId: string,
  cursor?: string | null,
): Promise<{ items: ProjectUpdateView[]; nextCursor: string | null }> {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
  return api.get(`${base(projectId)}/updates${query}`, { cache: 'no-store' });
}

export interface UpdateInput {
  summary: string;
  completed: string[];
  current: string[];
  blockers: string[];
  nextSteps: string[];
  source: 'MANUAL' | 'AI_ASSISTED';
  aiModel?: string;
}

export function postUpdate(
  projectId: string,
  input: UpdateInput,
): Promise<ProjectUpdateView> {
  return api.post<ProjectUpdateView>(`${base(projectId)}/updates`, input);
}
