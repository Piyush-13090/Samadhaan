import type {
  CommentSummary,
  ImpactStat,
  LeaderboardEntry,
  NotificationSummary,
  SuggestionSummary,
} from '@/types/domain';
import { PEOPLE } from './people';

const now = Date.now();
const hoursAgo = (hours: number) => new Date(now - hours * 3_600_000).toISOString();
const daysAgo = (days: number) => hoursAgo(days * 24);

/** The signed-in user's contribution summary, shown on the dashboard. */
export const MY_IMPACT: ImpactStat[] = [
  { id: 'reported', label: 'Problems reported', value: 8, change: 14 },
  { id: 'supported', label: 'Problems supported', value: 24, change: 8 },
  { id: 'suggestions', label: 'Suggestions made', value: 13, change: -5 },
  {
    id: 'points',
    label: 'Impact points',
    value: 480,
    unit: 'pts',
    change: 22,
    hint: 'Earned when problems you contributed to are resolved',
  },
];

/** City-wide figures for the landing page. */
export const PLATFORM_STATS: ImpactStat[] = [
  { id: 'reported', label: 'Problems reported', value: 12480 },
  { id: 'resolved', label: 'Problems resolved', value: 8912 },
  { id: 'orgs', label: 'Partner organisations', value: 164 },
  { id: 'citizens', label: 'Active citizens', value: 31200 },
];

export const SUGGESTIONS: SuggestionSummary[] = [
  {
    id: 'sug-1',
    author: PEOPLE.vikram,
    content:
      'The blockage is at the junction box, not the main drain. Clearing that first would drain the standing water within a day, before any longer-term work.',
    endorsements: 64,
    createdAt: daysAgo(5),
    accepted: true,
  },
  {
    id: 'sug-2',
    author: PEOPLE.sneha,
    content:
      'A temporary raised walkway along the market entrance would keep the footpath usable while the drainage work happens.',
    endorsements: 41,
    createdAt: daysAgo(4),
  },
];

export const COMMENTS: CommentSummary[] = [
  {
    id: 'cmt-1',
    author: PEOPLE.fatima,
    content:
      'This has happened every monsoon for the last three years. Good to finally see it tracked properly.',
    createdAt: daysAgo(5),
    replyCount: 3,
  },
  {
    id: 'cmt-2',
    author: PEOPLE.rahul,
    content:
      'Walked past this morning — the water level has dropped noticeably since the clearing started.',
    createdAt: hoursAgo(14),
    replyCount: 1,
  },
];

export const NOTIFICATIONS: NotificationSummary[] = [
  {
    id: 'ntf-1',
    kind: 'AI_ANALYSIS',
    title: 'Samadhaan AI analysed your report',
    body: 'SAM-1027 was categorised as public safety with severity 9.4.',
    createdAt: hoursAgo(2),
    read: false,
    href: '/problems/SAM-1027',
  },
  {
    id: 'ntf-2',
    kind: 'ALLOCATION',
    title: 'A problem you support was allocated',
    body: 'SAM-1023 is now with Clean City Foundation.',
    createdAt: hoursAgo(9),
    read: false,
    href: '/problems/SAM-1023',
  },
  {
    id: 'ntf-3',
    kind: 'COMMENT',
    title: 'Rahul Verma commented',
    body: 'On SAM-1023: “Walked past this morning — the water level has dropped…”',
    createdAt: hoursAgo(14),
    read: false,
    href: '/problems/SAM-1023',
  },
  {
    id: 'ntf-4',
    kind: 'RESOLUTION',
    title: 'A problem you reported was resolved',
    body: 'SAM-1026 was verified and closed by the ward office.',
    createdAt: daysAgo(2),
    read: true,
    href: '/problems/SAM-1026',
  },
  {
    id: 'ntf-5',
    kind: 'SUGGESTION',
    title: 'Your suggestion was accepted',
    body: 'Ward 12 Municipal Office marked your suggestion on SAM-1023 as the approach being taken.',
    createdAt: daysAgo(3),
    read: true,
  },
];

export const LEADERBOARD: LeaderboardEntry[] = [
  {
    rank: 1,
    person: PEOPLE.vikram,
    impactPoints: 2840,
    problemsReported: 34,
    problemsResolved: 28,
    trend: 0,
  },
  {
    rank: 2,
    person: PEOPLE.fatima,
    impactPoints: 2115,
    problemsReported: 41,
    problemsResolved: 19,
    trend: 2,
  },
  {
    rank: 3,
    person: PEOPLE.arjun,
    impactPoints: 1902,
    problemsReported: 27,
    problemsResolved: 17,
    trend: -1,
  },
  {
    rank: 4,
    person: PEOPLE.priya,
    impactPoints: 1480,
    problemsReported: 8,
    problemsResolved: 12,
    trend: 3,
  },
  {
    rank: 5,
    person: PEOPLE.sneha,
    impactPoints: 1244,
    problemsReported: 19,
    problemsResolved: 9,
    trend: -2,
  },
];
