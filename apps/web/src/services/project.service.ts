import type {
  MilestoneView,
  ProjectActivityPage,
  ProjectAssignee,
  ProjectStatus,
  ProjectView,
  TaskPage,
  TaskPriority,
  TaskStatus,
  TaskView,
} from '@samadhaan/shared';
import { api, createServerApi } from '@/lib/api';
import { ApiError } from '@/lib/api-error';

/**
 * Resolution project calls (Prompt 18). Never sends a creator, organisation or
 * project owner — the API derives them. Edits carry the `version` the client
 * read, so a stale edit is refused rather than silently overwriting.
 */

const base = (projectId: string) =>
  `/resolution-projects/${encodeURIComponent(projectId)}`;

export type ProjectResult =
  | { kind: 'ok'; project: ProjectView }
  | { kind: 'not-found' }
  | { kind: 'error'; reference?: string };

export async function fetchRoomProjectOnServer(
  roomId: string,
  cookieHeader: string,
): Promise<ProjectResult> {
  try {
    const project = await createServerApi().get<ProjectView>(
      `/resolution-rooms/${encodeURIComponent(roomId)}/project`,
      {
        cache: 'no-store',
        headers: cookieHeader ? { cookie: cookieHeader } : ({} as Record<string, string>),
      },
    );
    return { kind: 'ok', project };
  } catch (error) {
    if (error instanceof ApiError && (error.status === 404 || error.status === 400)) {
      return { kind: 'not-found' };
    }
    return {
      kind: 'error',
      reference: error instanceof ApiError ? error.requestId : undefined,
    };
  }
}

export function fetchProject(projectId: string): Promise<ProjectView> {
  return api.get<ProjectView>(base(projectId), { cache: 'no-store' });
}

export function updateProject(
  projectId: string,
  input: {
    version: number;
    name?: string;
    description?: string | null;
    startDate?: string | null;
    targetDate?: string | null;
  },
): Promise<ProjectView> {
  return api.patch<ProjectView>(base(projectId), input);
}

export function changeProjectStatus(
  projectId: string,
  status: ProjectStatus,
  reason?: string,
): Promise<ProjectView> {
  return api.post<ProjectView>(`${base(projectId)}/status`, {
    status,
    ...(reason ? { reason } : {}),
  });
}

export interface TaskQuery {
  status?: TaskStatus[];
  priority?: TaskPriority[];
  assignee?: string;
  milestoneId?: string;
  overdue?: boolean;
}

export function fetchTasks(
  projectId: string,
  query: TaskQuery = {},
  signal?: AbortSignal,
): Promise<TaskPage> {
  const params = new URLSearchParams({ limit: '200' });
  if (query.status?.length) params.set('status', query.status.join(','));
  if (query.priority?.length) params.set('priority', query.priority.join(','));
  if (query.assignee) params.set('assignee', query.assignee);
  if (query.milestoneId) params.set('milestoneId', query.milestoneId);
  if (query.overdue) params.set('overdue', 'true');
  return api.get<TaskPage>(`${base(projectId)}/tasks?${params}`, {
    cache: 'no-store',
    signal,
  });
}

export interface TaskInput {
  title: string;
  description: string | null;
  priority: TaskPriority;
  assignedToId: string | null;
  dueDate: string | null;
  milestoneId: string | null;
}

export function createTask(projectId: string, input: TaskInput): Promise<TaskView> {
  return api.post<TaskView>(`${base(projectId)}/tasks`, input);
}

export function updateTask(
  projectId: string,
  taskId: string,
  input: Partial<TaskInput> & { version: number },
): Promise<TaskView> {
  return api.patch<TaskView>(
    `${base(projectId)}/tasks/${encodeURIComponent(taskId)}`,
    input,
  );
}

export function changeTaskStatus(
  projectId: string,
  taskId: string,
  status: TaskStatus,
): Promise<TaskView> {
  return api.post<TaskView>(
    `${base(projectId)}/tasks/${encodeURIComponent(taskId)}/status`,
    {
      status,
    },
  );
}

export function fetchAssignees(projectId: string): Promise<ProjectAssignee[]> {
  return api.get<ProjectAssignee[]>(`${base(projectId)}/assignees`, {
    cache: 'no-store',
  });
}

export function fetchMilestones(projectId: string): Promise<MilestoneView[]> {
  return api.get<MilestoneView[]>(`${base(projectId)}/milestones`, { cache: 'no-store' });
}

export function createMilestone(
  projectId: string,
  input: { title: string; description: string | null; dueDate: string | null },
): Promise<MilestoneView[]> {
  return api.post<MilestoneView[]>(`${base(projectId)}/milestones`, input);
}

export function setMilestoneCompleted(
  projectId: string,
  milestoneId: string,
  completed: boolean,
): Promise<MilestoneView[]> {
  return api.post<MilestoneView[]>(
    `${base(projectId)}/milestones/${encodeURIComponent(milestoneId)}/${completed ? 'complete' : 'reopen'}`,
  );
}

export function fetchProjectActivity(
  projectId: string,
  cursor?: string | null,
): Promise<ProjectActivityPage> {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
  return api.get<ProjectActivityPage>(`${base(projectId)}/activity${query}`, {
    cache: 'no-store',
  });
}
