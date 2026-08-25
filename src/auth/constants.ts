import { ConfigService } from '@nestjs/config';

export const SecretKey = new ConfigService().get('JWT_SECRET');
