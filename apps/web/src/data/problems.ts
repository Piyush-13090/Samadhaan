import type { ProblemSummary, TimelineEvent } from '@/types/domain';
import { ORGANIZATIONS } from './organizations';
import { PEOPLE } from './people';

/**
 * Fixture problems for design previews.
 *
 * Dates are relative to module load so the previews never show stale
 * timestamps, and `formatRelativeTime` has something sensible to render.
 */
const now = Date.now();
const hoursAgo = (hours: number) => new Date(now - hours * 3_600_000).toISOString();
const daysAgo = (days: number) => hoursAgo(days * 24);

export const PROBLEMS: ProblemSummary[] = [
  {
    id: 'prb-1023',
    reference: 'SAM-1023',
    title: 'Waterlogging near Sector 12 market',
    description:
      'Water has been standing at the market entrance for three days after the last rain. Shopkeepers are laying planks across the road and two people have slipped.',
    status: 'IN_PROGRESS',
    severity: 'HIGH',
    category: 'WATER',
    location: {
      address: 'Sector 12 Market Road, near Bus Stop 4',
      area: 'Sector 12',
      latitude: 28.5921,
      longitude: 77.046,
      distanceMeters: 850,
    },
    reporter: PEOPLE.arjun,
    supporterCount: 342,
    commentCount: 28,
    suggestionCount: 6,
    reportedAt: daysAgo(6),
    progress: 64,
    assignedTo: [ORGANIZATIONS[0]!, ORGANIZATIONS[1]!],
    ai: {
      category: 'WATER',
      severityScore: 8.7,
      severity: 'HIGH',
      confidence: 0.94,
      observations: [
        'Standing water covering a pedestrian route',
        'Blocked stormwater drain visible at the kerb',
        'Recurring location — 3 similar reports in 8 months',
      ],
      duplicateCandidates: 2,
    },
  },
  {
    id: 'prb-1024',
    reference: 'SAM-1024',
    title: 'Broken streetlight near Community Park',
    description:
      'The light at the park’s north gate has been out for two weeks. The path is completely dark after 7pm and is used by people walking home.',
    status: 'OPEN',
    severity: 'MEDIUM',
    category: 'ELECTRICITY',
    location: {
      address: 'Community Park, North Gate',
      area: 'Sector 9',
      latitude: 28.5967,
      longitude: 77.0512,
      distanceMeters: 1250,
    },
    reporter: PEOPLE.fatima,
    supporterCount: 87,
    commentCount: 11,
    suggestionCount: 2,
    reportedAt: daysAgo(2),
    ai: {
      category: 'ELECTRICITY',
      severityScore: 5.4,
      severity: 'MEDIUM',
      confidence: 0.89,
      observations: [
        'Non-functioning street lamp on a pedestrian path',
        'Area has no alternative lighting',
      ],
    },
  },
  {
    id: 'prb-1025',
    reference: 'SAM-1025',
    title: 'Large pothole near Main Market crossing',
    description:
      'A pothole roughly two feet wide has opened at the crossing. Two-wheelers are swerving into the opposite lane to avoid it.',
    status: 'UNDER_REVIEW',
    severity: 'HIGH',
    category: 'ROAD',
    location: {
      address: 'Main Market Crossing, opposite State Bank',
      area: 'Sector 12',
      latitude: 28.5903,
      longitude: 77.0448,
      distanceMeters: 420,
    },
    reporter: PEOPLE.rahul,
    supporterCount: 214,
    commentCount: 19,
    suggestionCount: 4,
    reportedAt: hoursAgo(20),
    ai: {
      category: 'ROAD',
      severityScore: 7.9,
      severity: 'HIGH',
      confidence: 0.96,
      observations: [
        'Road surface failure on a high-traffic junction',
        'Vehicles observed changing lanes to avoid it',
        'Safety risk to two-wheeler riders',
      ],
      duplicateCandidates: 1,
    },
  },
  {
    id: 'prb-1026',
    reference: 'SAM-1026',
    title: 'Garbage accumulation near Block B',
    description:
      'The collection point behind Block B has not been cleared in over a week. It has started to smell and stray animals are scattering waste onto the footpath.',
    status: 'RESOLVED',
    severity: 'MEDIUM',
    category: 'SANITATION',
    location: {
      address: 'Block B service lane',
      area: 'Sector 15',
      latitude: 28.6011,
      longitude: 77.0389,
      distanceMeters: 2100,
    },
    reporter: PEOPLE.sneha,
    supporterCount: 156,
    commentCount: 23,
    suggestionCount: 5,
    reportedAt: daysAgo(14),
    progress: 100,
    assignedTo: [ORGANIZATIONS[0]!],
    ai: {
      category: 'SANITATION',
      severityScore: 6.1,
      severity: 'MEDIUM',
      confidence: 0.91,
      observations: [
        'Uncollected waste at a designated collection point',
        'Public health risk from scattering',
      ],
    },
  },
  {
    id: 'prb-1027',
    reference: 'SAM-1027',
    title: 'Missing manhole cover on Link Road',
    description:
      'An open manhole on the footpath outside the clinic. Someone has put a branch in it as a warning but it is not visible at night.',
    status: 'ALLOCATED',
    severity: 'CRITICAL',
    category: 'SAFETY',
    location: {
      address: 'Link Road, outside Sector 12 clinic',
      area: 'Sector 12',
      latitude: 28.5888,
      longitude: 77.0471,
      distanceMeters: 610,
    },
    reporter: PEOPLE.imran,
    supporterCount: 498,
    commentCount: 44,
    suggestionCount: 3,
    reportedAt: hoursAgo(9),
    progress: 20,
    assignedTo: [ORGANIZATIONS[2]!],
    ai: {
      category: 'SAFETY',
      severityScore: 9.4,
      severity: 'CRITICAL',
      confidence: 0.97,
      observations: [
        'Open drain access on a pedestrian footpath',
        'Immediate fall risk, unlit after dark',
        'Adjacent to a healthcare facility entrance',
      ],
    },
  },
  {
    id: 'prb-1028',
    reference: 'SAM-1028',
    title: 'Overgrown trees blocking footpath',
    description:
      'Branches along the stretch between Gate 2 and the school have grown across the footpath, forcing people to walk on the road.',
    status: 'OPEN',
    severity: 'LOW',
    category: 'ENVIRONMENT',
    location: {
      address: 'Green Avenue, Gate 2 to school gate',
      area: 'Sector 9',
      latitude: 28.5949,
      longitude: 77.0534,
      distanceMeters: 1680,
    },
    reporter: PEOPLE.ananya,
    supporterCount: 34,
    commentCount: 5,
    suggestionCount: 1,
    reportedAt: daysAgo(4),
    ai: {
      category: 'ENVIRONMENT',
      severityScore: 3.2,
      severity: 'LOW',
      confidence: 0.82,
      observations: [
        'Vegetation obstructing a pedestrian route',
        'Pedestrians diverted onto the carriageway',
      ],
    },
  },
];

