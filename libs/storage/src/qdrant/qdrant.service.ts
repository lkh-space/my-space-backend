import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { QdrantClient } from '@qdrant/js-client-rest';

export interface QdrantPointPayload {
  ownerId: string;
  documentId: string;
  version?: number;
  chunkIndex: number;
  title: string;
  heading: string;
  content: string;
  tags?: string[];
  folderId?: string | null;
  embeddingModel?: string;
  [key: string]: unknown;
}

export interface QdrantSearchResult {
  id: string | number;
  score: number;
  payload: QdrantPointPayload;
}

@Injectable()
export class QdrantService implements OnModuleInit {
  private readonly logger = new Logger(QdrantService.name);
  private client!: QdrantClient;
  public readonly collectionName: string;
  public readonly vectorDimension = 768;

  constructor(private readonly configService: ConfigService) {
    const url = this.configService.get<string>('qdrant.url', 'http://localhost:6333');
    const apiKey = this.configService.get<string>('qdrant.apiKey', '');
    this.collectionName = this.configService.get<string>(
      'qdrant.collection',
      'personal-documents',
    );

    this.client = new QdrantClient({
      url,
      apiKey: apiKey || undefined,
      checkCompatibility: false,
      timeout: 10000,
    });
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.ensureCollection();
      this.logger.log(
        `Qdrant 연결 및 컬렉션 초기화 완료 [collection=${this.collectionName}, dim=${this.vectorDimension}]`,
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Qdrant 초기화 에러 (연결 상태 확인 필요): ${message}`);
    }
  }

  /**
   * 컬렉션 및 페이로드 키워드 인덱스 자동 보장 및 메타데이터 검증
   */
  async ensureCollection(): Promise<void> {
    const { collections } = await this.client.getCollections();
    const exists = collections.some((c) => c.name === this.collectionName);

    if (!exists) {
      this.logger.log(
        `Qdrant 컬렉션이 존재하지 않아 신규 생성합니다: ${this.collectionName}`,
      );
      await this.client.createCollection(this.collectionName, {
        vectors: {
          size: this.vectorDimension,
          distance: 'Cosine',
        },
      });

      // 빠른 필터링을 위한 페이로드 키워드 인덱스 생성
      const indexFields = ['ownerId', 'documentId', 'tags', 'folderId', 'embeddingModel'];
      for (const field_name of indexFields) {
        try {
          await this.client.createPayloadIndex(this.collectionName, {
            field_name,
            field_schema: 'keyword',
          });
        } catch {
          // 인덱스 생성 에러는 무시
        }
      }
    } else {
      // 기존 컬렉션의 벡터 차원 및 거리 함수 검증 (M-11)
      try {
        const info = await this.client.getCollection(this.collectionName);
        const vectorsConfig = info.config?.params?.vectors;
        if (vectorsConfig && typeof vectorsConfig === 'object') {
          const size = 'size' in vectorsConfig ? (vectorsConfig as Record<string, unknown>).size : undefined;
          const distance = 'distance' in vectorsConfig ? (vectorsConfig as Record<string, unknown>).distance : undefined;
          if (size !== undefined && size !== this.vectorDimension) {
            this.logger.error(
              `[QdrantService] 컬렉션 '${this.collectionName}'의 벡터 차원(${size})이 시스템 설정(${this.vectorDimension})과 불일치합니다!`,
            );
          }
          if (distance !== undefined && distance !== 'Cosine') {
            this.logger.warn(
              `[QdrantService] 컬렉션 '${this.collectionName}'의 거리 함수(${distance})가 'Cosine'이 아닙니다.`,
            );
          }
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(`[QdrantService] 기존 컬렉션 메타데이터 검증 실패: ${message}`);
      }
    }
  }

  /**
   * 청크 포인트 배치 Upsert
   */
  async upsertPoints(
    points: Array<{
      id: string;
      vector: number[];
      payload: QdrantPointPayload;
    }>,
  ): Promise<void> {
    if (points.length === 0) return;

    await this.client.upsert(this.collectionName, {
      wait: true,
      points: points.map((p) => ({
        id: p.id,
        vector: p.vector,
        payload: p.payload,
      })),
    });
  }

  /**
   * 특정 사용자의 특정 문서에 속한 모든 포인트 삭제
   */
  async deletePointsByDocument(ownerId: string, documentId: string): Promise<void> {
    try {
      await this.client.delete(this.collectionName, {
        wait: true,
        filter: {
          must: [
            { key: 'ownerId', match: { value: ownerId } },
            { key: 'documentId', match: { value: documentId } },
          ],
        },
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`문서 포인트 삭제 중 에러 발생 (docId=${documentId}): ${message}`);
    }
  }

  /**
   * 특정 문서의 구버전(version < currentVersion) 포인트만 선택적으로 삭제
   * (Zero-downtime Upsert 후 이전 잔여 청크 정리용)
   */
  async deleteOldVersionsByDocument(
    ownerId: string,
    documentId: string,
    currentVersion: number,
  ): Promise<void> {
    try {
      await this.client.delete(this.collectionName, {
        wait: true,
        filter: {
          must: [
            { key: 'ownerId', match: { value: ownerId } },
            { key: 'documentId', match: { value: documentId } },
            { key: 'version', range: { lt: currentVersion } },
          ],
        },
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `구버전 포인트 삭제 중 에러 발생 (docId=${documentId}, ver < ${currentVersion}): ${message}`,
      );
    }
  }

  /**
   * 특정 문서의 현재 색인된 최고 버전 조회 (Out-of-order 늦은 이벤트 덮어쓰기 방어용)
   */
  async getLatestVersionForDocument(
    ownerId: string,
    documentId: string,
  ): Promise<number | null> {
    try {
      const response = await this.client.scroll(this.collectionName, {
        filter: {
          must: [
            { key: 'ownerId', match: { value: ownerId } },
            { key: 'documentId', match: { value: documentId } },
          ],
        },
        limit: 10,
        with_payload: true,
        with_vector: false,
      });

      const points = response.points || [];
      if (points.length === 0) {
        return null;
      }

      let maxVersion: number | null = null;
      for (const p of points) {
        const payload = p.payload as QdrantPointPayload | undefined;
        if (payload?.version !== undefined && payload.version !== null) {
          const ver = Number(payload.version);
          if (maxVersion === null || ver > maxVersion) {
            maxVersion = ver;
          }
        }
      }
      return maxVersion;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `문서 버전 조회 중 에러 발생 (docId=${documentId}): ${message}`,
      );
      return null;
    }
  }

  /**
   * ownerId 격리 필터 적용 시맨틱 검색
   */
  async searchPoints(
    ownerId: string,
    vector: number[],
    limit = 5,
    filterOptions?: {
      folderId?: string | null;
      tags?: string[];
      embeddingModel?: string;
    },
  ): Promise<QdrantSearchResult[]> {
    const mustFilters: Array<Record<string, unknown>> = [
      { key: 'ownerId', match: { value: ownerId } },
    ];

    if (filterOptions?.embeddingModel) {
      mustFilters.push({
        key: 'embeddingModel',
        match: { value: filterOptions.embeddingModel },
      });
    }

    if (filterOptions?.folderId) {
      mustFilters.push({ key: 'folderId', match: { value: filterOptions.folderId } });
    }

    if (filterOptions?.tags && filterOptions.tags.length > 0) {
      for (const tag of filterOptions.tags) {
        mustFilters.push({ key: 'tags', match: { value: tag } });
      }
    }

    const response = await this.client.query(this.collectionName, {
      query: vector,
      limit,
      filter: {
        must: mustFilters,
      },
      with_payload: true,
    });

    const points = response.points || [];
    return points.map((r: { id: string | number; score: number; payload?: unknown }) => ({
      id: r.id,
      score: r.score,
      payload: (r.payload as unknown as QdrantPointPayload) || {
        ownerId,
        documentId: '',
        chunkIndex: 0,
        title: '',
        heading: '',
        content: '',
      },
    }));
  }

  getClient(): QdrantClient {
    return this.client;
  }

  async checkHealth(): Promise<void> {
    if (!this.client) {
      throw new Error('Qdrant 클라이언트가 초기화되지 않았습니다');
    }
    await this.client.getCollections();
  }
}

