import type { ProblemCategory, ProblemStatus, ProblemSeverity } from './problem.js';

/**
 * Problem reporting contracts.
 *
 * Shared so the reporting form, the API's DTOs and the detail page agree on
 * one definition of a report — including the validation bounds, which the
 * client uses for immediate feedback and the server enforces authoritatively.
 */

// ---------------------------------------------------------------------------
// Uploads
// ---------------------------------------------------------------------------

/** What the upload endpoint returns for one accepted image. */
export interface UploadedImage {
  /**
   * Server-generated object key. The client echoes this back at submission;
   * it is never a path and never derived from the filename.
   */
  storageKey: string;
  /** Fetchable URL for the preview. */
  url: string;
  contentType: string;
  originalFileName: string | null;
  sizeBytes: number;
  width: number;
  height: number;
}

/** One image as attached to a problem at submission time. */
export interface ProblemImageInput {
  storageKey: string;
  /** Position in the gallery. */
  sortOrder: number;
  /** Exactly one image per problem may be primary. */
  isPrimary: boolean;
}

// ---------------------------------------------------------------------------
// Location
// ---------------------------------------------------------------------------

export interface ReportLocationInput {
  latitude: number;
  longitude: number;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  postalCode?: string | null;
  /** Reported GPS accuracy in metres, when the device supplied it. */
  accuracyMeters?: number | null;
}

// ---------------------------------------------------------------------------
// Submission
// ---------------------------------------------------------------------------

export interface CreateProblemInput {
  title: string;
  description: string;
  category: ProblemCategory;
  subcategory?: string | null;
  location: ReportLocationInput;
  images: ProblemImageInput[];
}

/** A problem image as returned by the API. */
export interface ProblemImageView {
  id: string;
  url: string;
  width: number | null;
  height: number | null;
  sortOrder: number;
  isPrimary: boolean;
}

/** The reporter, at the privacy level a public problem page may show. */
export interface ProblemReporterView {
  id: string;
  /** Display name where one is set, otherwise the full name. */
  name: string;
  avatarUrl: string | null;
}

/**
 * A problem as returned by the API.
 *
 * Deliberately absent: the reporter's email, phone and exact account state; the
 * raw AI columns; internal counters not yet meaningful. A civic report is
 * public, but the person who filed it did not consent to publishing their
 * contact details.
 */
export interface ProblemView {
  id: string;
  publicId: string;
  title: string;
  description: string;
  category: ProblemCategory;
  subcategory: string | null;
  status: ProblemStatus;
  severity: ProblemSeverity;
  location: {
    latitude: number;
    longitude: number;
    address: string | null;
    city: string | null;
    state: string | null;
    country: string | null;
    postalCode: string | null;
  };
  images: ProblemImageView[];
  reporter: ProblemReporterView;
  voteCount: number;
  commentCount: number;
  createdAt: string;
  submittedAt: string | null;
  /** True when the requesting user filed this report. */
  isOwnReport?: boolean;
}

// ---------------------------------------------------------------------------
// Validation bounds — enforced by the API, mirrored by the form
// ---------------------------------------------------------------------------

export const REPORT_LIMITS = {
  titleMin: 8,
  titleMax: 140,
  /**
   * A description shorter than this is almost never actionable — "road bad"
   * cannot be triaged, categorised or matched to an organisation.
   */
  descriptionMin: 20,
  descriptionMax: 2000,
  subcategoryMax: 80,
  addressMax: 300,
  localityMax: 120,
  postalCodeMax: 16,
  maxImages: 6,
  maxImageBytes: 8 * 1024 * 1024,
} as const;

/** Image formats the API accepts. SVG is excluded — it can carry script. */
export const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

export type AcceptedImageType = (typeof ACCEPTED_IMAGE_TYPES)[number];

/**
 * Subcategory suggestions per category.
 *
 * Suggestions, not a constraint: the column is free text within a category, so
 * a citizen can describe something the list does not anticipate. Offering the
 * common cases keeps the data tidy without making the form a guessing game.
 */
export const SUBCATEGORY_SUGGESTIONS: Partial<Record<ProblemCategory, string[]>> = {
  ROADS: ['Damaged surface', 'Missing signage', 'Blocked road', 'Unsafe crossing'],
  POTHOLES: ['Single pothole', 'Multiple potholes', 'Sunken patch'],
  STREETLIGHTS: ['Light not working', 'Flickering light', 'Damaged pole'],
  WATER: ['No supply', 'Leaking pipe', 'Contaminated water', 'Low pressure'],
  DRAINAGE: ['Blocked drain', 'Open drain', 'Waterlogging', 'Overflowing sewer'],
  SANITATION: ['Public toilet', 'Open defecation', 'Unclean area'],
  GARBAGE: ['Uncollected waste', 'Overflowing bin', 'Illegal dumping'],
  TRAFFIC: ['Signal not working', 'Congestion', 'Illegal parking'],
  PUBLIC_SAFETY: ['Open manhole', 'Exposed wiring', 'Unsafe structure', 'Poor lighting'],
  POLLUTION: ['Air pollution', 'Noise', 'Water pollution', 'Burning waste'],
  ELECTRICITY: ['Power cut', 'Exposed cable', 'Damaged transformer'],
  PUBLIC_TRANSPORT: ['Bus stop damaged', 'No shelter', 'Route problem'],
  PARKS: ['Damaged equipment', 'Overgrown area', 'Litter'],
  PUBLIC_INFRASTRUCTURE: ['Damaged footpath', 'Broken bench', 'Damaged railing'],
};
