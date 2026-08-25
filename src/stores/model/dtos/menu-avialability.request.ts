import { IsBoolean } from 'class-validator';

export class MenuAvailabilityRequest {
  @IsBoolean({
    message: 'IS_AVAILABLE_MUST_BE_A_BOOLEAN',
  })
  isAvailable: boolean;
}
