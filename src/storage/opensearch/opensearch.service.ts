import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client } from '@opensearch-project/opensearch';

export interface IndexedDocument {
  id: string;
  title: string;
  body: string;
  tags: string[];
  folderId?: string | null;
  ownerId: string;
  updatedAt: string;
}

export interface SearchOptions {
  query: string;
  ownerId: string;
  folderId?: string;
  tag?: string;
  limit?: number;
  offset?: number;
}

export interface SearchHitResult {
  id: string;
  title: string;
  tags: string[];
  folderId?: string | null;
  updatedAt: string;
  score: number;
  snippet?: string;
}

@Injectable()
export class OpenSearchService implements OnModuleInit {
  private readonly logger = new Logger(OpenSearchService.name);
  private client!: Client;
  private indexName!: string;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    const node = this.configService.get<string>(
      'opensearch.node',
      'http://localhost:9200',
    );
    const username = this.configService.get<string>('opensearch.username', '');
    const password = this.configService.get<string>('opensearch.password', '');
    const rejectUnauthorized = this.configService.get<boolean>(
      'opensearch.rejectUnauthorized',
      false,
    );
    this.indexName = this.configService.get<string>(
      'opensearch.indexDocuments',
      'markdown-documents',
    );

    const clientOptions: Record<string, unknown> = {
      node,
      ssl: {
        rejectUnauthorized,
      },
    };

    if (username && password) {
      clientOptions.auth = {
        username,
        password,
      };
    }

    this.client = new Client(clientOptions);
    this.logger.log(`OpenSearch Client 초기화 완료 (Node: ${node}, Index: ${this.indexName})`);

    this.ensureIndex().catch((err) => {
      this.logger.warn(`OpenSearch 인덱스 초기화 중 알림: ${(err as Error).message}`);
    });
  }

  /**
   * 문서 검색용 인덱스 생성 및 매핑 보장
   */
  async ensureIndex(): Promise<void> {
    try {
      const exists = await this.client.indices.exists({ index: this.indexName });
      if (!exists.body) {
        await this.client.indices.create({
          index: this.indexName,
          body: {
            settings: {
              number_of_shards: 1,
              number_of_replicas: 0,
            },
            mappings: {
              properties: {
                id: { type: 'keyword' },
                title: { type: 'text', boost: 3 },
                body: { type: 'text' },
                tags: { type: 'keyword' },
                folderId: { type: 'keyword' },
                ownerId: { type: 'keyword' },
                updatedAt: { type: 'date' },
              },
            },
          },
        });
        this.logger.log(`OpenSearch 인덱스 생성 완료: ${this.indexName}`);
      }
    } catch (error) {
      this.logger.warn(`OpenSearch 인덱스 확인/생성 에러: ${(error as Error).message}`);
    }
  }

  /**
   * 문서 색인 (생성 또는 갱신)
   */
  async indexDocument(doc: IndexedDocument): Promise<void> {
    try {
      await this.client.index({
        index: this.indexName,
        id: doc.id,
        body: doc,
        refresh: true,
      });
    } catch (error) {
      this.logger.error(`문서(${doc.id}) OpenSearch 색인 실패: ${(error as Error).message}`);
    }
  }

  /**
   * 문서 색인 삭제
   */
  async deleteDocument(id: string): Promise<void> {
    try {
      await this.client.delete({
        index: this.indexName,
        id,
        refresh: true,
      });
    } catch (error) {
      this.logger.warn(`문서(${id}) OpenSearch 색인 삭제 중 알림: ${(error as Error).message}`);
    }
  }

  /**
   * 본문 및 제목, 태그 기반 검색 (하이라이트 및 필터 지원)
   */
  async search(options: SearchOptions): Promise<{ total: number; hits: SearchHitResult[] }> {
    try {
      const mustClauses: Record<string, unknown>[] = [];
      const filterClauses: Record<string, unknown>[] = [
        { term: { ownerId: options.ownerId } },
      ];

      if (options.folderId) {
        filterClauses.push({ term: { folderId: options.folderId } });
      }

      if (options.tag) {
        filterClauses.push({ term: { tags: options.tag } });
      }

      if (options.query && options.query.trim().length > 0) {
        mustClauses.push({
          multi_match: {
            query: options.query,
            fields: ['title^3', 'tags^2', 'body^1'],
            fuzziness: 'AUTO',
          },
        });
      } else {
        mustClauses.push({ match_all: {} });
      }

      const response = await this.client.search({
        index: this.indexName,
        body: {
          from: options.offset ?? 0,
          size: options.limit ?? 20,
          query: {
            bool: {
              must: mustClauses,
              filter: filterClauses,
            },
          },
          highlight: {
            fields: {
              body: {
                fragment_size: 100,
                number_of_fragments: 2,
              },
            },
          },
        },
      });

      const rawHits = response.body.hits;
      const total =
        typeof rawHits.total === 'number'
          ? rawHits.total
          : (rawHits.total?.value ?? 0);

      const hits: SearchHitResult[] = (rawHits.hits as Array<{
        _id: string;
        _score: number;
        _source: IndexedDocument;
        highlight?: { body?: string[] };
      }>).map((hit) => {
        const source = hit._source;
        const snippet = hit.highlight?.body?.join(' ... ');
        return {
          id: source.id,
          title: source.title,
          tags: source.tags || [],
          folderId: source.folderId,
          updatedAt: source.updatedAt,
          score: hit._score || 0,
          snippet,
        };
      });

      return { total, hits };
    } catch (error) {
      this.logger.error(`OpenSearch 검색 실패: ${(error as Error).message}`);
      return { total: 0, hits: [] };
    }
  }
}
