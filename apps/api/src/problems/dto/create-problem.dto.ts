import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDefined,
  IsIn,
  IsInt,
  IsNotEmptyObject,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  PROBLEM_CATEGORIES,
  REPORT_LIMITS,
  type ProblemCategory,
} from '@samadhaan/shared';
import { isSafeStorageKey } from '../../storage/storage-key.js';

const cleanText = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  const cleaned = value.trim().replace(/[ \t]+/g, ' ');
  return cleaned.length === 0 ? null : cleaned;
};

/** One image being attached, referenced by the key the upload endpoint issued. */
export class ProblemImageInputDto {
  /**
   * Shape-checked here; *ownership* is checked in the service against the
   * pending-upload record. Validation cannot know whose key this is, and
   * without the second check anyone could attach someone else's photo.
   */
  @IsString()
  @MaxLength(512)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  storageKey!: string;

  @IsInt()
  @Min(0)
  @Max(REPORT_LIMITS.maxImages - 1)
  sortOrder!: number;

  @IsBoolean()
  isPrimary!: boolean;
}

export class ReportLocationDto {
  /**
   * Range-checked here as well as by the column's CHECK constraint, so a bad
   * coordinate is a readable 400 rather than a database error.
   *
   * `@IsNumber` rather than `@IsLatitude`, which also accepts strings — the
   * column is numeric and a string would be coerced silently.
   */
  @IsNumber({ maxDecimalPlaces: 6 }, { message: 'Latitude must be a number' })
  @Min(-90, { message: 'Latitude must be between -90 and 90' })
  @Max(90, { message: 'Latitude must be between -90 and 90' })
  latitude!: number;

  @IsNumber({ maxDecimalPlaces: 6 }, { message: 'Longitude must be a number' })
  @Min(-180, { message: 'Longitude must be between -180 and 180' })
  @Max(180, { message: 'Longitude must be between -180 and 180' })
  longitude!: number;

  @IsOptional()
  @IsString()
  @MaxLength(REPORT_LIMITS.addressMax)
  @Transform(cleanText)
  address?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(REPORT_LIMITS.localityMax)
  @Transform(cleanText)
  city?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(REPORT_LIMITS.localityMax)
  @Transform(cleanText)
  state?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(REPORT_LIMITS.localityMax)
  @Transform(cleanText)
  country?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(REPORT_LIMITS.postalCodeMax)
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() || null : value,
  )
  postalCode?: string | null;

  /** Device-reported GPS accuracy. Capped: a 50 km "accuracy" is meaningless. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(50_000)
  accuracyMeters?: number | null;
}

/**
 * A citizen's problem report.
 *
 * Note what is **absent**: `status`, `severity`, `urgency`, `priorityScore`,
 * `publicId`, `reporterId`. Validation runs with `forbidNonWhitelisted`, so a
 * request carrying any of them is rejected outright rather than ignored.
 *
 * That is not only about privilege. Severity and urgency are assessments the AI
 * and a reviewer make; letting the reporter set them would make the triage
 * queue a measure of how alarmed people are rather than how bad things are.
 * The reporter is the id on the verified token, never a field in the body.
 */
export class CreateProblemDto {
  @IsString()
  @Length(REPORT_LIMITS.titleMin, REPORT_LIMITS.titleMax, {
    message: `Title must be between ${REPORT_LIMITS.titleMin} and ${REPORT_LIMITS.titleMax} characters`,
  })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value,
  )
  title!: string;

  @IsString()
  @Length(REPORT_LIMITS.descriptionMin, REPORT_LIMITS.descriptionMax, {
    message: `Please describe the problem in at least ${REPORT_LIMITS.descriptionMin} characters`,
  })
  @Transform(({ value }) =>
    // Ends trimmed and runs of blank lines capped, but internal newlines kept:
    // a description may legitimately have paragraphs.
    typeof value === 'string' ? value.trim().replace(/\n{3,}/g, '\n\n') : value,
  )
  description!: string;

  @IsIn(PROBLEM_CATEGORIES, {
    message: 'Choose a category from the list',
  })
  category!: ProblemCategory;

  @IsOptional()
  @IsString()
  @MaxLength(REPORT_LIMITS.subcategoryMax)
  @Transform(cleanText)
  subcategory?: string | null;

  /**
   * Required. `@IsDefined` and `@IsNotEmptyObject` come first because
   * `@ValidateNested` alone does nothing when the value is absent — the request
   * would pass validation and fail later as a 500 rather than a readable 400.
   */
  @IsDefined({ message: 'A location is required' })
  @IsNotEmptyObject({ nullable: false }, { message: 'A location is required' })
  @ValidateNested()
  @Type(() => ReportLocationDto)
  location!: ReportLocationDto;

  /**
   * Optional: a report without a photo is still worth filing. A citizen may be
   * describing something they cannot safely photograph, and refusing the report
   * would lose information the platform exists to collect.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(REPORT_LIMITS.maxImages, {
    message: `Attach at most ${REPORT_LIMITS.maxImages} photos`,
  })
  @ValidateNested({ each: true })
  @Type(() => ProblemImageInputDto)
  images?: ProblemImageInputDto[];
}

/** Rejects keys this application could not have generated. */
export function assertSafeStorageKeys(keys: string[]): string[] {
  return keys.filter((key) => !isSafeStorageKey(key));
}
