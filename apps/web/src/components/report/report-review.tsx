'use client';

import { ImageOff, MapPin, Pencil } from 'lucide-react';
import type { ProblemCategory, ReportLocationInput } from '@samadhaan/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { CATEGORY_DISPLAY } from '@/lib/domain-display';
import type { ReportImage } from './image-uploader';

/**
 * The last screen before submission.
 *
 * Every section has its own Edit control returning to the step that owns it —
 * a citizen who spots a wrong postcode should not have to walk back through the
 * whole form. Nothing here is rendered as markup; all of it is user input.
 */
export function ReportReview({
  title,
  description,
  category,
  subcategory,
  images,
  location,
  onEditDetails,
  onEditLocation,
}: {
  title: string;
  description: string;
  category: ProblemCategory | null;
  subcategory: string;
  images: ReportImage[];
  location: Partial<ReportLocationInput>;
  onEditDetails: () => void;
  onEditLocation: () => void;
}) {
  const uploaded = images.filter((image) => image.status === 'uploaded');

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader
          title="Problem"
          action={
            <Button
              type="button"
              variant="ghost"
              size="sm"
              leadingIcon={<Pencil />}
              onClick={onEditDetails}
            >
              Edit
            </Button>
          }
        />
        <CardBody className="space-y-4">
          <div>
            <dt className="type-caption text-ink-muted">Title</dt>
            <dd className="mt-0.5 type-body font-medium text-ink">{title}</dd>
          </div>

          <div>
            <dt className="type-caption text-ink-muted">Description</dt>
            <dd className="mt-0.5 type-body-sm whitespace-pre-line text-ink-muted">
              {description}
            </dd>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {category && <Badge tone="neutral">{CATEGORY_DISPLAY[category].label}</Badge>}
            {subcategory && (
              <span className="type-caption text-ink-subtle">{subcategory}</span>
            )}
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title={`Photos (${uploaded.length})`}
          action={
            <Button
              type="button"
              variant="ghost"
              size="sm"
              leadingIcon={<Pencil />}
              onClick={onEditDetails}
            >
              Edit
            </Button>
          }
        />
        <CardBody>
          {uploaded.length === 0 ? (
            <p className="inline-flex items-center gap-2 type-body-sm text-ink-subtle">
              <ImageOff className="size-4" aria-hidden="true" />
              No photos attached. Your report can still be submitted.
            </p>
          ) : (
            <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {uploaded.map((image) => (
                <li
                  key={image.id}
                  className="relative overflow-hidden rounded-control border border-border"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element --
                      object URL; next/image cannot optimise it. */}
                  <img
                    src={image.previewUrl}
                    alt={`Attached photo: ${image.fileName}`}
                    className="aspect-square w-full object-cover"
                  />
                  {image.isPrimary && (
                    <span className="absolute top-1 left-1 rounded-[4px] bg-ink/75 px-1 py-px type-overline text-ink-inverse">
                      Main
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Location"
          action={
            <Button
              type="button"
              variant="ghost"
              size="sm"
              leadingIcon={<Pencil />}
              onClick={onEditLocation}
            >
              Edit
            </Button>
          }
        />
        <CardBody className="space-y-2">
          {location.address && (
            <p className="inline-flex items-start gap-2 type-body-sm text-ink">
              <MapPin
                className="mt-0.5 size-4 shrink-0 text-ink-subtle"
                aria-hidden="true"
              />
              {location.address}
            </p>
          )}

          <p className="type-caption text-ink-muted">
            {[location.city, location.state, location.postalCode]
              .filter(Boolean)
              .join(', ') || 'No address details provided'}
          </p>

          <p className="font-mono type-caption tabular text-ink-subtle">
            {location.latitude?.toFixed(5)}, {location.longitude?.toFixed(5)}
          </p>
        </CardBody>
      </Card>
    </div>
  );
}
