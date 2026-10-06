import { Transform, Type } from 'class-transformer';
import {
  IsDefined,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** A place search: a city, locality or address. */
export class GeocodeSearchQueryDto {
  @Transform(trim)
  @IsString()
  @Length(2, 200, { message: 'Search for at least 2 and at most 200 characters.' })
  q!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(8)
  limit: number = 5;
}

/** A point to describe as an address. */
export class ReverseGeocodeQueryDto {
  @IsDefined()
  @Type(() => Number)
  @IsLatitude()
  latitude!: number;

  @IsDefined()
  @Type(() => Number)
  @IsLongitude()
  longitude!: number;
}
