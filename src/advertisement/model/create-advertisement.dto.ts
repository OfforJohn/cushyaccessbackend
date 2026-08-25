import { IsArray, IsNotEmpty } from 'class-validator';
import { AdvertisementCategory } from './advertisement-category.enum';
import { CallToAction } from './call-to-action';

export class CreateAdvertisementsDto {
  @IsNotEmpty({ message: 'category is required' })
  category: AdvertisementCategory;

  @IsNotEmpty()
  @IsArray()
  callToAction: CallToAction[];

  @IsNotEmpty()
  url: string;
}
