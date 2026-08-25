import { getMetadataArgsStorage } from 'typeorm';
import { DaySchedule } from './day-schedules';
import { OpeningSchedule } from './opening-schedule.entity';

describe('OpeningSchedule relation metadata', () => {
  it('uses the existing storeId column as the owning store join column', () => {
    const joinColumn = getMetadataArgsStorage().joinColumns.find(
      ({ target, propertyName }) =>
        target === OpeningSchedule && propertyName === 'store',
    );

    expect(joinColumn?.name).toBe('storeId');
  });

  it('uses the existing foreign-key columns for users and day schedules', () => {
    const joinColumns = getMetadataArgsStorage().joinColumns;

    expect(
      joinColumns.find(
        ({ target, propertyName }) =>
          target === OpeningSchedule && propertyName === 'user',
      )?.name,
    ).toBe('userId');
    expect(
      joinColumns.find(
        ({ target, propertyName }) =>
          target === DaySchedule && propertyName === 'openingSchedule',
      )?.name,
    ).toBe('openingScheduleId');
  });

  it('does not retrofit unsafe constraints onto historical schedule rows', () => {
    const relations = getMetadataArgsStorage().relations;
    const storeRelation = relations.find(
      ({ target, propertyName }) =>
        target === OpeningSchedule && propertyName === 'store',
    );
    const userRelation = relations.find(
      ({ target, propertyName }) =>
        target === OpeningSchedule && propertyName === 'user',
    );

    expect(storeRelation?.options.createForeignKeyConstraints).toBe(false);
    expect(userRelation?.options.createForeignKeyConstraints).toBe(false);
  });
});
