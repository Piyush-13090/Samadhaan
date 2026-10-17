import {
  PROBLEM_CATEGORIES,
  type OrganizationType,
  type PriorityTier,
  type ProblemCategory,
  type ProblemSeverity,
  type ProblemStatus,
  type ProblemUrgency,
  type SearchEntityType,
  type SearchUnderstanding,
} from '@samadhaan/shared';
import { addDays, localDate } from '../analytics/analytics-time.js';

/**
 * Deterministic query understanding (Prompt 25).
 *
 * Reads a few explicit cues from the text — entity, category, severity,
 * status, time, place — and turns them into filters drawn **only** from the
 * real taxonomy. Anything it does not recognise stays as search text. It
 * never produces SQL; its output is validated filter values.
 *
 * Category words are applied as a filter only when the phrasing is clear:
 * followed by a problem noun ("drainage problems") or when nothing else is
 * left ("drainage"). In "water collecting on roads after rain" the word
 * "roads" stays text, so semantic search can find drainage reports.
 */

export interface ParsedFilters {
  category?: ProblemCategory;
  severity?: ProblemSeverity;
  urgency?: ProblemUrgency;
  priority?: PriorityTier;
  status?: ProblemStatus;
  verified?: boolean;
  resolved?: boolean;
  city?: string;
  postalCode?: string;
  from?: string;
  to?: string;
  radiusKm?: number;
  organizationType?: OrganizationType;
}

export interface ParsedQuery {
  entityType: SearchEntityType | null;
  filters: ParsedFilters;
  applied: SearchUnderstanding['applied'];
  /** Words left for keyword and semantic matching, in the user's casing. */
  text: string;
  needsLocation: boolean;
  confidence: number;
  /** Natural-language phrasing the rules could not read — an AI fallback candidate. */
  ambiguous: boolean;
}

/** Phrase → category. Every value is a real ProblemCategory (checked in tests). */
export const CATEGORY_TERMS: ReadonlyArray<[string, ProblemCategory]> = [
  ['street lights', 'STREETLIGHTS'],
  ['street light', 'STREETLIGHTS'],
  ['streetlights', 'STREETLIGHTS'],
  ['streetlight', 'STREETLIGHTS'],
  ['water supply', 'WATER'],
  ['water leak', 'WATER'],
  ['public transport', 'PUBLIC_TRANSPORT'],
  ['public safety', 'PUBLIC_SAFETY'],
  ['waste management', 'GARBAGE'],
  ['potholes', 'POTHOLES'],
  ['pothole', 'POTHOLES'],
  ['drainage', 'DRAINAGE'],
  ['drains', 'DRAINAGE'],
  ['drain', 'DRAINAGE'],
  ['sewer', 'DRAINAGE'],
  ['stormwater', 'DRAINAGE'],
  ['waterlogging', 'DRAINAGE'],
  ['flooding', 'DRAINAGE'],
  ['sanitation', 'SANITATION'],
  ['sewage', 'SANITATION'],
  ['toilets', 'SANITATION'],
  ['toilet', 'SANITATION'],
  ['garbage', 'GARBAGE'],
  ['waste', 'GARBAGE'],
  ['trash', 'GARBAGE'],
  ['litter', 'GARBAGE'],
  ['rubbish', 'GARBAGE'],
  ['roads', 'ROADS'],
  ['road', 'ROADS'],
  ['footpath', 'ROADS'],
  ['water', 'WATER'],
  ['traffic', 'TRAFFIC'],
  ['parking', 'TRAFFIC'],
  ['safety', 'PUBLIC_SAFETY'],
  ['pollution', 'POLLUTION'],
  ['electricity', 'ELECTRICITY'],
  ['power', 'ELECTRICITY'],
  ['transport', 'PUBLIC_TRANSPORT'],
  ['bus', 'PUBLIC_TRANSPORT'],
  ['parks', 'PARKS'],
  ['park', 'PARKS'],
  ['infrastructure', 'PUBLIC_INFRASTRUCTURE'],
];

const PROBLEM_NOUNS = new Set([
  'problem',
  'problems',
  'issue',
  'issues',
  'complaint',
  'complaints',
  'report',
  'reports',
]);

