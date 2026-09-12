import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

/**
 * Base query DTO for cursor-paginated list endpoints. Feature modules extend
 * this rather than redeclaring the same two fields.
 */
export class PaginationQueryDto {
  /** Opaque cursor returned as `nextCursor` by the previous page. */
  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;
}