/** Convenience slices used by the dashboard and landing previews. */
export const FEATURED_PROBLEM = PROBLEMS[0]!;

export const NEARBY_PROBLEMS = PROBLEMS.slice(0, 3);

export function findProblem(reference: string): ProblemSummary | undefined {
  return PROBLEMS.find((problem) => problem.reference === reference);
}

/** Resolution timeline for the featured problem. */
export const PROBLEM_TIMELINE: TimelineEvent[] = [
  {
    id: 'evt-1',
    title: 'Problem reported',
    description: 'Reported with 3 photos and a location tag.',
    timestamp: daysAgo(6),
    state: 'complete',
    actor: PEOPLE.arjun.name,
  },
  {
    id: 'evt-2',
    title: 'Samadhaan AI analysed the report',
    description:
      'Categorised as water infrastructure, severity 8.7, and matched to 2 possible earlier reports.',
    timestamp: daysAgo(6),
    state: 'complete',
    byAi: true,
  },
  {
    id: 'evt-3',
    title: 'Reviewed by Ward 12 Municipal Office',
    description: 'Confirmed as a drainage blockage and approved for allocation.',
    timestamp: daysAgo(4),
    state: 'complete',
    actor: 'Ward 12 Municipal Office',
  },
  {
    id: 'evt-4',
    title: 'Allocated to Clean City Foundation',
    description:
      'Drain clearing scheduled with support from the Institute of Urban Systems.',
    timestamp: daysAgo(3),
    state: 'complete',
    actor: 'Ward 12 Municipal Office',
  },
  {
    id: 'evt-5',
    title: 'Work in progress',
    description: 'Drain clearing 64% complete. Next update due in 2 days.',
    timestamp: hoursAgo(18),
    state: 'current',
    actor: 'Clean City Foundation',
  },
  {
    id: 'evt-6',
    title: 'Completion evidence and verification',
    description: 'Awaiting photos and sign-off from the ward office.',
    timestamp: daysAgo(-2),
    state: 'upcoming',
  },
];
