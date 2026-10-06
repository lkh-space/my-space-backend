import { Injectable, Logger } from '@nestjs/common';
import { QdrantService } from '@app/storage/qdrant/qdrant.service.js';
import { ProviderFactory } from '../providers/provider.factory.js';
import { AiSearchDto, AiSearchResponseDto } from './dto/ai-search.dto.js';

@Injectable()
export class AiSearchService {
  private readonly logger = new Logger(AiSearchService.name);

  constructor(
    private readonly qdrantService: QdrantService,
    private readonly providerFactory: ProviderFactory,
  ) {}

  async search(ownerId: string, dto: AiSearchDto): Promise<AiSearchResponseDto> {
    const limit = dto.limit || 5;
    const embeddingProvider = this.providerFactory.getEmbeddingProvider();

    this.logger.log(
      `[AiSearch] 시맨틱 검색 수행 (owner=${ownerId}, query="${dto.query}", limit=${limit})`,
    );

    // 1. 질의어 768차원 임베딩 생성
    const vector = await embeddingProvider.embedText(dto.query);

    // 2. Qdrant 벡터 검색 (ownerId 격리 필터)
    const points = await this.qdrantService.searchPoints(ownerId, vector, limit, {
      folderId: dto.folderId,
      tags: dto.tags,
    });

    const results = points.map((p: any) => ({
      documentId: p.payload.documentId,
      title: p.payload.title,
      heading: p.payload.heading,
      content: p.payload.content,
      score: Number(p.score.toFixed(4)),
      tags: p.payload.tags,
    }));

    return {
      results,
      total: results.length,
    };
  }
}
