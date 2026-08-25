import { IsOptional, IsNumber, IsString, Min, IsIn } from 'class-validator';
import { Type } from 'class-transformer';

export class PaginationRequest {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  size: number = 10;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  sortBy: string = 'updatedAt';

  @IsOptional()
  @IsIn(['ASC', 'DESC'])
  sortOrder: 'ASC' | 'DESC' = 'DESC';

  @IsOptional()
  filter?: any;
}

export class PaginationResponse {
  constructor(
    public page: number,
    public itemCount: number,
    public totalItems: number,
    public totalPages: number,
  ) {}
}
