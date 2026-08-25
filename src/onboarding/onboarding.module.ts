import { Module } from '@nestjs/common';
import { OnboardingService } from './onboarding.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Onboarding } from './model/onboarding.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Onboarding])],
  providers: [OnboardingService],
  exports: [OnboardingService],
})
export class OnboardingModule {}
