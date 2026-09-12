import type { Metadata } from 'next';
import { PageContainer, PageHeading } from '@/components/layout/page-container';
import { LeaderboardRow } from '@/components/common/leaderboard-row';
import { OrganizationCard } from '@/components/common/organization-card';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { LEADERBOARD } from '@/data/activity';
import { ORGANIZATIONS } from '@/data/organizations';
import { CURRENT_USER } from '@/data/people';

export const metadata: Metadata = { title: 'Leaderboard' };

export default function LeaderboardPage() {
  return (
    <PageContainer>
      <PageHeading
        title="Leaderboard"
        description="Impact points are earned when problems you contributed to are resolved."
      />

      <div className="mt-8 grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <Card>
          <CardHeader title="Top contributors" description="This month" />
          <CardBody className="p-1.5">
            {LEADERBOARD.map((entry) => (
              <LeaderboardRow
                key={entry.person.id}
                entry={entry}
                highlighted={entry.person.id === CURRENT_USER.id}
              />
            ))}
          </CardBody>
        </Card>

        <section aria-labelledby="orgs-heading" className="space-y-4">
          <h2 id="orgs-heading" className="type-h3 text-ink">
            Partner organisations
          </h2>
          {ORGANIZATIONS.slice(0, 2).map((organization) => (
            <OrganizationCard key={organization.id} organization={organization} />
          ))}
        </section>
      </div>
    </PageContainer>
  );
}
