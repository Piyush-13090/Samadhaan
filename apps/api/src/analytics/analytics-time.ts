import {
  ANALYTICS_MAX_RANGE_DAYS,
  type AnalyticsGranularity,
  type AnalyticsPeriod,
  type AnalyticsPreset,
} from '@samadhaan/shared';
import { AppException } from '../common/app.exception.js';
import { Prisma } from '../generated/prisma/client.js';

/**
 * Time for analytics (Prompt 24).
 *
 * Instants are stored in UTC; people think in local days. A period is
 * therefore chosen as local dates in an explicit reporting time zone and
 * converted, here in Node, to the UTC instants of local midnight. SQL compares
 * columns with those instants and groups by the local date of each row.
 *
 * Grouping by `AT TIME ZONE 'UTC'` is the day-boundary bug the government
 * dashboard had: a report filed at 01:00 in Kolkata belongs to that day, not
 * the previous one.
 */

const DAY_MS = 86_400_000;

const PRESET_DAYS: Record<Exclude<AnalyticsPreset, 'custom'>, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
  '6m': 182,
  '1y': 365,
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface ResolvedPeriod {
  period: AnalyticsPeriod;
  /** Local midnight of `from`, as an instant. Inclusive. */
  start: Date;
  /** Local midnight after `to`. Exclusive. */
  end: Date;
  previousStart: Date;
  previousEnd: Date;
  days: number;
}

export function isTimeZone(zone: string): boolean {
  if (!zone || zone.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** The local calendar date of an instant in a time zone, YYYY-MM-DD. */
export function localDate(instant: Date, zone: string): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

/** Minutes the zone is ahead of UTC at an instant. */
function offsetMinutes(instant: Date, zone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  return Math.round((asUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60_000);
}

/** The instant local midnight starts on a date in a zone (DST-safe). */
export function zonedMidnight(date: string, zone: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d);
  let instant = guess - offsetMinutes(new Date(guess), zone) * 60_000;
  // A second pass settles a guess that landed across an offset change.
  instant = guess - offsetMinutes(new Date(instant), zone) * 60_000;
  return new Date(instant);
}

/** Calendar arithmetic on YYYY-MM-DD, independent of any zone. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) + days * DAY_MS).toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  const [a, b] = [from, to].map((value) => {
    const [y, m, d] = value.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  });
  return Math.round((b - a) / DAY_MS);
}

function validDate(value: string): boolean {
  if (!DATE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(y, m - 1, d));
  return (
    parsed.getUTCFullYear() === y &&
    parsed.getUTCMonth() === m - 1 &&
    parsed.getUTCDate() === d
  );
}

export function granularityFor(days: number): AnalyticsGranularity {
  if (days <= 31) return 'day';
  if (days <= 184) return 'week';
  return 'month';
}

/**
 * Resolves a preset or custom range. Custom ranges are validated: real dates,
 * from ≤ to, not in the future, at most two years.
 */
export function resolvePeriod(
  input: { preset?: AnalyticsPreset; from?: string; to?: string; timezone?: string },
  defaultZone: string,
  now: Date = new Date(),
): ResolvedPeriod {
  const timezone = input.timezone ?? defaultZone;
  if (!isTimeZone(timezone)) {
    throw AppException.badRequest(
      'timezone must be an IANA time zone, e.g. Asia/Kolkata.',
    );
  }
  const today = localDate(now, timezone);
  const preset: AnalyticsPreset =
    input.preset ?? (input.from || input.to ? 'custom' : '30d');

  let from: string;
  let to: string;
  if (preset === 'custom') {
    if (!input.from || !input.to || !validDate(input.from) || !validDate(input.to)) {
      throw AppException.badRequest(
        'A custom range needs from and to as YYYY-MM-DD dates.',
      );
    }
    from = input.from;
    to = input.to;
    if (from > to) throw AppException.badRequest('from must not be after to.');
    if (to > today) throw AppException.badRequest('to must not be in the future.');
    if (daysBetween(from, to) + 1 > ANALYTICS_MAX_RANGE_DAYS) {
      throw AppException.badRequest(
        `A range may span at most ${ANALYTICS_MAX_RANGE_DAYS} days.`,
      );
    }
  } else {
    to = today;
    from = addDays(today, -(PRESET_DAYS[preset] - 1));
  }

  const days = daysBetween(from, to) + 1;
  const previousTo = addDays(from, -1);
  const previousFrom = addDays(from, -days);
  return {
    period: {
      preset,
      from,
      to,
      timezone,
      granularity: granularityFor(days),
      previous: { from: previousFrom, to: previousTo },
    },
    start: zonedMidnight(from, timezone),
    end: zonedMidnight(addDays(to, 1), timezone),
    previousStart: zonedMidnight(previousFrom, timezone),
    previousEnd: zonedMidnight(from, timezone),
    days,
  };
}

/** The first day of the bucket a local date falls in (weeks start Monday). */
export function bucketStart(date: string, granularity: AnalyticsGranularity): string {
  if (granularity === 'day') return date;
  if (granularity === 'month') return `${date.slice(0, 7)}-01`;
  const [y, m, d] = date.split('-').map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
  return addDays(date, -((weekday + 6) % 7));
}

/** Every bucket in the period, so quiet buckets show as zero. */
export function bucketStarts(period: AnalyticsPeriod): string[] {
  const starts: string[] = [];
  let cursor = bucketStart(period.from, period.granularity);
  while (cursor <= period.to) {
    starts.push(cursor);
    if (period.granularity === 'day') cursor = addDays(cursor, 1);
    else if (period.granularity === 'week') cursor = addDays(cursor, 7);
    else {
      const [y, m] = cursor.split('-').map(Number);
      cursor = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
    }
  }
  return starts;
}

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

export function bucketLabel(start: string, granularity: AnalyticsGranularity): string {
  const [y, m, d] = start.split('-').map(Number);
  if (granularity === 'month') return `${MONTHS[m - 1]} ${y}`;
  if (granularity === 'week') return `Week of ${d} ${MONTHS[m - 1]}`;
  return `${d} ${MONTHS[m - 1]}`;
}

export function periodLabel(period: AnalyticsPeriod): string {
  return `${period.from} to ${period.to} (${period.timezone})`;
}

/**
 * The true instant of a stored timestamp.
 *
 * Timestamps written through Prisma reach PostgreSQL as zone-less literals
 * and are interpreted in the session's time zone; when that is not UTC they
 * are stored shifted by the session offset. Comparisons with Prisma Date
 * parameters are shifted identically and stay correct, but grouping by local
 * day must undo the shift. On a UTC session this expression is the identity,
 * so it is correct both before and after the database is configured for UTC.
 */
export function trueInstant(column: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`((${column} AT TIME ZONE current_setting('TimeZone')) AT TIME ZONE 'UTC')`;
}

/** The local bucket start of a timestamp column, as YYYY-MM-DD text. */
export function bucketSql(
  column: Prisma.Sql,
  granularity: AnalyticsGranularity,
  timezone: string,
): Prisma.Sql {
  return Prisma.sql`to_char(date_trunc(${granularity}, ${trueInstant(column)} AT TIME ZONE ${timezone}), 'YYYY-MM-DD')`;
}

/** Days between two stored timestamps (both shifted alike, so exact). */
export function daysSql(from: Prisma.Sql, to: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`(EXTRACT(EPOCH FROM (${to} - ${from})) / 86400.0)`;
}
