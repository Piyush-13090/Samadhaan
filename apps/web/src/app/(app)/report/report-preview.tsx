'use client';

import { Camera, MapPin } from 'lucide-react';
import { useState } from 'react';
import { AI_STAGES, AiProcessingState } from '@/components/ai/ai-processing-state';
import { AiInsightCard } from '@/components/ai/ai-insight-card';
import { MapPlaceholder } from '@/components/problems/map-placeholder';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import { FEATURED_PROBLEM } from '@/data/problems';

/**
 * Static preview of the reporting flow.
 *
 * The "Analyse" button walks the AI stage indicator forward on a timer so the
 * motion and copy can be reviewed. It calls nothing and analyses nothing — the
 * insight shown afterwards is the fixture analysis, clearly sourced from
 * `@/data`, not a fabricated per-input result.
 */
export function ReportPreview() {
  const [stage, setStage] = useState<number | null>(null);
  const { toast } = useToast();

  function runPreview() {
    setStage(0);

    // Steps the indicator through each stage, then settles on complete.
    AI_STAGES.forEach((_, index) => {
      setTimeout(() => setStage(index + 1), (index + 1) * 700);
    });

    setTimeout(
      () =>
        toast({
          tone: 'ai',
          title: 'Analysis complete',
          description: 'Samadhaan AI categorised this report and estimated severity.',
        }),
      AI_STAGES.length * 700 + 200,
    );
  }

  return (
    <div className="mt-8 space-y-5">
      <Alert tone="info" title="Design preview">
        Reporting is implemented in a later milestone. This page previews the interface
        and the AI analysis states.
      </Alert>

      <Card>
        <CardHeader title="What did you see?" />
        <CardBody className="space-y-5">
          <div>
            <p className="type-label text-ink">Photo</p>
            <div className="mt-1.5 flex flex-col items-center justify-center rounded-card border border-dashed border-border-strong bg-subtle/50 px-6 py-10 text-center">
              <span
                aria-hidden="true"
                className="grid size-11 place-items-center rounded-full bg-surface text-ink-subtle ring-1 ring-border"
              >
                <Camera className="size-5" />
              </span>
              <p className="mt-3 type-body-sm font-medium text-ink">Add a photo</p>
              <p className="mt-1 type-caption text-ink-subtle">
                A clear shot of the problem helps the AI assess it accurately.
              </p>
              <Button variant="secondary" size="sm" className="mt-4" disabled>
                Choose photo
              </Button>
            </div>
          </div>

          <Field
            label="Description"
            required
            hint="One or two sentences. Plain language is fine."
          >
            <Textarea
              rows={3}
              maxLength={500}
              showCount
              placeholder="Water has been standing at the market entrance for three days…"
            />
          </Field>

          <Field label="Location" required hint="We use this to find nearby reports.">
            <Input
              leadingIcon={<MapPin />}
              placeholder="Sector 12 Market Road"
              defaultValue="Sector 12 Market Road, near Bus Stop 4"
            />
          </Field>

          <MapPlaceholder
            className="h-40 rounded-card border border-border"
            label="Sector 12"
          />
        </CardBody>
      </Card>

      {stage === null ? (
        <Button variant="primary" size="lg" fullWidth onClick={runPreview}>
          Preview AI analysis
        </Button>
      ) : (
        <>
          <AiProcessingState activeStage={stage} />
          {stage >= AI_STAGES.length && FEATURED_PROBLEM.ai && (
            <AiInsightCard analysis={FEATURED_PROBLEM.ai} />
          )}
        </>
      )}
    </div>
  );
}
