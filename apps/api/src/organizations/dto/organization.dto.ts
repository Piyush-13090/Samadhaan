import { Transform } from 'class-transformer';
import {
  IsDefined,
  IsEmail,
  IsIn,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import {
  EXPERTISE_LEVELS,
  INVITABLE_MEMBER_ROLES,
  ORGANIZATION_LIMITS,
  ORGANIZATION_MEMBER_ROLES,
  PROBLEM_CATEGORIES,
  type ExpertiseLevel,
  type InvitableMemberRole,
  type OrganizationMemberRole,
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

  /**
   * The organisation's registered location, which defines its service area in
   * the workspace. All-or-nothing — half a coordinate pair is a client bug —
   * and `null` for both clears it. Never published: members see it, the public
   * profile shows city and state only.
   */
  @ValidateIf(hasEitherCoordinate)
  @IsDefined({ message: 'longitude is required when latitude is given' })
  @ValidateIf((dto: UpdateOrganizationDto) => dto.latitude !== null)
  @IsLatitude({ message: 'latitude must be between -90 and 90' })
  latitude?: number | null;

  @ValidateIf(hasEitherCoordinate)
  @IsDefined({ message: 'latitude is required when longitude is given' })
  @ValidateIf((dto: UpdateOrganizationDto) => dto.longitude !== null)
  @IsLongitude({ message: 'longitude must be between -180 and 180' })
  longitude?: number | null;
}

function hasEitherCoordinate(dto: UpdateOrganizationDto): boolean {
  return dto.latitude !== undefined || dto.longitude !== undefined;
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
   * `OWNER` is permitted: sharing ownership is a legitimate action. Who may
   * grant it is decided by the role hierarchy in `OrganizationAccessService`,
   * and the last-owner invariant keeps it safe — not this list.
   */
  @IsIn(ORGANIZATION_MEMBER_ROLES)
  membershipRole!: OrganizationMemberRole;
}

/**
 * Invites an existing account by email.
 *
 * Only ADMIN or MEMBER: ownership is shared with someone already on the team,
 * through a role change an owner makes deliberately — never by an invitation
 * that a typo in an email address could send to a stranger.
 */
export class InviteMemberDto {
  @IsEmail({}, { message: 'Enter a valid email address' })
  @MaxLength(254)
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  email!: string;

  @IsIn(INVITABLE_MEMBER_ROLES, { message: 'Invite as ADMIN or MEMBER' })
  membershipRole!: InvitableMemberRole;
}
