import type { Metadata } from 'next';
import { PageContainer, PageHeading } from '@/components/layout/page-container';
import { SettingsForm } from './settings-form';

export const metadata: Metadata = { title: 'Settings' };

/**
 * Settings.
 *
 * Renders the form components against the design system. Nothing is persisted —
 * profile updates land with the authentication milestone.
 */
export default function SettingsPage() {
  return (
    <PageContainer width="narrow">
      <PageHeading title="Settings" description="Your profile and how we reach you." />
      <SettingsForm />
    </PageContainer>
  );
}
