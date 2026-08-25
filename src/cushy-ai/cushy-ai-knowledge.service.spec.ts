import { BadRequestException } from '@nestjs/common';
import { CushyAiKnowledgeService } from './cushy-ai-knowledge.service';

describe('CushyAiKnowledgeService validation', () => {
  const repository = {
    create: jest.fn((value) => value),
    save: jest.fn(async (value) => value),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
    findOne: jest.fn(),
    createQueryBuilder: jest.fn(),
  };
  const service = new CushyAiKnowledgeService(repository as any);

  beforeEach(() => jest.clearAllMocks());

  it('validates trimmed content rather than accepting whitespace padding', async () => {
    await expect(
      service.create({ title: 'Valid title', content: '          x' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repository.save).not.toHaveBeenCalled();
  });

  it('patches publication without overwriting concurrently edited fields', async () => {
    const article = {
      id: 'article_1',
      title: 'Current title',
      content: 'Current approved content',
      category: 'FAQ',
      isPublished: true,
    };
    repository.findOne.mockResolvedValue({ ...article, isPublished: false });

    await service.update(article.id, { isPublished: false });

    expect(repository.update).toHaveBeenCalledWith(
      { id: article.id },
      { isPublished: false },
    );
    expect(repository.save).not.toHaveBeenCalled();
  });

  it('drops generic question words and ranks title matches before recency', async () => {
    const qb: Record<string, jest.Mock> = {
      where: jest.fn(),
      andWhere: jest.fn(),
      addSelect: jest.fn(),
      orderBy: jest.fn(),
      addOrderBy: jest.fn(),
      take: jest.fn(),
      getMany: jest.fn().mockResolvedValue([]),
    };
    Object.values(qb).forEach((method) => {
      if (method !== qb.getMany) method.mockReturnValue(qb);
    });
    repository.createQueryBuilder.mockReturnValue(qb);

    await service.search('How can I fund my Cushcoin wallet?');

    const parameters = qb.andWhere.mock.calls[0][1];
    expect(Object.values(parameters)).not.toContain('%how%');
    expect(Object.values(parameters)).toEqual(
      expect.arrayContaining(['%fund%', '%cushcoin%', '%wallet%']),
    );
    expect(qb.addSelect).toHaveBeenCalledWith(
      expect.stringContaining('CASE WHEN LOWER(article.title)'),
      'relevance',
    );
    expect(qb.orderBy).toHaveBeenCalledWith('relevance', 'DESC');
  });
});
