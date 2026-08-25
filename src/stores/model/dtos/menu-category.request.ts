import { IsNotEmpty } from 'class-validator';

export class MenuCategoryRequest {
  @IsNotEmpty({ message: 'Name is required' })
  name: string;

  @IsNotEmpty({ message: 'isPublished is required' })
  isPublished: boolean;
}
