import type { MatchReason, WorkspaceOrganizationType } from '@samadhaan/shared';
import { formatDistance } from './format';
import { ORGANIZATION_TYPE_LABEL } from './workspace';

/**
 * How match evidence is put into words.
 *
 * Every sentence here is a template over a signal the engine actually
 * computed — never generated text. Relevance is shown as "N% relevance",
 * never as confidence: it is a weighted score from a heuristic baseline,
 * not a calibrated probability.
 */

export function formatRelevance(relevance: number): string {
  return `${Math.round(relevance * 100)}% relevance`;
}

export type RelevanceBand = 'high' | 'moderate' | 'possible';

export function relevanceBand(relevance: number): RelevanceBand {
  if (relevance >= 0.75) return 'high';
  if (relevance >= 0.55) return 'moderate';
  return 'possible';
}

export const RELEVANCE_BAND_LABEL: Record<RelevanceBand, string> = {
  high: 'High relevance',
  moderate: 'Moderate relevance',
  possible: 'Possibly relevant',
};

/** One reason as a short sentence. `perspective` decides who "you" is. */
export function describeReason(
  reason: MatchReason,
  context: { perspective: 'citizen' | 'organization'; type?: WorkspaceOrganizationType },
): string {
  const ours = context.perspective === 'organization';
  switch (reason.code) {
    case 'EXPERTISE_STRONG':
      return ours
        ? 'Strong match with your expertise'
        : 'Strong expertise in this kind of problem';
    case 'EXPERTISE_RELATED':
      return ours ? 'Related to your areas of work' : 'Works in a related area';
    case 'SEMANTIC_HIGH':
      return ours
        ? 'Closely resembles the work you describe'
        : 'Profile closely matches this problem';
    case 'SEMANTIC_MODERATE':
      return ours
        ? 'Similar to the work you describe'
        : 'Profile is similar to this problem';
    case 'WITHIN_SERVICE_AREA': {
      const where = ours ? 'your registered location' : 'this problem';
      return reason.value < 1000
        ? `Less than 1 km from ${where}`
        : `${formatDistance(reason.value)} from ${where}`;
    }
    case 'SAME_CITY':
      return ours ? 'In your city' : 'Based in the same city';
    case 'IN_REGION':
      return `In the region (${formatDistance(reason.value)} away)`;
    case 'TYPE_FIT':
      return context.type
        ? `Suits the kind of work ${ORGANIZATION_TYPE_LABEL[context.type].toLowerCase()} partners do`
        : 'Suits the kind of work this organisation does';
    case 'RELATED_ACTIVITY':
      return ours
        ? 'You have suggested solutions to similar problems'
        : 'Has suggested solutions to similar problems';
  }
}
