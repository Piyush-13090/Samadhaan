import type { Metadata } from 'next';
import { LeaderboardBoard } from '@/components/impact/leaderboard-board';
import { PageContainer, PageHeading } from '@/components/layout/page-container';

export const metadata: Metadata = { title: 'Leaderboard' };

/** The public impact leaderboard — real, server-ranked contributions. */
export default function LeaderboardPage() {
  return (
    <PageContainer>
      <PageHeading
        title="Leaderboard"
        description="Impact points are earned when reports are verified and problems people helped with are resolved."
      />
      <div className="mt-8">
        <LeaderboardBoard />
      </div>
    </PageContainer>
  );
}
