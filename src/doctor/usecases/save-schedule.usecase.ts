import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConsultationSchedule } from '../models/consultation-schedule.entity';
import { SaveScheduleDto } from '../DTO/save-schedule.dto';
import { CommonService } from 'src/common/common.service';
import { StandardResponse } from 'src/common/module/standard-response';
import { ConsultationType } from '../models/enums/consultation-type.enum';
import { DayOfWeek } from '../models/enums/day-of-week.enum';
import { DayScheduleDto } from '../DTO/day-schedule.dto';

@Injectable()
export class SaveScheduleUseCase {
  constructor(
    @InjectRepository(ConsultationSchedule)
    private readonly scheduleRepo: Repository<ConsultationSchedule>,
    private readonly commonService: CommonService,
  ) {}

  async execute(dto: SaveScheduleDto) {
    const authenticatedUser = await this.commonService.getLoggedInUser();

    const existingSchedules = await this.scheduleRepo.find({
      where: {
        doctorId: authenticatedUser.id,
        consultationType: dto.consultationType,
      },
    });

    const result = await this.processSchedules(
      authenticatedUser.id,
      dto.consultationType as ConsultationType,
      dto.schedules,
      existingSchedules,
    );

    return new StandardResponse(false, 'SCHEDULE_SAVED_SUCCESSFULLY', result);
  }

  private async processSchedules(
    doctorId: string,
    consultationType: ConsultationType,
    newSchedules: DayScheduleDto[], // Use the actual DTO type
    existingSchedules: ConsultationSchedule[],
  ): Promise<ConsultationSchedule[]> {
    const existingMap = new Map<DayOfWeek, ConsultationSchedule>();

    existingSchedules.forEach((schedule) => {
      existingMap.set(schedule.day, schedule);
    });

    const schedulesToSave: ConsultationSchedule[] = [];
    const daysToKeep = new Set<DayOfWeek>();

    for (const scheduleDto of newSchedules) {
      this.validateSchedule(scheduleDto);

      const existingSchedule = existingMap.get(scheduleDto.day);

      if (existingSchedule) {
        existingSchedule.openTime = scheduleDto.isDayOff
          ? null
          : scheduleDto.openTime!;
        existingSchedule.closeTime = scheduleDto.isDayOff
          ? null
          : scheduleDto.closeTime!;
        existingSchedule.isDayOff = scheduleDto.isDayOff;
        schedulesToSave.push(existingSchedule);
      } else {
        const newSchedule = this.scheduleRepo.create({
          doctorId,
          consultationType,
          day: scheduleDto.day,
          openTime: scheduleDto.isDayOff ? null : scheduleDto.openTime!,
          closeTime: scheduleDto.isDayOff ? null : scheduleDto.closeTime!,
          isDayOff: scheduleDto.isDayOff,
        });
        schedulesToSave.push(newSchedule);
      }

      daysToKeep.add(scheduleDto.day);
    }

    const daysToDelete = existingSchedules
      .filter((schedule) => !daysToKeep.has(schedule.day))
      .map((schedule) => schedule.id);

    if (daysToDelete.length > 0) {
      await this.scheduleRepo.delete(daysToDelete);
    }

    return await this.scheduleRepo.save(schedulesToSave);
  }

  private validateSchedule(schedule: DayScheduleDto): void {
    if (!schedule.isDayOff) {
      if (!schedule.openTime || !schedule.closeTime) {
        throw new BadRequestException(
          new StandardResponse(
            true,
            `Both openTime and closeTime are required for working days (${schedule.day}`,
          ),
        );
      }

      // Validate that openTime is before closeTime
      if (schedule.openTime >= schedule.closeTime) {
        throw new BadRequestException(
          new StandardResponse(
            true,
            `openTime must be before closeTime for ${schedule.day}`,
          ),
        );
      }
    } else {
      // For days off, openTime and closeTime should not be provided
      if (schedule.openTime || schedule.closeTime) {
        throw new BadRequestException(
          new StandardResponse(
            true,
            `openTime and closeTime should not be provided for day off (${schedule.day})`,
          ),
        );
      }
    }
  }
}
