import type {
  ImpactFilter,
  ImpactTransactionType,
  LeaderboardPeriod,
  ReputationTier,
} from '@samadhaan/shared';
import type { Tone } from '@/types/ui';

export const TIER_DISPLAY: Record<ReputationTier, { label: string; tone: Tone }> = {
  NEW_CONTRIBUTOR: { label: 'New Contributor', tone: 'neutral' },
  ACTIVE_CONTRIBUTOR: { label: 'Active Contributor', tone: 'info' },
  TRUSTED_CONTRIBUTOR: { label: 'Trusted Contributor', tone: 'primary' },
  CIVIC_CHAMPION: { label: 'Civic Champion', tone: 'success' },
  CIVIC_LEADER: { label: 'Civic Leader', tone: 'success' },
};

export const TRANSACTION_LABEL: Record<ImpactTransactionType, string> = {
  PROBLEM_REPORTED: 'Problem reported',
  PROBLEM_VERIFIED: 'Report verified',
  DUPLICATE_IDENTIFIED: 'Confirmed duplicate',
  USEFUL_COMMENT: 'Helpful comment',
  PROBLEM_SUPPORTED: 'Early support',
  PROJECT_CONTRIBUTION: 'Project completed',
  TASK_COMPLETED: 'Project task',
  MILESTONE_COMPLETED: 'Project milestone',
  RESOLUTION_EVIDENCE_SUBMITTED: 'Approved evidence',
  PROBLEM_RESOLVED: 'Problem resolved',
  QUALITY_BONUS: 'Quality bonus',
  PENALTY: 'Penalty',
  ADMIN_ADJUSTMENT: 'Correction',
};

export const FILTER_LABEL: Record<ImpactFilter, string> = {
  all: 'All',
  reports: 'Reports',
  community: 'Community',
  projects: 'Projects',
  resolutions: 'Resolutions',
  bonuses: 'Bonuses',
};

export const PERIOD_LABEL: Record<LeaderboardPeriod, string> = {
  week: 'This week',
  month: 'This month',
  year: 'This year',
  all: 'All time',
};
