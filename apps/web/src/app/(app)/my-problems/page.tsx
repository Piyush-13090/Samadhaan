import { cookies } from 'next/headers';
import Link from 'next/link';
import { Plus } from 'lucide-react';
import type { Metadata } from 'next';
import { PageContainer, PageHeading } from '@/components/layout/page-container';
import { MyProblemsList } from '@/components/problems/my-problems-list';
import { Button } from '@/components/ui/button';
import { requireUser } from '@/lib/auth-server';
import { fetchMyProblemsOnServer } from '@/services/discovery.service';

export const metadata: Metadata = { title: 'My reports' };

/**
 * The citizen's own reports.
 *
 * The first page is server-rendered so the list is present on first paint;
 * filtering and paging then happen on the client. Every page comes from
 * `/problems/my`, which scopes to the verified principal.
 */
export default async function MyProblemsPage() {
  await requireUser();

  const cookieStore = await cookies();
  const header = cookieStore
    .getAll()
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join('; ');

  const initial = await fetchMyProblemsOnServer({ limit: 20 }, header);

  return (
    <PageContainer width="wide">
      <PageHeading
        title="My reports"
        description={
          initial?.totalCount
            ? `${initial.totalCount} ${initial.totalCount === 1 ? 'problem' : 'problems'} you have reported, and where each has got to.`
            : 'Everything you have reported, and where it has got to.'
        }
        action={
          <Button variant="primary" leadingIcon={<Plus />} asChild>
            <Link href="/report">Report a problem</Link>
          </Button>
        }
      />

      <MyProblemsList initial={initial} className="mt-8" />
    </PageContainer>
  );
}
