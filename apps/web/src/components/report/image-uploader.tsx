'use client';

import { AlertTriangle, Camera, Star, Upload, X } from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import {
  ACCEPTED_IMAGE_TYPES,
  REPORT_LIMITS,
  type UploadedImage,
} from '@samadhaan/shared';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/cn';
import { ApiError } from '@/lib/api-error';
import { uploadProblemImage } from '@/services/problems.service';

/**
 * One image in the uploader, at whatever stage it has reached.
 *
 * `previewUrl` is an object URL created from the local `File`, so the preview
 * appears instantly and the same bytes are never fetched back from the server
 * after upload — a needless round trip on the connection least able to afford
 * it.
 */
export interface ReportImage {
  /** Stable client id; the storage key does not exist until the upload lands. */
  id: string;
  previewUrl: string;
  status: 'uploading' | 'uploaded' | 'failed';
  progress: number;
  /** Present once the upload succeeds. This is what submission references. */
  uploaded?: UploadedImage;
  error?: string;
  isPrimary: boolean;
  fileName: string;
}

/**
 * Attaches photos to a report.
 *
 * Uploads happen immediately on selection rather than at submit, so a citizen
 * sees progress while they write the description, and a failed submit never
 * means re-sending six photos over a phone connection.
 */
export function ImageUploader({
  images,
  onChange,
  disabled = false,
}: {
  images: ReportImage[];
  onChange: (images: ReportImage[]) => void;
  disabled?: boolean;
}) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [rejected, setRejected] = useState<string | null>(null);

  // Keeps the callback stable while always seeing the current list, so an
  // upload finishing does not overwrite a change made while it was in flight.
  const imagesRef = useRef(images);
  useEffect(() => {
    imagesRef.current = images;
  }, [images]);

  const update = useCallback(
    (id: string, patch: Partial<ReportImage>) => {
      onChange(
        imagesRef.current.map((image) =>
          image.id === id ? { ...image, ...patch } : image,
        ),
      );
    },
    [onChange],
  );

  const addFiles = useCallback(
    (files: FileList | File[]) => {
      setRejected(null);

      const incoming = Array.from(files);
      const room = REPORT_LIMITS.maxImages - imagesRef.current.length;

      if (room <= 0) {
        setRejected(`You can attach up to ${REPORT_LIMITS.maxImages} photos.`);
        return;
      }

      const problems: string[] = [];
      const accepted: File[] = [];

      for (const file of incoming.slice(0, room)) {
        // A first pass only: the server re-checks by decoding the bytes, which
        // is the check that actually counts. This one just saves the user a
        // pointless upload.
        if (
          !ACCEPTED_IMAGE_TYPES.includes(
            file.type as (typeof ACCEPTED_IMAGE_TYPES)[number],
          )
        ) {
          problems.push(`${file.name} is not a JPEG, PNG or WebP image.`);
          continue;
        }

        if (file.size > REPORT_LIMITS.maxImageBytes) {
          const limitMb = Math.round(REPORT_LIMITS.maxImageBytes / (1024 * 1024));
          problems.push(`${file.name} is larger than ${limitMb} MB.`);
          continue;
        }

        accepted.push(file);
      }

      if (incoming.length > room) {
        problems.push(`Only ${room} more photo${room === 1 ? '' : 's'} can be added.`);
      }

      if (problems.length > 0) setRejected(problems.join(' '));
      if (accepted.length === 0) return;

      const queued: ReportImage[] = accepted.map((file, index) => ({
        id: `img-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}`,
        previewUrl: URL.createObjectURL(file),
        status: 'uploading',
        progress: 0,
        // The first photo attached becomes the primary one by default.
        isPrimary: imagesRef.current.length === 0 && index === 0,
        fileName: file.name,
      }));

      onChange([...imagesRef.current, ...queued]);

      queued.forEach((entry, index) => {
        const file = accepted[index]!;

        void uploadProblemImage(file, {
          onProgress: (progress) => update(entry.id, { progress }),
        })
          .then((uploaded) =>
            update(entry.id, { status: 'uploaded', uploaded, progress: 100 }),
          )
          .catch((error: unknown) =>
            update(entry.id, {
              status: 'failed',
              error:
                error instanceof ApiError
                  ? error.message
                  : 'Upload failed. Please try again.',
            }),
          );
      });
    },
    [onChange, update],
  );

  const remove = useCallback(
    (id: string) => {
      const target = imagesRef.current.find((image) => image.id === id);
      // Object URLs are retained until revoked; not doing so leaks the whole
      // image for the lifetime of the page.
      if (target) URL.revokeObjectURL(target.previewUrl);

      const remaining = imagesRef.current.filter((image) => image.id !== id);

      // Removing the primary promotes the next one, so a report never ends up
      // with photos but no primary.
      if (target?.isPrimary && remaining.length > 0) {
        remaining[0] = { ...remaining[0]!, isPrimary: true };
      }

      onChange(remaining);
    },
    [onChange],
  );

  const setPrimary = useCallback(
    (id: string) => {
      onChange(
        imagesRef.current.map((image) => ({ ...image, isPrimary: image.id === id })),
      );
    },
    [onChange],
  );

  // Release every object URL when the uploader unmounts.
  useEffect(() => {
    return () => {
      for (const image of imagesRef.current) URL.revokeObjectURL(image.previewUrl);
    };
  }, []);

  const atLimit = images.length >= REPORT_LIMITS.maxImages;

  return (
    <div>
      <p className="type-label text-ink">Photos</p>
      <p className="mt-1 type-caption text-ink-subtle">
        Add a clear photo of the problem. Photos help Samadhaan understand what needs
        attention. Up to {REPORT_LIMITS.maxImages}, optional.
      </p>

      {/* Drop zone. The label is the target, so a click opens the picker and
          the control stays keyboard-reachable through the input itself. */}
      <label
        htmlFor={inputId}
        onDragOver={(event) => {
          event.preventDefault();
          if (!disabled && !atLimit) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          if (!disabled && !atLimit && event.dataTransfer.files.length > 0) {
            addFiles(event.dataTransfer.files);
          }
        }}
        className={cn(
          'mt-3 flex cursor-pointer flex-col items-center justify-center rounded-card border border-dashed px-6 py-8 text-center transition-colors',
          'has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-primary',
          dragging
            ? 'border-primary bg-primary-soft'
            : 'border-border-strong bg-subtle/50',
          (disabled || atLimit) && 'pointer-events-none opacity-60',
        )}
      >
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          // `capture` is deliberately omitted: on mobile it forces the camera
          // and removes the gallery option, which blocks a citizen who
          // photographed the problem earlier.
          accept={ACCEPTED_IMAGE_TYPES.join(',')}
          multiple
          disabled={disabled || atLimit}
          className="sr-only"
          onChange={(event) => {
            if (event.target.files) addFiles(event.target.files);
            // Reset so re-selecting the same file fires `change` again.
            event.target.value = '';
          }}
        />

        <span
          aria-hidden="true"
          className="grid size-11 place-items-center rounded-full bg-surface text-ink-subtle ring-1 ring-border"
        >
          <Camera className="size-5" />
        </span>

        <span className="mt-3 type-body-sm font-medium text-ink">
          {atLimit ? 'Photo limit reached' : 'Add photos'}
        </span>
        <span className="mt-1 type-caption text-ink-subtle">
          Tap to choose, or drag images here. JPEG, PNG or WebP.
        </span>
      </label>

      {rejected && (
        <p
          role="alert"
          className="mt-2 flex items-start gap-1.5 type-caption text-danger"
        >
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          {rejected}
        </p>
      )}

      {images.length > 0 && (
        <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {images.map((image) => (
            <li
              key={image.id}
              className="group relative overflow-hidden rounded-card border border-border bg-surface"
            >
              <div className="relative aspect-4/3 bg-subtle">
                {/* eslint-disable-next-line @next/next/no-img-element --
                    a local object URL cannot be optimised by next/image. */}
                <img
                  src={image.previewUrl}
                  alt={`Attached photo: ${image.fileName}`}
                  className="size-full object-cover"
                />

                {image.status === 'uploading' && (
                  <div className="absolute inset-0 grid place-items-center bg-ink/40">
                    <Spinner className="size-5 text-ink-inverse" label={null} />
                  </div>
                )}

                {image.status === 'failed' && (
                  <div className="absolute inset-0 grid place-items-center bg-danger/70 px-2 text-center">
                    <span className="type-caption text-ink-inverse">{image.error}</span>
                  </div>
                )}

                {image.isPrimary && image.status === 'uploaded' && (
                  <span className="absolute top-1.5 left-1.5 inline-flex items-center gap-1 rounded-[5px] bg-ink/75 px-1.5 py-0.5 type-overline text-ink-inverse">
                    <Star className="size-2.5 fill-current" aria-hidden="true" />
                    Main
                  </span>
                )}

                <button
                  type="button"
                  onClick={() => remove(image.id)}
                  aria-label={`Remove ${image.fileName}`}
                  className="absolute top-1.5 right-1.5 grid size-6 place-items-center rounded-full bg-ink/75 text-ink-inverse transition-opacity hover:bg-ink"
                >
                  <X className="size-3.5" />
                </button>
              </div>

              {image.status === 'uploading' && (
                <div className="h-0.5 bg-subtle" aria-hidden="true">
                  <div
                    className="h-full bg-primary transition-[width] duration-base"
                    style={{ width: `${image.progress}%` }}
                  />
                </div>
              )}

              {image.status === 'uploaded' && !image.isPrimary && (
                <button
                  type="button"
                  onClick={() => setPrimary(image.id)}
                  className="w-full px-2 py-1.5 type-caption text-ink-muted transition-colors hover:bg-subtle hover:text-ink"
                >
                  Make main photo
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {images.some((image) => image.status === 'uploading') && (
        <p className="mt-2 type-caption text-ink-subtle" aria-live="polite">
          Uploading photos…
        </p>
      )}

      {atLimit && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="mt-2"
          leadingIcon={<Upload />}
          disabled
        >
          Maximum photos attached
        </Button>
      )}
    </div>
  );
}
