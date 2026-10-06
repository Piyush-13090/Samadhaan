import { Injectable } from '@nestjs/common';
import { projectToday } from '@samadhaan/shared';
import type { RequestUser } from '../auth/auth.types.js';
import { PrismaService } from '../database/prisma.service.js';
import { coarseArea } from '../problems/services/problem-discovery.service.js';
import { ProblemsService } from '../problems/problems.service.js';
import type { ProjectContext } from '../resolution/projects.service.js';
import { dateOut } from '../resolution/projects.service.js';

/** Strict bounds on what accompanies retrieved evidence. */
export const CONTEXT_LIMITS = {
  descriptionChars: 600,
  tasks: 10,
  milestones: 5,
  updates: 3,
  lineChars: 240,
} as const;

export interface ApplicationContext {
  /** Short, already-authorised fact lines for the model. */
  lines: string[];
  /** For the contextual retrieval query and the hybrid context signal. */
  category: string | null;
  city: string | null;
  /** Words that make the semantic query specific to this problem or project. */
  hint: string;
}

const clip = (text: string, max: number = CONTEXT_LIMITS.lineChars) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

/**
 * Bounded application context for RAG (Prompt 20).
 *
 * Built only from what the asker may already see: a problem through the
 * public problem rules (`ProblemsService.findByPublicId`), a project through
 * its proven `ProjectContext`. Never government internal notes, allocation
 * reasons, room messages or contact details.
 */
@Injectable()
export class KnowledgeContextBuilder {
  constructor(
    private readonly prisma: PrismaService,
    private readonly problems: ProblemsService,
  ) {}

  async forProblem(publicId: string, user: RequestUser): Promise<ApplicationContext> {
    const problem = await this.problems.findByPublicId(publicId, user); // 404 unless visible
    const analysis = await this.prisma.problemAiAnalysis.findFirst({
      where: {
        problem: { publicId: problem.publicId },
        analysisType: 'INITIAL_ANALYSIS',
        processingStatus: 'COMPLETED',
      },
      orderBy: { createdAt: 'desc' },
      select: { summary: true },
    });
    const area = coarseArea(problem.location.address, problem.location.city);
    return {
      lines: [
        clip(
          `Problem ${problem.publicId}: ${problem.title} (${problem.category}${problem.subcategory ? ` / ${problem.subcategory}` : ''})`,
        ),
        `Status: ${problem.status}; severity: ${problem.severity}${area ? `; area: ${area}` : ''}`,
        clip(`Description: ${problem.description}`, CONTEXT_LIMITS.descriptionChars),
        ...(analysis?.summary ? [clip(`AI analysis summary: ${analysis.summary}`)] : []),
      ],
      category: problem.category,
      city: problem.location.city,
      hint: `${problem.category.toLowerCase().replace('_', ' ')} ${problem.subcategory ?? ''} ${problem.title}`,
    };
  }

  async forProject(context: ProjectContext): Promise<ApplicationContext> {
    const { project } = context;
    const today = projectToday();
    const [problem, tasks, milestones, updates] = await Promise.all([
      this.prisma.problem.findUniqueOrThrow({
        where: { id: project.problemId },
        select: {
          publicId: true,
          title: true,
          category: true,
          subcategory: true,
          address: true,
          city: true,
        },
      }),
      this.prisma.resolutionTask.findMany({
        where: {
          projectId: project.id,
          status: { in: ['TODO', 'IN_PROGRESS', 'BLOCKED'] },
        },
        orderBy: [{ dueDate: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }],
        take: CONTEXT_LIMITS.tasks,
        select: { title: true, status: true, dueDate: true },
      }),
      this.prisma.resolutionMilestone.findMany({
        where: { projectId: project.id },
        orderBy: [{ dueDate: { sort: 'asc', nulls: 'last' } }],
        take: CONTEXT_LIMITS.milestones,
        select: { title: true, completedAt: true, dueDate: true },
      }),
      this.prisma.projectUpdate.findMany({
        where: { projectId: project.id },
        orderBy: { createdAt: 'desc' },
        take: CONTEXT_LIMITS.updates,
        select: { summary: true, blockers: true, nextSteps: true },
      }),
    ]);
    const area = coarseArea(problem.address, problem.city);
    return {
      lines: [
        clip(`Project: ${project.name} — status ${project.status} (today ${today})`),
        clip(
          `Problem ${problem.publicId}: ${problem.title} (${problem.category}${problem.subcategory ? ` / ${problem.subcategory}` : ''})${area ? `, ${area}` : ''}`,
        ),
        ...tasks.map((t) =>
          clip(
            `Open task: ${t.title} — ${t.status}${t.dueDate ? `, due ${dateOut(t.dueDate)}` : ''}`,
          ),
        ),
        ...milestones.map((m) =>
          clip(
            `Milestone: ${m.title} — ${m.completedAt ? 'completed' : 'open'}${m.dueDate ? `, due ${dateOut(m.dueDate)}` : ''}`,
          ),
        ),
        ...updates.map((u) =>
          clip(
            `Recent update: ${u.summary}${u.blockers.length ? `; blockers: ${u.blockers.join(', ')}` : ''}${u.nextSteps.length ? `; next: ${u.nextSteps.join(', ')}` : ''}`,
          ),
        ),
      ],
      category: problem.category,
      city: problem.city,
      hint: `${problem.category.toLowerCase().replace('_', ' ')} ${problem.subcategory ?? ''} ${problem.title} ${tasks
        .slice(0, 3)
        .map((t) => t.title)
        .join(' ')}`,
    };
  }
}
