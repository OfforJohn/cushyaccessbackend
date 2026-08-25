import { SetMetadata } from '@nestjs/common';

export const API_KEY = 'API_KEY';
export const ApiKeyAuth = () => SetMetadata(API_KEY, []);
