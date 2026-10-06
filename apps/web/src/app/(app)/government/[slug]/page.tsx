import { redirect } from 'next/navigation';
import { TREND_RANGES, type TrendRange } from '@samadhaan/shared';
import { governmentPath } from '@/lib/government';

/** `/government/:slug` is the dashboard; `?range=` is kept. */
export default async function GovernmentIndex({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ range?: string }>;
}) {
  const { slug } = await params;
  const { range } = await searchParams;
  const valid = TREND_RANGES.find((value) => String(value) === range) as
    TrendRange | undefined;
  redirect(`${governmentPath(slug)}${valid ? `?range=${valid}` : ''}`);
}
