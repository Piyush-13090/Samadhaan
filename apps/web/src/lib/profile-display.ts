import type {
  ExpertiseLevel,
  ProfileLocation,
  VerificationStatus,
} from '@samadhaan/shared';
import type { Tone } from '@/types/ui';

/**
 * Presentation for profile vocabularies.
 *
 * Centralised so "Verified" is the same word and the same tone on an
 * organisation card, a profile header and a future admin queue.
 */

interface VerificationPresentation {
  label: string;
  tone: Tone;
  /** Plain-language meaning, for tooltips and screen readers. */
  description: string;
}

export const VERIFICATION_DISPLAY: Record<VerificationStatus, VerificationPresentation> =
  {
    VERIFIED: {
      label: 'Verified',
      tone: 'success',
      description: 'Samadhaan has confirmed this organisation',
    },
    PENDING: {
      label: 'Pending verification',
      tone: 'warning',
      description: 'Awaiting review by Samadhaan',
    },
    REJECTED: {
      label: 'Not verified',
      tone: 'danger',
      description: 'Verification was declined',
    },
    SUSPENDED: {
      label: 'Suspended',
      tone: 'danger',
      description: 'This organisation is suspended',
    },
  };

interface ExpertisePresentation {
  label: string;
  tone: Tone;
  /** Filled pips out of three, so level survives without colour. */
  pips: number;
}

export const EXPERTISE_DISPLAY: Record<ExpertiseLevel, ExpertisePresentation> = {
  SPECIALIST: { label: 'Specialist', tone: 'primary', pips: 3 },
  EXPERIENCED: { label: 'Experienced', tone: 'info', pips: 2 },
  INTERESTED: { label: 'Interested', tone: 'neutral', pips: 1 },
};

export const MEMBERSHIP_ROLE_LABEL: Record<string, string> = {
  OWNER: 'Owner',
  ADMIN: 'Admin',
  MEMBER: 'Member',
};

export const MEMBERSHIP_STATUS_LABEL: Record<string, string> = {
  INVITED: 'Invited',
  ACTIVE: 'Active',
  SUSPENDED: 'Suspended',
  LEFT: 'Left',
};

/** `Gurugram, Haryana` — omits missing parts rather than leaving stray commas. */
export function formatLocation(location: ProfileLocation): string | null {
  const parts = [location.city, location.state, location.country].filter(
    (part): part is string => Boolean(part),
  );

  // Country alone is too vague to be worth showing as a location.
  if (parts.length === 0 || (parts.length === 1 && parts[0] === location.country)) {
    return null;
  }

  return parts.join(', ');
}
