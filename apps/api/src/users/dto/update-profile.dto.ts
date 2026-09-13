import { Transform } from 'class-transformer';
import {
  IsIn,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';
import { PROFILE_LIMITS } from '@samadhaan/shared';

/** Collapses internal whitespace and trims; empty becomes `null` to clear. */
const cleanText = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  const cleaned = value.trim().replace(/\s+/g, ' ');
  return cleaned.length === 0 ? null : cleaned;
};

/**
 * The self-editable profile surface.
 *
 * The security property is what is **absent**: no `role`, `status`, `email`,
 * `emailVerifiedAt`, `passwordHash`, `createdAt` or impact fields. The global
 * `ValidationPipe` runs with `forbidNonWhitelisted`, so a request carrying one
 * is rejected outright rather than silently ignored — privilege escalation is
 * prevented by the shape of this class, not by a check further down.
 *
 * Every field is optional so a client may send only what changed;
 * `@IsOptional()` is required for that, since without it an absent field is
 * validated as `undefined` and rejected.
 */
export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @Length(PROFILE_LIMITS.fullNameMin, PROFILE_LIMITS.fullNameMax)
  @Transform(cleanText)
  fullName?: string;

  @IsOptional()
  @IsString()
  @Length(PROFILE_LIMITS.displayNameMin, PROFILE_LIMITS.displayNameMax)
  @Matches(/^[a-z0-9_]+$/, {
    message: 'Display name may only contain lowercase letters, numbers and underscores',
  })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  displayName?: string;

  /** Sending `null` or an empty string clears the bio. */
  @IsOptional()
  @IsString()
  @MaxLength(PROFILE_LIMITS.bioMax)
  @Transform(({ value }) => {
    if (typeof value !== 'string') return value;
    // Newlines are meaningful in a bio, so only trim the ends and cap runs of
    // blank lines rather than collapsing all whitespace.
    const cleaned = value.trim().replace(/\n{3,}/g, '\n\n');
    return cleaned.length === 0 ? null : cleaned;
  })
  bio?: string | null;

  /**
   * Restricted to http(s). A stored `javascript:` or `data:` URL rendered into
   * an avatar `src` is stored XSS.
   */
  @IsOptional()
  @IsUrl(
    { protocols: ['http', 'https'], require_protocol: true },
    { message: 'Avatar must be a valid http(s) URL' },
  )
  @MaxLength(PROFILE_LIMITS.urlMax)
  avatarUrl?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(PROFILE_LIMITS.localityMax)
  @Transform(cleanText)
  city?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(PROFILE_LIMITS.localityMax)
  @Transform(cleanText)
  state?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(PROFILE_LIMITS.localityMax)
  @Transform(cleanText)
  country?: string | null;

  /**
   * Alphanumeric with optional spaces and hyphens, 3–16 characters.
   *
   * Deliberately not an India-specific six-digit rule: the schema already
   * carries a `country`, and hard-coding one nation's format would reject a
   * valid address the first time the platform is used anywhere else.
   */
  @IsOptional()
  @IsString()
  @Length(PROFILE_LIMITS.postalCodeMin, PROFILE_LIMITS.postalCodeMax)
  @Matches(/^[A-Za-z0-9][A-Za-z0-9 -]*[A-Za-z0-9]$/, {
    message: 'Enter a valid postal code',
  })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  postalCode?: string | null;

  /**
   * Phone is kept private and is only ever returned to the owner. Stored
   * loosely because international formats vary far more than a regex can
   * usefully capture; the shape is checked, not the country plan.
   */
  @IsOptional()
  @IsString()
  @Length(6, 20)
  @Matches(/^\+?[0-9][0-9 ()-]*$/, { message: 'Enter a valid phone number' })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value,
  )
  phone?: string | null;
}

/**
 * Sort order for the (future) public user directory.
 *
 * Declared here so the query surface is validated from the outset rather than
 * being bolted on when the directory is built.
 */
export class ProfileQueryDto {
  @IsOptional()
  @IsIn(['recent', 'name'])
  sort?: 'recent' | 'name';
}
