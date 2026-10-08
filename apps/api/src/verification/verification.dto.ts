import { Transform } from 'class-transformer';
import {
  IsDefined,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import {
  EVIDENCE_DESCRIPTION_MAX,
  EVIDENCE_FILE_ROLES,
  EVIDENCE_TITLE_MAX,
  EVIDENCE_TYPES,
  VERIFICATION_REASON_MAX,
  VERIFICATION_REASON_MIN,
  type EvidenceFileRole,
  type EvidenceType,
} from '@samadhaan/shared';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const trimOrNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() || null : value;

/**
 * New evidence. No project, problem, organisation, submitter or status field:
 * those come from the URL's project (after its access check) and the session.
 */
export class CreateEvidenceDto {
  @IsDefined()
  @IsIn(EVIDENCE_TYPES)
  evidenceType!: EvidenceType;

  @IsDefined({ message: 'Give the evidence a title.' })
  @Transform(trim)
  @IsString()
  @MinLength(1, { message: 'Give the evidence a title.' })
  @MaxLength(EVIDENCE_TITLE_MAX)
  title!: string;

  @IsOptional()
  @Transform(trimOrNull)
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(EVIDENCE_DESCRIPTION_MAX)
  description?: string | null;

  /** A newer version of earlier evidence in the same project. */
  @IsOptional()
  @IsUUID()
  replacesEvidenceId?: string;
}

/** Multipart field beside the file. */
export class EvidenceFileDto {
  @IsOptional()
  @IsIn(EVIDENCE_FILE_ROLES)
  role?: EvidenceFileRole;
}

export class RequestVerificationDto {
  @IsOptional()
  @Transform(trimOrNull)
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(1000)
  note?: string | null;
}

export class ApproveResolutionDto {
  /** An optional verification note, shared with the organisation. */
  @IsOptional()
  @Transform(trimOrNull)
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(VERIFICATION_REASON_MAX)
  note?: string | null;
}

/** Rejection and requests for more evidence always carry a reason. */
export class DecisionReasonDto {
  @IsDefined({ message: 'Give a reason the organisation can act on.' })
  @Transform(trim)
  @IsString()
  @MinLength(VERIFICATION_REASON_MIN, {
    message: `Give a reason of at least ${VERIFICATION_REASON_MIN} characters.`,
  })
  @MaxLength(VERIFICATION_REASON_MAX)
  reason!: string;
}