const ORG_TERMS: ReadonlyArray<[string, OrganizationType | null]> = [
  ['government offices', 'GOVERNMENT'],
  ['government office', 'GOVERNMENT'],
  ['ngos', 'NGO'],
  ['ngo', 'NGO'],
  ['universities', 'UNIVERSITY'],
  ['university', 'UNIVERSITY'],
  ['colleges', 'UNIVERSITY'],
  ['companies', 'INDUSTRY'],
  ['company', 'INDUSTRY'],
  ['industry', 'INDUSTRY'],
  ['organisations', null],
  ['organizations', null],
  ['organisation', null],
  ['organization', null],
  ['groups', null],
];
const ORG_LABEL: Record<OrganizationType, string> = {
  NGO: 'NGOs',
  UNIVERSITY: 'Universities',
  INDUSTRY: 'Industry',
  GOVERNMENT: 'Government offices',
};
const KNOWLEDGE_TERMS = [
  'guidelines',
  'guideline',
  'guidance',
  'guide',
  'policies',
  'policy',
  'manual',
  'standards',
  'sop',
  'how to',
];
const PROJECT_TERMS = ['projects', 'project'];

const NL_CUES = new Set([
  'show',
  'find',
  'which',
  'where',
  'what',
  'any',
  'me',
  'near',
  'around',
  'latest',
  'worst',
  'most',
  'list',
  'give',
  'are',
  'there',
]);
const FILLER = new Set([
  'show',
  'me',
  'find',
  'all',
  'any',
  'the',
  'a',
  'an',
  'of',
  'for',
  'with',
  'that',
  'which',
  'are',
  'is',
  'there',
  'list',
  'give',
  'what',
  'where',
  'please',
  'working',
  'on',
  'about',
  'related',
  'to',
  'and',
  'in',
  'at',
  'near',
  'around',
  'from',
  'reported',
  'recent',
]); // fmt: keep

const TITLE = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase());
const label = (value: string) =>
  value.charAt(0) + value.slice(1).toLowerCase().replace(/_/g, ' ');

export interface ParseContext {
  /** Known city names, lowercase → display form (from the database). */
  cities: ReadonlyMap<string, string>;
  timezone: string;
  now?: Date;
  /** The caller supplied a location (near me can be honoured). */
  hasOrigin?: boolean;
}

/** Finds `phrase` as whole words in `tokens`; returns the start index or -1. */
function findPhrase(tokens: string[], phrase: string, used: boolean[]): number {
  const words = phrase.split(' ');
  outer: for (let i = 0; i + words.length <= tokens.length; i++) {
    for (let j = 0; j < words.length; j++) {
      if (used[i + j] || tokens[i + j] !== words[j]) continue outer;
    }
    return i;
  }
  return -1;
}

