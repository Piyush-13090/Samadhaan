'use client';

import { Plus, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import {
  EXPERTISE_LEVELS,
  ORGANIZATION_LIMITS,
  PROBLEM_CATEGORIES,
  type ExpertiseLevel,
  type OrganizationExpertiseEntry,
  type ProblemCategory,
} from '@samadhaan/shared';
import { ExpertiseList } from '@/components/profile/expertise-list';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { ApiError } from '@/lib/api-error';
import { CATEGORY_DISPLAY } from '@/lib/domain-display';
import { EXPERTISE_DISPLAY } from '@/lib/profile-display';
import { addExpertise, removeExpertise } from '@/services/profile.service';

/**
 * Areas of expertise, from the same taxonomy problems use.
 *
 * There is no free-text category: a category is picked from the problem
 * taxonomy, so "Waste Management" and "garbage" cannot become two different
 * things. The optional subcategory is free text, but it only refines — and
 * only ever matches a problem's subcategory exactly.
 *
 * Read-only for members, who see the plain list.
 */
export function ExpertiseManager({
  organizationId,
  expertise,
  canManage,
}: {
  organizationId: string;
  expertise: OrganizationExpertiseEntry[];
  canManage: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [category, setCategory] = useState<ProblemCategory | ''>('');
  const [level, setLevel] = useState<ExpertiseLevel>('EXPERIENCED');
  const [subcategory, setSubcategory] = useState('');
  const [pending, setPending] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  if (!canManage) return <ExpertiseList expertise={expertise} />;

  const declared = new Set(expertise.map((entry) => entry.category));

  function fail(title: string, error: unknown) {
    toast({
      tone: 'danger',
      title,
      description:
        error instanceof ApiError
          ? error.message
          : 'Check your connection and try again.',
    });
  }

  async function onAdd(event: FormEvent) {
    event.preventDefault();
    if (!category) return;
    setPending(true);
    try {
      await addExpertise(organizationId, {
        category,
        level,
        subcategory: subcategory.trim() || null,
      });
      toast({
        tone: 'success',
        title: declared.has(category)
          ? `${CATEGORY_DISPLAY[category].label} updated`
          : `${CATEGORY_DISPLAY[category].label} added`,
      });
      setCategory('');
      setSubcategory('');
      setLevel('EXPERIENCED');
      router.refresh();
    } catch (error) {
      fail("Couldn't save that area", error);
    } finally {
      setPending(false);
    }
  }

  async function onRemove(entry: OrganizationExpertiseEntry) {
    setRemovingId(entry.id);
    try {
      await removeExpertise(organizationId, entry.id);
      toast({
        tone: 'success',
        title: `${CATEGORY_DISPLAY[entry.category].label} removed`,
      });
      router.refresh();
    } catch (error) {
      fail("Couldn't remove that area", error);
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <Card>
      <CardHeader
        title="Areas of expertise"
        description="Opportunities are the open problems in these categories, inside your service area."
      />
      <CardBody className="space-y-5">
        {expertise.length === 0 ? (
          <p className="type-body-sm text-ink-muted">
            No areas listed yet. Add the kinds of problems your organisation works on.
          </p>
        ) : (
          <ul className="space-y-2">
            {expertise.map((entry) => (
              <li
                key={entry.id}
                className="flex items-center justify-between gap-3 rounded-control border border-border-subtle px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="type-body-sm font-medium text-ink">
                    {CATEGORY_DISPLAY[entry.category].label}
                  </p>
                  <p className="truncate type-caption text-ink-subtle">
                    {EXPERTISE_DISPLAY[entry.level].label}
                    {entry.subcategory && ` · ${entry.subcategory}`}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  iconOnly
                  loading={removingId === entry.id}
                  aria-label={`Remove ${CATEGORY_DISPLAY[entry.category].label}`}
                  onClick={() => void onRemove(entry)}
                >
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
        )}

        <form
          onSubmit={(event) => void onAdd(event)}
          aria-label="Add an area of expertise"
          className="grid gap-3 border-t border-border pt-4 sm:grid-cols-2 lg:grid-cols-4 lg:items-end"
        >
          <Field label="Category">
            <Select
              value={category}
              onValueChange={(value) => setCategory(value as ProblemCategory)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Choose a category" />
              </SelectTrigger>
              <SelectContent>
                {PROBLEM_CATEGORIES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {CATEGORY_DISPLAY[value].label}
                    {declared.has(value) ? ' (listed)' : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Level">
            <Select
              value={level}
              onValueChange={(value) => setLevel(value as ExpertiseLevel)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[...EXPERTISE_LEVELS].reverse().map((value) => (
                  <SelectItem key={value} value={value}>
                    {EXPERTISE_DISPLAY[value].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Specialism (optional)">
            <Input
              value={subcategory}
              maxLength={ORGANIZATION_LIMITS.subcategoryMax}
              placeholder="e.g. Stormwater drainage"
              onChange={(event) => setSubcategory(event.target.value)}
            />
          </Field>
          <Button
            type="submit"
            variant="secondary"
            size="md"
            leadingIcon={<Plus />}
            loading={pending}
            disabled={!category}
          >
            {category && declared.has(category) ? 'Update area' : 'Add area'}
          </Button>
        </form>
      </CardBody>
    </Card>
  );
}
