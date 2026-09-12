import {
  CallToAction,
  Features,
  Hero,
  HowItWorks,
  PlatformStats,
} from '@/components/marketing/landing-sections';
import { PLATFORM_STATS } from '@/data/activity';

/**
 * Landing page.
 *
 * Structure is established here; copy and sections are refined in later
 * milestones. Figures come from `@/data` fixtures and are passed down as props
 * — when a public stats endpoint exists, only this file changes.
 */
export default function LandingPage() {
  return (
    <>
      <Hero />
      <PlatformStats stats={PLATFORM_STATS} />
      <HowItWorks />
      <Features />
      <CallToAction />
    </>
  );
}
