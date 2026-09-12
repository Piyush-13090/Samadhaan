import type {
  PriorityLevel,
  ProblemCategory,
  ProblemStatus,
  SeverityLevel,
} from '@/types/domain';
import type { Tone } from '@/types/ui';

/**
 * How domain values are presented: label, tone, and where relevant a shape or
 * letter that carries the meaning **without** colour.
 *
 * Centralised so "High" severity is the same words and the same amber
 * everywhere — a feed card, a detail header and a government queue row cannot
 * drift apart.
 */

interface StatusPresentation {
  label: string;
  tone: Tone;
  /** Short description used in tooltips and screen-reader text. */
  description: string;
}

export const PROBLEM_STATUS_DISPLAY: Record<ProblemStatus, StatusPresentation> = {
  DRAFT: {
    label: 'Draft',
    tone: 'neutral',
    description: 'Not yet submitted',
  },
  SUBMITTED: {
    label: 'Submitted',
    tone: 'info',
    description: 'Reported and awaiting review',
  },
  UNDER_REVIEW: {
    label: 'Under review',
    tone: 'warning',
    description: 'Being assessed by the local authority',
  },
  VERIFIED: {
    label: 'Verified',
    tone: 'primary',
    description: 'Confirmed and ready for allocation',
  },
  IN_PROGRESS: {
    label: 'In progress',
    tone: 'primary',
    description: 'Work is underway',
  },
  RESOLVED: {
    label: 'Resolved',
    tone: 'success',
    description: 'Fixed and verified',
  },
  REJECTED: {
    label: 'Rejected',
    tone: 'neutral',
    description: 'Closed without action',
  },
  DUPLICATE: {
    label: 'Duplicate',
    tone: 'neutral',
    description: 'Merged into an earlier report',
  },
  ARCHIVED: {
    label: 'Archived',
    tone: 'neutral',
    description: 'Closed and moved out of active views',
  },
};

interface SeverityPresentation {
  label: string;
  tone: Tone;
  /**
   * Filled bars out of four. Severity must be readable without colour, so the
   * badge renders this as a meter alongside the label.
   */
  bars: number;
  /** Inclusive lower bound of the 0–10 AI score that maps to this band. */
  minScore: number;
}

export const SEVERITY_DISPLAY: Record<SeverityLevel, SeverityPresentation> = {
  LOW: { label: 'Low', tone: 'neutral', bars: 1, minScore: 0 },
  MEDIUM: { label: 'Medium', tone: 'warning', bars: 2, minScore: 4 },
  HIGH: { label: 'High', tone: 'danger', bars: 3, minScore: 6.5 },
  CRITICAL: { label: 'Critical', tone: 'danger', bars: 4, minScore: 8.5 },
};

/** Maps a 0–10 AI severity score onto its display band. */
export function severityFromScore(score: number): SeverityLevel {
  if (score >= SEVERITY_DISPLAY.CRITICAL.minScore) return 'CRITICAL';
  if (score >= SEVERITY_DISPLAY.HIGH.minScore) return 'HIGH';
  if (score >= SEVERITY_DISPLAY.MEDIUM.minScore) return 'MEDIUM';
  return 'LOW';
}

interface CategoryPresentation {
  label: string;
  /** Short form for dense rows where the full label will not fit. */
  short: string;
}

export const CATEGORY_DISPLAY: Record<ProblemCategory, CategoryPresentation> = {
  ROADS: { label: 'Roads', short: 'Roads' },
  POTHOLES: { label: 'Potholes', short: 'Potholes' },
  STREETLIGHTS: { label: 'Street lighting', short: 'Lighting' },
  WATER: { label: 'Water supply', short: 'Water' },
  DRAINAGE: { label: 'Drainage', short: 'Drainage' },
  SANITATION: { label: 'Sanitation', short: 'Sanitation' },
  GARBAGE: { label: 'Waste collection', short: 'Waste' },
  TRAFFIC: { label: 'Traffic', short: 'Traffic' },
  PUBLIC_SAFETY: { label: 'Public safety', short: 'Safety' },
  POLLUTION: { label: 'Pollution', short: 'Pollution' },
  ELECTRICITY: { label: 'Electricity', short: 'Electricity' },
  PUBLIC_TRANSPORT: { label: 'Public transport', short: 'Transport' },
  PARKS: { label: 'Parks & open spaces', short: 'Parks' },
  PUBLIC_INFRASTRUCTURE: { label: 'Public infrastructure', short: 'Infrastructure' },
  OTHER: { label: 'Other', short: 'Other' },
};

interface PriorityPresentation {
  label: string;
  tone: Tone;
  description: string;
}

export const PRIORITY_DISPLAY: Record<PriorityLevel, PriorityPresentation> = {
  P1: { label: 'P1', tone: 'danger', description: 'Immediate — safety risk' },
  P2: { label: 'P2', tone: 'warning', description: 'High — act this week' },
  P3: { label: 'P3', tone: 'info', description: 'Normal — scheduled' },
  P4: { label: 'P4', tone: 'neutral', description: 'Low — when capacity allows' },
};

/**
 * How to describe an AI confidence value to a person.
 *
 * A bare percentage invites false precision. Pairing it with a plain-language
 * band tells the reader how much weight to give the result.
 */
export function confidenceBand(confidence: number): {
  label: string;
  tone: Tone;
} {
  if (confidence >= 0.85) return { label: 'High confidence', tone: 'success' };
  if (confidence >= 0.6) return { label: 'Moderate confidence', tone: 'warning' };
  return { label: 'Low confidence', tone: 'danger' };
}
