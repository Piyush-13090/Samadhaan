import { Landmark } from 'lucide-react';
import Link from 'next/link';
import { PageContainer } from '@/components/layout/page-container';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/states';

/**
 * An office, or a problem, that is not yours to see. One message for "does
 * not exist" and "outside your jurisdiction", so neither can be probed.
 */
export default function GovernmentNotFound() {
  return (
    <PageContainer>
      <Card>
        <EmptyState
          icon={Landmark}
          title="Not available in your jurisdiction"
          description="It doesn't exist, or it is outside the area your office is responsible for."
          action={
            <Button variant="primary" size="sm" asChild>
              <Link href="/government">Command centre</Link>
            </Button>
          }
        />
      </Card>
    </PageContainer>
  );
}
