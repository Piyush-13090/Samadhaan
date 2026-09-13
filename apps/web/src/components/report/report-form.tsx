'use client';

import { ArrowLeft, ArrowRight, Send } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  REPORT_LIMITS,
  SUBCATEGORY_SUGGESTIONS,
  type ProblemCategory,
  type ProblemView,
  type ReportLocationInput,
} from '@samadhaan/shared';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ApiError } from '@/lib/api-error';
import { createProblem } from '@/services/problems.service';
import { CategorySelector } from './category-selector';
import { ImageUploader, type ReportImage } from './image-uploader';
import { LocationSelector } from './location-selector';
import { ReportProgress, type ReportStepIndex } from './report-progress';
import { ReportReview } from './report-review';
import { ReportSuccess } from './report-success';

interface FormState {
  title: string;
  description: string;
  category: ProblemCategory | null;
  subcategory: string;
  images: ReportImage[];
  location: Partial<ReportLocationInput>;
}

const EMPTY: FormState = {
  title: '',
  description: '',
  category: null,
  subcategory: '',
  images: [],
  location: {},
};

/**
 * The reporting flow.
 *
 * State lives in this one component and steps are rendered from it, so moving
 * between steps preserves everything without a draft store — the simplest thing
 * that satisfies the requirement. A server-side draft system would be a lot of
 * machinery for a form most people finish in two minutes.
 *
 * Client validation is for immediate feedback only. The API re-validates
 * everything and is the authority; the rules here mirror `REPORT_LIMITS` so the
 * two cannot drift.
 */
