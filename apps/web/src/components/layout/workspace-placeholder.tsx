import type { LucideIcon } from 'lucide-react';
import type { AuthenticatedUser } from '@samadhaan/shared';
import { PageContainer, PageHeading } from '@/components/layout/page-container';
import { Alert } from '@/components/ui/alert';
import { Card, CardBody } from '@/components/ui/card';
import { ROLE_LABEL } from '@/lib/role-display';

/**
 * Placeholder for a role workspace whose features belong to a later milestone.
 *
 * It exists to prove the routing and authorisation actually work: reaching this
 * page means the session was verified, the role was checked, and the
 * role-specific navigation rendered. What it deliberately does not do is fake
 * the dashboard — listing the planned surfaces is honest, inventing metrics for
 * them is not.
 */
export function WorkspacePlaceholder({
  user,
  title,
  description,
  icon: Icon,
  upcoming,
}: {
  user: AuthenticatedUser;
  title: string;
  description: string;
  icon: LucideIcon;
  /** Areas planned for this workspace. */
  upcoming: Array<{ title: string; body: string }>;
}) {
  return (
    <PageContainer>
      <PageHeading
        eyebrow={ROLE_LABEL[user.role]}
        title={title}
        description={description}
      />

      <Alert tone="info" title="Signed in and authorised" className="mt-8">
        You are signed in as <strong>{user.email}</strong> with the{' '}
        <strong>{ROLE_LABEL[user.role]}</strong> role. This area is restricted to that
        role — the API rejects requests from any other.
      </Alert>

      <section className="mt-8" aria-labelledby="upcoming-heading">
        <h2 id="upcoming-heading" className="type-h3 text-ink">
          Coming to this workspace
        </h2>

        <ul className="mt-4 grid gap-4 sm:grid-cols-2">
          {upcoming.map((item) => (
            <li key={item.title}>
              <Card className="h-full">
                <CardBody>
                  <span
                    aria-hidden="true"
                    className="grid size-9 place-items-center rounded-control bg-primary-soft text-primary"
                  >
                    <Icon className="size-4.5" />
                  </span>
                  <h3 className="mt-3.5 type-h4 text-ink">{item.title}</h3>
                  <p className="mt-1.5 type-body-sm text-ink-muted">{item.body}</p>
                </CardBody>
              </Card>
            </li>
          ))}
        </ul>
      </section>
    </PageContainer>
  );
}