export function parseSearchQuery(raw: string, context: ParseContext): ParsedQuery {
  const original = raw.trim().replace(/\s+/g, ' ').slice(0, 200);
  const display = original.split(' ');
  const tokens = display.map((t) => t.toLowerCase().replace(/[^\p{L}\p{N}-]/gu, ''));
  const used = tokens.map((t) => t.length === 0);
  const filters: ParsedFilters = {};
  const applied: SearchUnderstanding['applied'] = [];
  let entityType: SearchEntityType | null = null;
  let needsLocation = false;
  const mark = (start: number, length: number) => {
    for (let k = start; k < start + length; k++) used[k] = true;
  };
  const take = (phrase: string): number => {
    const at = findPhrase(tokens, phrase, used);
    if (at >= 0) mark(at, phrase.split(' ').length);
    return at;
  };
  const now = context.now ?? new Date();
  const today = localDate(now, context.timezone);

  // --- entity ------------------------------------------------------------
  for (const [term, type] of ORG_TERMS) {
    if (take(term) >= 0) {
      entityType = 'ORGANIZATION';
      if (type && !filters.organizationType) {
        filters.organizationType = type;
        applied.push({ filter: 'organizationType', value: type, label: ORG_LABEL[type] });
      }
      break;
    }
  }
  if (!entityType) {
    for (const term of KNOWLEDGE_TERMS) {
      if (take(term) >= 0) {
        entityType = 'KNOWLEDGE';
        break;
      }
    }
  }
  if (!entityType) {
    for (const term of PROJECT_TERMS) {
      if (take(term) >= 0) {
        entityType = 'PROJECT';
        break;
      }
    }
  }

  // --- place ---------------------------------------------------------------
  for (const phrase of ['near me', 'around me', 'nearby', 'close to me']) {
    if (take(phrase) >= 0) needsLocation = true;
  }
  const within = original.toLowerCase().match(/\bwithin (\d{1,2}(?:\.\d)?) ?km\b/);
  if (within) {
    const radius = Math.min(50, Math.max(0.5, Number(within[1])));
    filters.radiusKm = radius;
    applied.push({
      filter: 'radiusKm',
      value: String(radius),
      label: `Within ${radius} km`,
    });
    const at = tokens.indexOf('within');
    if (at >= 0) mark(at, tokens[at + 2] === 'km' ? 3 : 2);
  }
  const postal = tokens.findIndex((t, i) => !used[i] && /^\d{6}$/.test(t));
  if (postal >= 0) {
    filters.postalCode = tokens[postal];
    applied.push({
      filter: 'postalCode',
      value: tokens[postal]!,
      label: `Postal code ${tokens[postal]}`,
    });
    used[postal] = true;
  }
  // Known cities only — two-word names first.
  for (let n = 2; n >= 1 && !filters.city; n--) {
    for (let i = 0; i + n <= tokens.length; i++) {
      if (used.slice(i, i + n).some(Boolean)) continue;
      const name = tokens.slice(i, i + n).join(' ');
      const city = context.cities.get(name);
      if (city) {
        filters.city = city;
        applied.push({ filter: 'city', value: city, label: city });
        mark(i, n);
        break;
      }
    }
  }

  // --- time ----------------------------------------------------------------
  const time = (from: string, to: string, text: string) => {
    filters.from = from;
    filters.to = to;
    applied.push({ filter: 'dateRange', value: `${from}..${to}`, label: text });
  };
  const lower = tokens.join(' ');
  const relative = lower.match(
    /\b(?:last|past) (\d{1,3}) (day|days|week|weeks|month|months)\b/,
  );
  if (relative) {
    const n = Number(relative[1]);
    const days = relative[2]!.startsWith('day')
      ? n
      : relative[2]!.startsWith('week')
        ? n * 7
        : n * 30;
    const bounded = Math.min(731, Math.max(1, days));
    time(addDays(today, -(bounded - 1)), today, `Last ${n} ${relative[2]}`);
    take(`${tokens.includes('last') ? 'last' : 'past'} ${relative[1]} ${relative[2]}`);
  } else if (take('this month') >= 0) {
    time(`${today.slice(0, 7)}-01`, today, 'This month');
  } else if (take('last month') >= 0) {
    const firstThis = `${today.slice(0, 7)}-01`;
    const lastPrev = addDays(firstThis, -1);
    time(`${lastPrev.slice(0, 7)}-01`, lastPrev, 'Last month');
  } else if (take('this week') >= 0 || take('past week') >= 0 || take('last week') >= 0) {
    time(addDays(today, -6), today, 'Past 7 days');
  } else if (take('this year') >= 0) {
    time(`${today.slice(0, 4)}-01-01`, today, 'This year');
  } else if (take('today') >= 0) {
    time(today, today, 'Today');
  } else if (take('yesterday') >= 0) {
    const y = addDays(today, -1);
    time(y, y, 'Yesterday');
  } else if (take('recently') >= 0 || take('latest') >= 0) {
    time(addDays(today, -29), today, 'Last 30 days');
  }

  // --- severity, priority, status -------------------------------------------
  if (take('high priority') >= 0) {
    filters.priority = 'HIGH';
    applied.push({ filter: 'priority', value: 'HIGH', label: 'High priority' });
  } else if (take('critical priority') >= 0) {
    filters.priority = 'CRITICAL';
    applied.push({ filter: 'priority', value: 'CRITICAL', label: 'Critical priority' });
  }
  if (take('critical') >= 0) {
    filters.severity = 'CRITICAL';
    applied.push({ filter: 'severity', value: 'CRITICAL', label: 'Critical' });
  } else if (take('severe') >= 0 || take('serious') >= 0 || take('dangerous') >= 0) {
    filters.severity = 'HIGH';
    applied.push({ filter: 'severity', value: 'HIGH', label: 'High severity' });
  } else if (take('minor') >= 0) {
    filters.severity = 'LOW';
    applied.push({ filter: 'severity', value: 'LOW', label: 'Low severity' });
  }
  if (take('urgent') >= 0) {
    filters.urgency = 'HIGH';
    applied.push({ filter: 'urgency', value: 'HIGH', label: 'Urgent' });
  }
  if (take('in progress') >= 0 || take('ongoing') >= 0 || take('being fixed') >= 0) {
    filters.status = 'IN_PROGRESS';
    applied.push({ filter: 'status', value: 'IN_PROGRESS', label: 'In progress' });
  } else if (take('unresolved') >= 0 || take('open') >= 0 || take('pending') >= 0) {
    filters.resolved = false;
    applied.push({ filter: 'resolved', value: 'false', label: 'Not resolved' });
  } else if (take('resolved') >= 0 || take('fixed') >= 0 || take('completed') >= 0) {
    filters.resolved = true;
    applied.push({ filter: 'resolved', value: 'true', label: 'Resolved' });
  } else if (take('rejected') >= 0) {
    filters.status = 'REJECTED';
    applied.push({ filter: 'status', value: 'REJECTED', label: 'Rejected' });
  }
  if (take('verified') >= 0) {
    filters.verified = true;
    applied.push({ filter: 'verified', value: 'true', label: 'Verified' });
  }

  // --- category (only when the phrasing is clear) ---------------------------
  const nounAt = tokens.findIndex((t, i) => !used[i] && PROBLEM_NOUNS.has(t));
  for (const [phrase, category] of CATEGORY_TERMS) {
    const at = findPhrase(tokens, phrase, used);
    if (at < 0) continue;
    const length = phrase.split(' ').length;
    const next = tokens
      .slice(at + length)
      .find((t, k) => !used[at + length + k] && t.length > 0);
    const leftover = tokens.filter(
      (t, i) =>
        !used[i] &&
        (i < at || i >= at + length) &&
        t.length > 0 &&
        !FILLER.has(t) &&
        !PROBLEM_NOUNS.has(t),
    );
    const clear =
      (next !== undefined && PROBLEM_NOUNS.has(next)) ||
      leftover.length === 0 ||
      (entityType === 'ORGANIZATION' &&
        tokens.slice(Math.max(0, at - 3), at).includes('on'));
    if (clear) {
      filters.category = category;
      applied.push({ filter: 'category', value: category, label: label(category) });
      mark(at, length);
    }
    break;
  }
  if (nounAt >= 0) {
    used[nounAt] = true;
    entityType ??= 'PROBLEM';
  }
  for (let i = 0; i < tokens.length; i++)
    if (PROBLEM_NOUNS.has(tokens[i]!)) used[i] = true;

  // --- what is left -----------------------------------------------------------
  const rest = display.filter((_, i) => !used[i] && !FILLER.has(tokens[i]!));
  const text = rest
    .join(' ')
    .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const words = tokens.filter((t) => t.length > 0);
  const cues = words.some((t) => NL_CUES.has(t)) || original.includes('?');
  const found = applied.length > 0 || entityType !== null || needsLocation;
  const ambiguous = !found && cues && words.length >= 4;
  return {
    entityType,
    filters,
    applied,
    text,
    needsLocation: needsLocation && !context.hasOrigin,
    confidence: found ? 0.9 : ambiguous ? 0.3 : 1,
    ambiguous,
  };
}

export function intentFor(
  entity: SearchEntityType | null,
): SearchUnderstanding['intent'] {
  switch (entity) {
    case 'PROBLEM':
      return 'SEARCH_PROBLEMS';
    case 'ORGANIZATION':
      return 'SEARCH_ORGANIZATIONS';
    case 'KNOWLEDGE':
      return 'SEARCH_KNOWLEDGE';
    case 'PROJECT':
      return 'SEARCH_PROJECTS';
    default:
      return 'SEARCH_ALL';
  }
}

export const isCategory = (value: unknown): value is ProblemCategory =>
  typeof value === 'string' && (PROBLEM_CATEGORIES as readonly string[]).includes(value);

export { TITLE as titleCase };
