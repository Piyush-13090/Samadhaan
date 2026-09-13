import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  MaxLength,
} from 'class-validator';
import {
  EXPERTISE_LEVELS,
  ORGANIZATION_LIMITS,
  PROBLEM_CATEGORIES,
  type ExpertiseLevel,
  type ProblemCategory,
} from '@samadhaan/shared';

const cleanText = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  const cleaned = value.trim().replace(/\s+/g, ' ');
  return cleaned.length === 0 ? null : cleaned;
};

/**
 * Editable organisation fields.
 *
 * Absent by design: `slug`, `verificationStatus`, `verifiedAt`, `type`,
 * `isActive`. Slugs are stable public URLs (see `slug.util.ts`), and
 * verification is an administrative decision — an organisation marking itself
 * VERIFIED would make the badge meaningless. `type` is fixed at creation
 * because it determines which verification evidence applies.
 */
export class UpdateOrganizationDto {
  @IsOptional()
  @IsString()
  @Length(ORGANIZATION_LIMITS.nameMin, ORGANIZATION_LIMITS.nameMax)
  @Transform(cleanText)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(ORGANIZATION_LIMITS.descriptionMax)
  @Transform(({ value }) => {
    if (typeof value !== 'string') return value;
    const cleaned = value.trim().replace(/\n{3,}/g, '\n\n');
    return cleaned.length === 0 ? null : cleaned;
  })
  description?: string | null;

  /** http(s) only — a `javascript:` logo URL would be stored XSS. */
  @IsOptional()
  @IsUrl(
    { protocols: ['http', 'https'], require_protocol: true },
    { message: 'Logo must be a valid http(s) URL' },
  )
  @MaxLength(2048)
  logoUrl?: string | null;

  @IsOptional()
  @IsUrl(
    { protocols: ['http', 'https'], require_protocol: true },
    { message: 'Website must be a valid http(s) URL' },
  )
  @MaxLength(2048)
  websiteUrl?: string | null;

  @IsOptional()
  @IsEmail({}, { message: 'Enter a valid email address' })
  @MaxLength(254)
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() || null : value,
  )
  email?: string | null;

  @IsOptional()
  @IsString()
  @Length(6, 20)
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') || null : value,
  )
  phone?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(ORGANIZATION_LIMITS.addressMax)
  @Transform(cleanText)
  address?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(ORGANIZATION_LIMITS.localityMax)
  @Transform(cleanText)
  city?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(ORGANIZATION_LIMITS.localityMax)
  @Transform(cleanText)
  state?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(ORGANIZATION_LIMITS.localityMax)
  @Transform(cleanText)
  country?: string | null;

  @IsOptional()
  @IsString()
  @Length(3, 16)
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() || null : value,
  )
  postalCode?: string | null;
}

/**
 * Declares an area an organisation works in.
 *
 * `category` is constrained to `ProblemCategory`, the same taxonomy problems
 * use. Matching an organisation to a problem is a comparison between the two,
 * and a parallel vocabulary would need a translation table that goes stale the
 * first time either side changes.
 */
export class CreateExpertiseDto {
  @IsIn(PROBLEM_CATEGORIES, {
    message: `Category must be one of: ${PROBLEM_CATEGORIES.join(', ')}`,
  })
  category!: ProblemCategory;

  @IsOptional()
  @IsString()
  @Length(ORGANIZATION_LIMITS.subcategoryMin, ORGANIZATION_LIMITS.subcategoryMax)
  @Transform(cleanText)
  subcategory?: string | null;

  @IsOptional()
  @IsIn(EXPERTISE_LEVELS)
  level?: ExpertiseLevel;
}

/** Membership changes an OWNER/ADMIN may make. */
export class UpdateMemberDto {
  /**
   * `OWNER` is permitted: transferring ownership is a legitimate action, and
   * the last-owner invariant is what keeps it safe, not a restriction here.
   */
  @IsIn(['OWNER', 'ADMIN', 'MEMBER'])
  membershipRole!: 'OWNER' | 'ADMIN' | 'MEMBER';
}
