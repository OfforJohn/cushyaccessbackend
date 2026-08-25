import { IsNotEmpty } from 'class-validator';

export class MenuPackRequest {
  @IsNotEmpty({ message: 'Name is required' })
  name: string;

  @IsNotEmpty({ message: 'isPublished is required' })
  isPublished: boolean;
}
