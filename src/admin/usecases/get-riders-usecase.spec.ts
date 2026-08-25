import { OnboardingType } from 'src/onboarding/model/stage.enum';
import { Rider, RiderStatus } from 'src/riders/model/rider.entity';
import {
  DocumentStatus,
  DocumentType,
} from 'src/riders/model/rider-document.entity';
import { GetRiderUseCase } from './get-riders-usecase';

describe('GetRiderUseCase', () => {
  it('uses mobile onboarding as phone truth and keeps document URLs out of the list payload', async () => {
    const queryBuilder: any = {};
    queryBuilder.leftJoin = jest.fn().mockReturnValue(queryBuilder);
    queryBuilder.addSelect = jest.fn().mockReturnValue(queryBuilder);
    queryBuilder.orderBy = jest.fn().mockReturnValue(queryBuilder);
    queryBuilder.getMany = jest.fn().mockResolvedValue([
      {
        id: 'rider_1',
        userId: 'user_1',
        status: RiderStatus.DOCUMENT_VERIFICATION,
        rating: 5,
        documents: [
          {
            id: 'doc_1',
            riderId: 'rider_1',
            documentType: DocumentType.ID_CARD,
            documentUrl: 'https://private.example/nin.jpg',
            status: DocumentStatus.PENDING,
          },
        ],
        user: {
          firstName: 'Ada',
          lastName: 'Rider',
          mobile: '8012345678',
          isVerified: false,
          onboardings: [
            { onboardingType: OnboardingType.MOBILE_VERIFIED },
          ],
        },
      } as Rider,
    ]);
    const useCase = new GetRiderUseCase({
      createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
    } as never);

    const response = await useCase.execute();
    const [rider] = (response as any).data;

    expect(rider.isVerified).toBe(true);
    expect(rider.hasNIN).toBe(false);
    expect(rider.documents).toEqual([
      {
        id: 'doc_1',
        type: DocumentType.ID_CARD,
        status: DocumentStatus.PENDING,
      },
    ]);
  });
});
