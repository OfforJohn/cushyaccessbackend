import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { StandardResponse } from 'src/common/module/standard-response';
import { Rider } from 'src/riders/model/rider.entity';
import { RiderDocument } from 'src/riders/model/rider-document.entity';

@Injectable()
export class GetRiderDocumentsUseCase {
  constructor(
    @InjectRepository(Rider)
    private readonly riderRepository: Repository<Rider>,
    @InjectRepository(RiderDocument)
    private readonly documentRepository: Repository<RiderDocument>,
  ) {}

  async execute(riderId: string): Promise<StandardResponse> {
    const riderExists = await this.riderRepository.exists({
      where: { id: riderId },
    });
    if (!riderExists) {
      throw new NotFoundException(
        new StandardResponse(true, 'RIDER_NOT_FOUND'),
      );
    }

    const documents = await this.documentRepository.find({
      where: { riderId },
      order: { uploadedAt: 'ASC' },
    });
    return new StandardResponse(
      false,
      'RIDER_DOCUMENTS_FETCHED',
      documents.map((document) => ({
        id: document.id,
        type: document.documentType,
        status: document.status,
        url: document.documentUrl,
        documentNumber: document.documentNumber || null,
        expiryDate: document.expiryDate || null,
        verificationNotes: document.verificationNotes || null,
        verifiedBy: document.verifiedBy || null,
        verifiedAt: document.verifiedAt || null,
        uploadedAt: document.uploadedAt,
      })),
    );
  }
}
