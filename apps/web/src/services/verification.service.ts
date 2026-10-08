import type {
  EvidenceFileRole,
  EvidenceType,
  EvidenceView,
  GovernmentVerificationView,
  ProjectVerificationView,
} from '@samadhaan/shared';
import { api } from '@/lib/api';
import { ApiError } from '@/lib/api-error';

/**
 * Resolution verification calls (Prompt 22). The API decides every
 * permission; nothing here does.
 */
const project = (id: string) => `/resolution-projects/${encodeURIComponent(id)}`;
const evidence = (id: string) => `/evidence/${encodeURIComponent(id)}`;
const government = (slug: string, publicId: string) =>
  `/government/${encodeURIComponent(slug)}/problems/${encodeURIComponent(publicId)}/verification`;

export function fetchProjectVerification(
  projectId: string,
): Promise<ProjectVerificationView> {
  return api.get<ProjectVerificationView>(`${project(projectId)}/verification`, {
    cache: 'no-store',
  });
}

export function createEvidence(
  projectId: string,
  input: {
    evidenceType: EvidenceType;
    title: string;
    description?: string | null;
    replacesEvidenceId?: string;
  },
): Promise<EvidenceView> {
  return api.post<EvidenceView>(`${project(projectId)}/evidence`, input);
}

export function submitEvidence(id: string): Promise<EvidenceView> {
  return api.post<EvidenceView>(`${evidence(id)}/submit`);
}

export function withdrawEvidence(id: string): Promise<EvidenceView> {
  return api.post<EvidenceView>(`${evidence(id)}/withdraw`);
}

export function analyzeEvidence(id: string): Promise<EvidenceView> {
  return api.post<EvidenceView>(`${evidence(id)}/analyze`);
}

export function removeEvidenceFile(id: string, fileId: string): Promise<EvidenceView> {
  return api.delete<EvidenceView>(`${evidence(id)}/files/${encodeURIComponent(fileId)}`);
}

export function requestVerification(
  projectId: string,
  note?: string,
): Promise<ProjectVerificationView> {
  return api.post<ProjectVerificationView>(
    `${project(projectId)}/verification/request`,
    note ? { note } : {},
  );
}

/**
 * Multipart with upload progress — fetch cannot report it, so XHR. Same
 * envelope and errors as the JSON client.
 */
export function uploadEvidenceFile(
  id: string,
  file: File,
  role: EvidenceFileRole | undefined,
  onProgress: (fraction: number) => void,
): Promise<EvidenceView> {
  return new Promise((resolve, reject) => {
    const body = new FormData();
    if (role) body.append('role', role);
    body.append('file', file);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/v1${evidence(id)}/files`);
    xhr.withCredentials = true;
    xhr.setRequestHeader('accept', 'application/json');
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    };
    xhr.onerror = () =>
      reject(ApiError.network('Could not reach Samadhaan. Check your connection.'));
    xhr.onload = () => {
      let payload:
        | { success: true; data: EvidenceView }
        | { success: false; error: { code: string; message: string } }
        | null = null;
      try {
        payload = JSON.parse(xhr.responseText);
      } catch {
        payload = null;
      }
      if (payload && payload.success) {
        resolve(payload.data);
        return;
      }
      reject(
        new ApiError({
          code: (payload && !payload.success
            ? payload.error.code
            : 'INTERNAL_ERROR') as ApiError['code'],
          message:
            payload && !payload.success
              ? payload.error.message
              : xhr.status === 413
                ? 'That file is too large.'
                : 'The upload failed. Please try again.',
          status: xhr.status,
        }),
      );
    };
    xhr.send(body);
  });
}

// --- Government -------------------------------------------------------------

export function fetchGovernmentVerification(
  slug: string,
  publicId: string,
): Promise<GovernmentVerificationView> {
  return api.get<GovernmentVerificationView>(government(slug, publicId), {
    cache: 'no-store',
  });
}

export function approveResolution(
  slug: string,
  publicId: string,
  note?: string,
): Promise<GovernmentVerificationView> {
  return api.post<GovernmentVerificationView>(
    `${government(slug, publicId)}/approve`,
    note ? { note } : {},
  );
}

export function rejectResolution(
  slug: string,
  publicId: string,
  reason: string,
): Promise<GovernmentVerificationView> {
  return api.post<GovernmentVerificationView>(`${government(slug, publicId)}/reject`, {
    reason,
  });
}

export function requestMoreEvidence(
  slug: string,
  publicId: string,
  reason: string,
): Promise<GovernmentVerificationView> {
  return api.post<GovernmentVerificationView>(
    `${government(slug, publicId)}/request-evidence`,
    { reason },
  );
}
