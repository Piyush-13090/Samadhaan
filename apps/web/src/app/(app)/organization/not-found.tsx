import { Building2 } from 'lucide-react';
import Link from 'next/link';
import { PageContainer } from '@/components/layout/page-container';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/states';

/**
 * A workspace that does not exist, or that the viewer does not belong to.
 *
 * Deliberately the same page for both: telling a non-member that an
 * organisation exists but is closed to them would map who belongs where.
 */
export default function WorkspaceNotFound() {
  return (
    <PageContainer>
      <Card>
        <EmptyState
          icon={Building2}
          title="This workspace isn't available"
          description="It doesn't exist, or you aren't an active member of it. Workspaces open to members of the organisation only."
          action={
            <Button variant="primary" size="sm" asChild>
              <Link href="/organization">Your organisations</Link>
            </Button>
          }
        />
      </Card>
    </PageContainer>
  );
}
