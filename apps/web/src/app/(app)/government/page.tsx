import { Landmark } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { PageContainer, PageHeading } from '@/components/layout/page-container';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/states';
import { requireRole } from '@/lib/auth-server';
import { JURISDICTION_TYPE_LABEL, governmentPath } from '@/lib/government';
import { requestCookieHeader } from '@/lib/request-cookies';
import { fetchGovernmentOfficesOnServer } from '@/services/government.service';

export const metadata: Metadata = { title: 'Command centre' };

/**
 * Where a government official lands: straight into their office's portal, or
 * a choice when they serve more than one. Only the GOVERNMENT role — a
 * platform admin is not an official of any jurisdiction.
 */
export default async function GovernmentHome() {
  await requireRole(['GOVERNMENT'], '/government');
  const offices = await fetchGovernmentOfficesOnServer(await requestCookieHeader());
  const open = offices.filter((office) => office.isAccessible);

  if (open.length === 1 && open[0]) redirect(governmentPath(open[0].slug));

  return (
    <PageContainer>
      <PageHeading
        title="Command centre"
        description="Choose the government office you are working for."
      />
      <div className="mt-6">
        {offices.length === 0 ? (
          <Card>
            <EmptyState
              icon={Landmark}
              title="You're not part of a government office yet"
              description="Government offices are set up by Samadhaan. Once your account is added to one, its review queue and map appear here."
            />
          </Card>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {offices.map((office) => (
              <li key={office.slug}>
                <Card as="article" interactive className="relative p-4">
                  <h2 className="type-body font-semibold text-ink">
                    <Link
                      href={governmentPath(office.slug)}
                      className="outline-none before:absolute before:inset-0"
                    >
                      {office.name}
                    </Link>
                  </h2>
                  <p className="mt-1 type-caption text-ink-subtle">
                    {office.jurisdictionType
                      ? JURISDICTION_TYPE_LABEL[office.jurisdictionType]
                      : 'Government office'}
                    {office.jurisdictionName && ` · ${office.jurisdictionName}`}
                    {!office.isAccessible && ' · Suspended'}
                  </p>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </div>
    </PageContainer>
  );
}
