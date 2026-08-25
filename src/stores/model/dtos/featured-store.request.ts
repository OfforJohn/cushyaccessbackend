import { IsBoolean } from 'class-validator';

export class FeaturedStoreRequest {
  @IsBoolean()
  isFeatured: boolean;
}
