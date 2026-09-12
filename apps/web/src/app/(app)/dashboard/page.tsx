import type { Metadata } from 'next';
import { DashboardPreview } from '@/components/dashboard/dashboard-preview';
import { PageContainer } from '@/components/layout/page-container';
import { requireRole } from '@/lib/auth-server';
import { MY_IMPACT, NOTIFICATIONS } from '@/data/activity';
import { NEARBY_PROBLEMS } from '@/data/problems';

export const metadata: Metadata = { title: 'Home' };

/**
 * Citizen home.
 *
 * The user is real — resolved from the verified session — while impact,
 * problems and notifications are still fixtures, because those milestones have
 * not landed. `DashboardPreview` takes all of them as props, so replacing a
 * fixture with a service call is a one-line change here.
 */
export default async function DashboardPage() {
  const user = await requireRole(['CITIZEN', 'ADMIN'], '/dashboard');

  return (
    <PageContainer width="wide">
      <DashboardPreview
        user={{
          id: user.id,
          name: user.fullName,
          avatarUrl: user.avatarUrl ?? undefined,
        }}
        impact={MY_IMPACT}
        nearbyProblems={NEARBY_PROBLEMS}
        notifications={NOTIFICATIONS}
      />
    </PageContainer>
  );
}
