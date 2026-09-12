import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '@samadhaan/shared';

/**
 * Public registration payload.
 *
 * Note what is absent: `role`, `status`, `emailVerifiedAt`. The global
 * `ValidationPipe` runs with `forbidNonWhitelisted`, so a request that includes
 * `"role": "ADMIN"` is rejected outright rather than quietly ignored. Privilege
 * escalation is prevented by the shape of this class, not by a check somewhere
 * in the service — there is no field to escalate through.
 */
export class RegisterDto {
  @IsString()
  @Length(2, 120)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  fullName!: string;

  /**
   * Lower-cased and trimmed before validation, so `Priya@Example.com ` and
   * `priya@example.com` cannot become two accounts. The column is unique on the
   * normalised form.
   */
  @IsEmail({}, { message: 'Enter a valid email address' })
  @MaxLength(254) // RFC 5321 maximum
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  email!: string;

  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH, {
    message: `Password must be at least ${PASSWORD_MIN_LENGTH} characters`,
  })
  @MaxLength(PASSWORD_MAX_LENGTH)
  password!: string;
}

/**
 * Self-editable profile fields. Every field is optional, so a client may send
 * only what changed — `@IsOptional()` is required for that; without it an
 * absent field is validated as `undefined` and rejected.
 *
 * As with `RegisterDto`, the security property is what is *missing*: no `role`,
 * no `status`, no `email`. Changing any of those needs a dedicated, auditable
 * path, not a profile edit.
 */
export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @Length(2, 120)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  fullName?: string;

  @IsOptional()
  @IsString()
  @Length(3, 32)
  @Matches(/^[a-z0-9_]+$/, {
    message: 'Display name may only contain lowercase letters, numbers and underscores',
  })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  displayName?: string;

  /**
   * Restricted to http(s) so a stored `javascript:` or `data:` URL cannot be
   * rendered into an avatar `src` and become stored XSS.
   */
  @IsOptional()
  @IsUrl(
    { protocols: ['http', 'https'], require_protocol: true },
    { message: 'Avatar must be a valid http(s) URL' },
  )
  @MaxLength(2048)
  avatarUrl?: string;
}
