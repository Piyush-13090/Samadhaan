import {
  Building2,
  Camera,
  CheckCircle2,
  MapPin,
  MessageSquare,
  ShieldCheck,
  Sparkles,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { formatCompactNumber } from '@/lib/format';
import type { ImpactStat } from '@/types/domain';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { HeroVisual } from './hero-visual';

/**
 * Landing page sections.
 *
 * Copy follows the product voice: plain, short, confident. It says what happens
 * ("Samadhaan AI reads the photo") rather than naming the machinery ("multimodal
 * classification pipeline"), and it never claims a capability that is not built
 * — the tense stays honest about what the platform does today.
 */

export function Hero() {
  return (
    <section className="relative overflow-hidden border-b border-border">
      <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 py-16 sm:px-6 sm:py-20 lg:grid-cols-[1.05fr_1fr] lg:gap-16 lg:px-8 lg:py-28">
        <div className="max-w-xl">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-ai-border bg-ai-soft px-3 py-1 type-label text-ai">
            <Sparkles className="size-3.5" aria-hidden="true" />
            Powered by Samadhaan AI
          </span>

          <h1 className="mt-5 type-display text-ink">
            See a problem.
            <br />
            Start a solution.
          </h1>

          <p className="mt-5 max-w-lg type-body-lg text-ink-muted">
            Samadhaan turns everyday civic problems into organised action — powered by AI,
            strengthened by communities, and solved through collaboration.
          </p>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Button variant="primary" size="lg" asChild>
              <Link href="/report">Report a problem</Link>
            </Button>
            <Button variant="secondary" size="lg" asChild>
              <Link href="/explore">Explore problems</Link>
            </Button>
          </div>

          <p className="mt-6 inline-flex items-center gap-2 type-caption text-ink-subtle">
            <ShieldCheck className="size-4" aria-hidden="true" />
            Every resolution is verified before a problem is closed.
          </p>
        </div>

        <HeroVisual className="mx-auto w-full max-w-md lg:max-w-none" />
      </div>
    </section>
  );
}

const STEPS = [
  {
    icon: Camera,
    title: 'Report what you see',
    body: 'Take a photo, add a line about the problem, and tag the location. That is the whole form.',
  },
  {
    icon: Sparkles,
    title: 'Samadhaan AI reads it',
    body: 'The photo and description are categorised, severity is estimated, and duplicate reports are matched — so ten reports of one pothole become one problem with ten voices.',
  },
  {
    icon: Users,
    title: 'The community weighs in',
    body: 'Neighbours add support, context and suggestions. That signal is what moves a problem up the queue.',
  },
  {
    icon: Building2,
    title: 'Organisations take it on',
    body: 'NGOs, universities and companies find problems matching what they do. Government reviews and allocates the work.',
  },
  {
    icon: MessageSquare,
    title: 'Progress stays visible',
    body: 'A resolution room tracks the work. Everyone following the problem sees each update as it happens.',
  },
  {
    icon: CheckCircle2,
    title: 'Resolution is verified',
    body: 'Completion evidence is checked against the original report before the problem closes. Contributors earn impact points.',
  },
] as const;

export function HowItWorks() {
  return (
    <section
      id="how-it-works"
      className="border-b border-border py-16 sm:py-20 lg:py-24"
      aria-labelledby="how-it-works-heading"
    >
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="max-w-2xl">
          <p className="type-overline text-primary">How it works</p>
          <h2 id="how-it-works-heading" className="mt-2 type-h1 text-ink">
            From a photo to a fix
          </h2>
          <p className="mt-3.5 type-body-lg text-ink-muted">
            Six steps, and a citizen only has to do the first one.
          </p>
        </div>

        <ol className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {STEPS.map((step, index) => {
            const Icon = step.icon;
            return (
              <li key={step.title}>
                <Card className="h-full p-5">
                  <div className="flex items-center gap-3">
                    <span
                      aria-hidden="true"
                      className="grid size-9 shrink-0 place-items-center rounded-control bg-primary-soft text-primary"
                    >
                      <Icon className="size-4.5" />
                    </span>
                    <span className="tabular type-caption font-medium text-ink-subtle">
                      Step {index + 1}
                    </span>
                  </div>

                  <h3 className="mt-3.5 type-h4 text-ink">{step.title}</h3>
                  <p className="mt-1.5 type-body-sm text-ink-muted">{step.body}</p>
                </Card>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}

const FEATURES = [
  {
    icon: Sparkles,
    title: 'AI that does the paperwork',
    body: 'Categorisation, severity and duplicate detection happen automatically — so reporting stays a photo and a sentence, and the queue stays clean.',
  },
  {
    icon: MapPin,
    title: 'Everything is a place',
    body: 'Problems are mapped, clustered and searchable by area, so patterns show up: the junction that floods every monsoon, the stretch with no lighting.',
  },
  {
    icon: Users,
    title: 'Built for collaboration',
    body: 'Citizens, NGOs, universities, industry and government work on the same record — not in five disconnected inboxes.',
  },
  {
    icon: ShieldCheck,
    title: 'Closed only when proven',
    body: 'Completion evidence is checked against the original report. A problem is resolved when it is actually fixed.',
  },
] as const;

export function Features() {
  return (
    <section
      id="features"
      className="border-b border-border bg-subtle/45 py-16 sm:py-20 lg:py-24"
      aria-labelledby="features-heading"
    >
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="max-w-2xl">
          <p className="type-overline text-primary">What makes it work</p>
          <h2 id="features-heading" className="mt-2 type-h1 text-ink">
            Not another complaints inbox
          </h2>
        </div>

        <div className="mt-12 grid gap-5 sm:grid-cols-2">
          {FEATURES.map((feature) => {
            const Icon = feature.icon;
            return (
              <Card key={feature.title} className="p-6">
                <span
                  aria-hidden="true"
                  className="grid size-10 place-items-center rounded-control bg-surface text-primary ring-1 ring-border"
                >
                  <Icon className="size-5" />
                </span>
                <h3 className="mt-4 type-h3 text-ink">{feature.title}</h3>
                <p className="mt-2 type-body text-ink-muted">{feature.body}</p>
              </Card>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/** City-wide figures. Values come from the caller, not fetched here. */
export function PlatformStats({ stats }: { stats: ImpactStat[] }) {
  return (
    <section
      className="border-b border-border py-12 sm:py-14"
      aria-label="Platform activity"
    >
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-8 lg:grid-cols-4">
          {stats.map((stat) => (
            <div key={stat.id}>
              <dt className="type-caption text-ink-muted">{stat.label}</dt>
              <dd className="mt-1.5 tabular type-h1 text-ink">
                {formatCompactNumber(stat.value)}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

export function CallToAction() {
  return (
    <section className="py-16 sm:py-20 lg:py-24" aria-labelledby="cta-heading">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="rounded-container border border-border bg-surface px-6 py-12 text-center shadow-card sm:px-12 sm:py-16">
          <h2 id="cta-heading" className="mx-auto max-w-xl type-h1 text-ink">
            Something near you needs fixing.
          </h2>
          <p className="mx-auto mt-3.5 max-w-lg type-body-lg text-ink-muted">
            It takes a photo and a sentence. Samadhaan handles the rest.
          </p>

          <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
            <Button variant="primary" size="lg" asChild>
              <Link href="/report">Report a problem</Link>
            </Button>
            <Button variant="secondary" size="lg" asChild>
              <Link href="/explore">See what others reported</Link>
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
