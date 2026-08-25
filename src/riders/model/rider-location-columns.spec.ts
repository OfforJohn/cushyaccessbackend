import { getMetadataArgsStorage } from 'typeorm';
import { Rider } from './rider.entity';

describe('Rider location columns', () => {
  it.each(['currentLatitude', 'currentLongitude'])(
    '%s stores decimal GPS coordinates',
    (propertyName) => {
      const column = getMetadataArgsStorage().columns.find(
        (candidate) =>
          candidate.target === Rider && candidate.propertyName === propertyName,
      );

      expect(column?.options.type).toBe('double precision');
      expect(column?.options.nullable).toBe(true);
    },
  );
});