export function ReportForm() {
  const [step, setStep] = useState<ReportStepIndex>(0);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [created, setCreated] = useState<ProblemView | null>(null);

  const set = useCallback(<K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  }, []);

  const uploading = form.images.some((image) => image.status === 'uploading');

  const dirty =
    form.title.length > 0 ||
    form.description.length > 0 ||
    form.category !== null ||
    form.images.length > 0;

  /**
   * Warns before a refresh or tab close would discard the report.
   *
   * Only while there is something to lose, and never after submission — a
   * confirmation dialog on the success screen would be nonsense.
   */
  useEffect(() => {
    if (!dirty || created) return;

    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Browsers ignore custom text now, but a non-empty return is still what
      // triggers the native prompt in some engines.
      event.returnValue = '';
    };

    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty, created]);

  function validateDetails(): boolean {
    const next: Record<string, string> = {};

    const title = form.title.trim();
    if (title.length < REPORT_LIMITS.titleMin) {
      next.title = `Give the problem a title of at least ${REPORT_LIMITS.titleMin} characters.`;
    } else if (title.length > REPORT_LIMITS.titleMax) {
      next.title = `Keep the title under ${REPORT_LIMITS.titleMax} characters.`;
    }

    const description = form.description.trim();
    if (description.length < REPORT_LIMITS.descriptionMin) {
      next.description = `Describe the problem in at least ${REPORT_LIMITS.descriptionMin} characters.`;
    }

    if (!form.category) next.category = 'Choose a category.';

    if (form.images.some((image) => image.status === 'failed')) {
      next.images = 'Remove or retry the photos that failed to upload.';
    }

    setErrors(next);
    return Object.keys(next).length === 0;
  }

  function validateLocation(): boolean {
    const next: Record<string, string> = {};
    const { latitude, longitude } = form.location;

    if (typeof latitude !== 'number') {
      next.latitude = 'A location is required.';
    } else if (latitude < -90 || latitude > 90) {
      next.latitude = 'Latitude must be between -90 and 90.';
    }

    if (typeof longitude !== 'number') {
      next.longitude = 'A location is required.';
    } else if (longitude < -180 || longitude > 180) {
      next.longitude = 'Longitude must be between -180 and 180.';
    }

    setErrors(next);
    return Object.keys(next).length === 0;
  }

  function goNext() {
    if (step === 0 && !validateDetails()) return;
    if (step === 1 && !validateLocation()) return;

    setErrors({});
    setStep((current) => (current + 1) as ReportStepIndex);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function goBack() {
    setErrors({});
    setStep((current) => (current - 1) as ReportStepIndex);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function handleSubmit() {
    // Guard against a double-click landing two requests before the first
    // disables the button. Two identical reports is the failure mode that
    // matters most here — the queue would carry a phantom problem.
    if (submitting) return;

    if (!validateDetails() || !validateLocation() || !form.category) {
      setStep(0);
      return;
    }

    setSubmitting(true);
    setSubmitError(null);

    try {
      const problem = await createProblem({
        title: form.title.trim(),
        description: form.description.trim(),
        category: form.category,
        subcategory: form.subcategory.trim() || null,
        location: {
          latitude: form.location.latitude as number,
          longitude: form.location.longitude as number,
          address: form.location.address?.trim() || null,
          city: form.location.city?.trim() || null,
          state: form.location.state?.trim() || null,
          country: form.location.country?.trim() || null,
          postalCode: form.location.postalCode?.trim() || null,
          accuracyMeters: form.location.accuracyMeters ?? null,
        },
        images: form.images
          .filter((image) => image.status === 'uploaded' && image.uploaded)
          .map((image, index) => ({
            storageKey: image.uploaded!.storageKey,
            sortOrder: index,
            isPrimary: image.isPrimary,
          })),
      });

      setCreated(problem);
    } catch (error) {
      setSubmitError(
        error instanceof ApiError
          ? error.message
          : 'Your report could not be submitted. Please try again.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  const suggestions = useMemo(
    () => (form.category ? (SUBCATEGORY_SUGGESTIONS[form.category] ?? []) : []),
    [form.category],
  );

  if (created) return <ReportSuccess problem={created} />;

  return (
    <div>
      <ReportProgress current={step} className="mb-8" />

      {submitError && (
        <Alert tone="danger" title="Could not submit your report" className="mb-5">
          {submitError}
        </Alert>
      )}

      {step === 0 && (
        <Card>
          <CardBody className="space-y-6">
            <Field
              label="What is the problem?"
              required
              error={errors.title}
              hint="A short, specific title. For example: “Open manhole outside the clinic”."
            >
              <Input
                value={form.title}
                onChange={(event) => set('title', event.target.value)}
                maxLength={REPORT_LIMITS.titleMax}
                autoFocus
              />
            </Field>

            <Field
              label="Describe it"
              required
              error={errors.description}
              hint="What is happening, and how does it affect the area?"
            >
              <Textarea
                value={form.description}
                onChange={(event) => set('description', event.target.value)}
                maxLength={REPORT_LIMITS.descriptionMax}
                showCount
                rows={5}
              />
            </Field>

            <CategorySelector
              value={form.category}
              onChange={(category) => set('category', category)}
              error={errors.category}
            />

            {form.category && (
              <Field
                label="More specifically"
                hint={
                  suggestions.length > 0
                    ? `For example: ${suggestions.slice(0, 3).join(', ')}`
                    : 'Optional'
                }
              >
                <Input
                  value={form.subcategory}
                  onChange={(event) => set('subcategory', event.target.value)}
                  maxLength={REPORT_LIMITS.subcategoryMax}
                  list="subcategory-suggestions"
                />
                <datalist id="subcategory-suggestions">
                  {suggestions.map((suggestion) => (
                    <option key={suggestion} value={suggestion} />
                  ))}
                </datalist>
              </Field>
            )}

            <ImageUploader
              images={form.images}
              onChange={(images) => set('images', images)}
            />

            {errors.images && (
              <p role="alert" className="type-caption text-danger">
                {errors.images}
              </p>
            )}
          </CardBody>
        </Card>
      )}

      {step === 1 && (
        <Card>
          <CardBody>
            <LocationSelector
              value={form.location}
              onChange={(location) => set('location', location)}
              errors={errors}
            />
          </CardBody>
        </Card>
      )}

      {step === 2 && (
        <>
          <p className="mb-5 type-body text-ink-muted">
            Check your report before submitting.
          </p>
          <ReportReview
            title={form.title}
            description={form.description}
            category={form.category}
            subcategory={form.subcategory}
            images={form.images}
            location={form.location}
            onEditDetails={() => setStep(0)}
            onEditLocation={() => setStep(1)}
          />
        </>
      )}

      {/* Sticky on mobile so the primary action stays reachable in a long form;
          inline on desktop, where the whole step is visible at once. */}
      <div className="sticky bottom-[calc(var(--spacing-mobilenav)+env(safe-area-inset-bottom))] z-10 mt-6 flex flex-col-reverse gap-3 border-t border-border bg-canvas/95 py-4 backdrop-blur-sm sm:static sm:flex-row sm:justify-between sm:border-0 sm:bg-transparent sm:backdrop-blur-none lg:bottom-0">
        {step > 0 ? (
          <Button
            type="button"
            variant="ghost"
            leadingIcon={<ArrowLeft />}
            onClick={goBack}
            disabled={submitting}
          >
            Back
          </Button>
        ) : (
          <span className="hidden sm:block" />
        )}

        {step < 2 ? (
          <Button
            type="button"
            variant="primary"
            size="lg"
            trailingIcon={<ArrowRight />}
            onClick={goNext}
            disabled={uploading}
          >
            {uploading ? 'Waiting for photos…' : 'Continue'}
          </Button>
        ) : (
          <Button
            type="button"
            variant="primary"
            size="lg"
            leadingIcon={<Send />}
            loading={submitting}
            disabled={submitting || uploading}
            onClick={() => void handleSubmit()}
          >
            {submitting ? 'Submitting…' : 'Submit report'}
          </Button>
        )}
      </div>
    </div>
  );
}
