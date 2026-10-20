import {
  CallToAction,
  Features,
  Hero,
  HowItWorks,
} from '@/components/marketing/landing-sections';

/**
 * Landing page.
 *
 * No platform figures are shown (Prompt 30): the earlier stats band displayed
 * fixture numbers as if they were real. `PlatformStats` can return once a
 * public statistics endpoint provides measured figures.
 */
export default function LandingPage() {
  return (
    <>
      <Hero />
      <HowItWorks />
      <Features />
      <CallToAction />
    </>
  );
}
