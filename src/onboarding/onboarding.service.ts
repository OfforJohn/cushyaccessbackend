import { BadRequestException, Injectable } from '@nestjs/common';
import { Repository } from 'typeorm';
import { Onboarding } from './model/onboarding.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { Users } from 'src/users/model/users.entity';
import { OnboardingType } from './model/stage.enum';
import { StandardResponse } from 'src/common/module/standard-response';

@Injectable()
export class OnboardingService {
  constructor(
    @InjectRepository(Onboarding)
    private readonly onboardingRepository: Repository<Onboarding>,
  ) {}

  async createOnBoarding(user: Users, type: OnboardingType): Promise<void> {
    const hasOnBoarded = await this.onboardingRepository.findOne({
      where: { userId: user.id, onboardingType: type },
    });
    if (hasOnBoarded) return;
    const newOnboarding = new Onboarding();
    newOnboarding.user = user;
    newOnboarding.userId = user.id;
    newOnboarding.onboardingType = type;

    await this.onboardingRepository.save(newOnboarding);
  }

  async hasEmailMobileOnboarded(userId: string) {
    const onboardings = await this.onboardingRepository.find({
      where: { userId },
    });

    let emailVerified = false;
    let mobileVerified = false;

    onboardings.forEach((onboarding) => {
      switch (onboarding.onboardingType) {
        case OnboardingType.EMAIL_VERIFIED: {
          emailVerified = true;
          break;
        }
        case OnboardingType.MOBILE_VERIFIED: {
          mobileVerified = true;
          break;
        }
      }
    });

    if (!emailVerified || !mobileVerified) {
      throw new BadRequestException(
        new StandardResponse(true, 'ACCOUNT_NOT_VERIFIED'),
      );
    }
  }
}
