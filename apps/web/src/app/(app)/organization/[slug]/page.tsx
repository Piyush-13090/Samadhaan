import { redirect } from 'next/navigation';
import { workspacePath } from '@/lib/workspace';

/** `/organization/:slug` opens the dashboard. */
export default async function WorkspaceIndex({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  redirect(workspacePath(slug, 'dashboard'));
}
