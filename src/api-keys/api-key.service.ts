import { Injectable } from '@nestjs/common';
import { Repository } from 'typeorm';
import { ApiKeys } from './api-keys.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomBytes } from 'crypto';
import { Users } from '../users/model/users.entity';

@Injectable()
export class ApiKeyService {
  constructor(
    @InjectRepository(ApiKeys)
    private readonly apiKeysRepository: Repository<ApiKeys>,
  ) {}

  async validateKey(
    hashedKey: string,
  ): Promise<{ isActive: boolean; userId: string }> {
    const key = await this.apiKeysRepository.findOne({
      where: { hashedKey, isActive: true },
    });

    if (!key) return { isActive: false, userId: '' };
    // if (key.expiresAt && key.expiresAt < new Date()) return false;
    return { isActive: key.isActive, userId: key.userId };
  }

  async signIn(user: Users) {
    let key = this.generateApiKey();

    while (
      await this.apiKeysRepository.exists({
        where: { hashedKey: key.hashedKey },
      })
    ) {
      key = this.generateApiKey();
    }

    const apiKey = new ApiKeys();
    apiKey.name = user.businessName;
    apiKey.userId = user.id;
    apiKey.hashedKey = key.hashedKey;
    await this.apiKeysRepository.save(apiKey);

    return `CUSHY-${key.plainKey}-X`;
  }

  private generateApiKey() {
    const plainKey = randomBytes(32).toString('hex');
    const hashedKey = createHash('sha256').update(plainKey).digest('hex');
    return { plainKey, hashedKey };
  }
}
