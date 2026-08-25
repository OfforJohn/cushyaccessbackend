import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_JEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_JEY, true);
