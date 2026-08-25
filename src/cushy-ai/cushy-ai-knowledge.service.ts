import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AiKnowledgeArticle } from './model/entity/ai-knowledge-article.entity';
import { StandardResponse } from '../common/module/standard-response';

@Injectable()
export class CushyAiKnowledgeService {
  constructor(
    @InjectRepository(AiKnowledgeArticle)
    private readonly repository: Repository<AiKnowledgeArticle>,
  ) {}

  async search(query: string) {
    const ignored = new Set([
      'about',
      'can',
      'could',
      'does',
      'how',
      'please',
      'tell',
      'that',
      'the',
      'this',
      'what',
      'when',
      'where',
      'which',
      'with',
      'would',
      'you',
      'your',
    ]);
    const terms = query
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((term) => term.length >= 3 && !ignored.has(term))
      .filter((term, index, all) => all.indexOf(term) === index)
      .slice(0, 8);
    if (!terms.length) return [];
    const qb = this.repository
      .createQueryBuilder('article')
      .where('article.isPublished = :published', { published: true });
    qb.andWhere(
      `(${terms
        .map(
          (_, index) =>
            `(LOWER(article.title) LIKE :term${index} OR LOWER(article.content) LIKE :term${index})`,
        )
        .join(' OR ')})`,
      Object.fromEntries(
        terms.map((term, index) => [`term${index}`, `%${term}%`]),
      ),
    );
    const relevance = terms
      .map(
        (_, index) =>
          `(CASE WHEN LOWER(article.title) LIKE :term${index} THEN 3 ELSE 0 END + CASE WHEN LOWER(article.content) LIKE :term${index} THEN 1 ELSE 0 END)`,
      )
      .join(' + ');
    return qb
      .addSelect(`(${relevance})`, 'relevance')
      .orderBy('relevance', 'DESC')
      .addOrderBy('article.updatedAt', 'DESC')
      .take(6)
      .getMany();
  }

  async list(): Promise<StandardResponse> {
    return new StandardResponse(
      false,
      'AI_KNOWLEDGE_FETCHED',
      await this.repository.find({ order: { updatedAt: 'DESC' } }),
    );
  }

  async create(payload: {
    title: string;
    category?: string;
    content: string;
    isPublished?: boolean;
  }): Promise<StandardResponse> {
    const article = await this.repository.save(
      this.repository.create({
        title: this.requiredTrimmed(
          payload.title,
          3,
          'AI_KNOWLEDGE_TITLE_INVALID',
        ),
        category: payload.category?.trim() || null,
        content: this.requiredTrimmed(
          payload.content,
          10,
          'AI_KNOWLEDGE_CONTENT_INVALID',
        ),
        isPublished: payload.isPublished ?? true,
      }),
    );
    return new StandardResponse(false, 'AI_KNOWLEDGE_CREATED', article);
  }

  async update(
    id: string,
    payload: Partial<{
      title: string;
      category: string;
      content: string;
      isPublished: boolean;
    }>,
  ): Promise<StandardResponse> {
    const changes: Partial<AiKnowledgeArticle> = {};
    if (payload.title !== undefined)
      changes.title = this.requiredTrimmed(
        payload.title,
        3,
        'AI_KNOWLEDGE_TITLE_INVALID',
      );
    if (payload.category !== undefined)
      changes.category = payload.category.trim() || null;
    if (payload.content !== undefined)
      changes.content = this.requiredTrimmed(
        payload.content,
        10,
        'AI_KNOWLEDGE_CONTENT_INVALID',
      );
    if (payload.isPublished !== undefined)
      changes.isPublished = payload.isPublished;

    if (!Object.keys(changes).length) {
      throw new BadRequestException('AI_KNOWLEDGE_UPDATE_REQUIRED');
    }
    const result = await this.repository.update({ id }, changes);
    if (result.affected !== 1) {
      throw new NotFoundException('AI_KNOWLEDGE_NOT_FOUND');
    }
    const article = await this.repository.findOne({ where: { id } });
    if (!article) throw new NotFoundException('AI_KNOWLEDGE_NOT_FOUND');
    return new StandardResponse(false, 'AI_KNOWLEDGE_UPDATED', article);
  }

  async delete(id: string): Promise<StandardResponse> {
    const result = await this.repository.delete(id);
    if (result.affected !== 1)
      throw new NotFoundException('AI_KNOWLEDGE_NOT_FOUND');
    return new StandardResponse(false, 'AI_KNOWLEDGE_DELETED', { id });
  }

  private requiredTrimmed(
    value: string,
    minimumLength: number,
    errorCode: string,
  ): string {
    const normalized = value.trim();
    if (normalized.length < minimumLength)
      throw new BadRequestException(errorCode);
    return normalized;
  }
}
