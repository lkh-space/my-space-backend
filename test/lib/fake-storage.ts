import type { MinioService } from '@app/storage/minio/minio.service.js';
import type {
  IndexedDocument,
  OpenSearchService,
  SearchHitResult,
  SearchOptions,
} from '@app/storage/opensearch/opensearch.service.js';
import type {
  QdrantPointPayload,
  QdrantSearchResult,
  QdrantService,
} from '@app/storage/qdrant/qdrant.service.js';
import type { RabbitmqService } from '@app/storage/rabbitmq/rabbitmq.service.js';
import { Injectable, NotFoundException } from '@nestjs/common';
import { Readable } from 'node:stream';

@Injectable()
export class FakeMinioService implements Pick<
  MinioService,
  | 'docsBucket'
  | 'assetsBucket'
  | 'putObject'
  | 'getObjectAsString'
  | 'getObjectStream'
  | 'deleteObject'
  | 'deleteObjects'
> {
  private readonly storage = new Map<
    string,
    { body: Buffer; contentType: string }
  >();

  get docsBucket(): string {
    return 'test-markdown-docs';
  }

  get assetsBucket(): string {
    return 'test-markdown-assets';
  }

  async ensureBuckets(): Promise<void> {}

  async putObject(
    bucket: string,
    key: string,
    body: string | Buffer,
    contentType = 'text/markdown; charset=utf-8',
  ): Promise<void> {
    const buffer = Buffer.isBuffer(body) ? body : Buffer.from(body, 'utf-8');
    this.storage.set(`${bucket}:${key}`, { body: buffer, contentType });
  }

  async getObjectAsString(bucket: string, key: string): Promise<string> {
    const item = this.storage.get(`${bucket}:${key}`);
    if (!item) {
      throw new NotFoundException(
        `스토리지에서 파일을 찾을 수 없습니다: ${key}`,
      );
    }
    return item.body.toString('utf-8');
  }

  async getObjectStream(
    bucket: string,
    key: string,
  ): Promise<{
    stream: Readable;
    contentType?: string;
    contentLength?: number;
  }> {
    const item = this.storage.get(`${bucket}:${key}`);
    if (!item) {
      throw new NotFoundException(
        `스토리지에서 파일을 찾을 수 없습니다: ${key}`,
      );
    }
    const stream = Readable.from(item.body);
    return {
      stream,
      contentType: item.contentType,
      contentLength: item.body.length,
    };
  }

  async deleteObject(bucket: string, key: string): Promise<void> {
    this.storage.delete(`${bucket}:${key}`);
  }

  async deleteObjects(bucket: string, keys: string[]): Promise<void> {
    for (const key of keys) {
      this.storage.delete(`${bucket}:${key}`);
    }
  }

  clear(): void {
    this.storage.clear();
  }
}

@Injectable()
export class FakeOpenSearchService implements Pick<
  OpenSearchService,
  'indexDocument' | 'deleteDocument' | 'search' | 'ensureIndex'
> {
  private readonly docs = new Map<string, IndexedDocument>();

  async ensureIndex(): Promise<void> {}

  async indexDocument(
    doc: IndexedDocument,
    _options?: { refresh?: boolean | 'wait_for' },
  ): Promise<void> {
    this.docs.set(doc.id, { ...doc });
  }

  async deleteDocument(
    id: string,
    _options?: { refresh?: boolean | 'wait_for' },
  ): Promise<void> {
    this.docs.delete(id);
  }

  /**
   * 실제 OpenSearchService.search 시그니처와 완전히 일치하는 검색 모사
   */
  async search(
    options: SearchOptions,
  ): Promise<{ total: number; hits: SearchHitResult[] }> {
    let filtered = Array.from(this.docs.values()).filter(
      (d) => d.ownerId === options.ownerId,
    );

    if (options.folderId) {
      filtered = filtered.filter((d) => d.folderId === options.folderId);
    }

    if (options.tag) {
      const lowerTag = options.tag.toLowerCase();
      filtered = filtered.filter((d) =>
        (d.tags || []).some((t) => t.toLowerCase() === lowerTag),
      );
    }

    if (options.query && options.query.trim().length > 0) {
      const q = options.query.toLowerCase();
      filtered = filtered.filter(
        (d) =>
          d.title.toLowerCase().includes(q) ||
          d.body.toLowerCase().includes(q) ||
          (d.tags || []).some((t) => t.toLowerCase().includes(q)),
      );
    }

    const total = filtered.length;
    const offset = options.offset ?? 0;
    const limit = options.limit ?? 20;
    const paged = filtered.slice(offset, offset + limit);

    const hits: SearchHitResult[] = paged.map((d) => ({
      id: d.id,
      title: d.title,
      tags: d.tags,
      folderId: d.folderId,
      updatedAt: d.updatedAt,
      score: 1.0,
      snippet: d.body.slice(0, 150),
    }));

    return { total, hits };
  }

  clear(): void {
    this.docs.clear();
  }
}

@Injectable()
export class FakeRabbitmqService implements Pick<
  RabbitmqService,
  'indexingQueue' | 'publish' | 'consume'
> {
  readonly indexingQueue = 'markdown-indexing-queue';

  async publish(
    _queue: string,
    _message: unknown,
    _options?: { headers?: Record<string, unknown> },
  ): Promise<boolean> {
    return true;
  }

  async consume(): Promise<void> {}
}

@Injectable()
export class FakeQdrantService implements Pick<
  QdrantService,
  | 'collectionName'
  | 'vectorDimension'
  | 'ensureCollection'
  | 'upsertPoints'
  | 'deletePointsByDocument'
  | 'deleteOldVersionsByDocument'
  | 'getLatestVersionForDocument'
  | 'searchPoints'
> {
  readonly collectionName = 'test-personal-documents';
  readonly vectorDimension = 768;

  private points: Array<{
    id: string;
    vector: number[];
    payload: QdrantPointPayload;
  }> = [];

  async onModuleInit(): Promise<void> {}

  async ensureCollection(): Promise<void> {}

  async upsertPoints(
    points: Array<{
      id: string;
      vector: number[];
      payload: QdrantPointPayload;
    }>,
  ): Promise<void> {
    for (const p of points) {
      const idx = this.points.findIndex((item) => item.id === p.id);
      if (idx >= 0) {
        this.points[idx] = p;
      } else {
        this.points.push(p);
      }
    }
  }

  async deletePointsByDocument(
    ownerId: string,
    documentId: string,
  ): Promise<void> {
    this.points = this.points.filter(
      (p) =>
        !(p.payload.ownerId === ownerId && p.payload.documentId === documentId),
    );
  }

  async deleteOldVersionsByDocument(
    ownerId: string,
    documentId: string,
    currentVersion: number,
  ): Promise<void> {
    this.points = this.points.filter(
      (p) =>
        !(
          p.payload.ownerId === ownerId &&
          p.payload.documentId === documentId &&
          (p.payload.version ?? 0) < currentVersion
        ),
    );
  }

  async getLatestVersionForDocument(
    ownerId: string,
    documentId: string,
  ): Promise<number | null> {
    const matched = this.points.filter(
      (p) =>
        p.payload.ownerId === ownerId && p.payload.documentId === documentId,
    );
    if (matched.length === 0) return null;
    return Math.max(...matched.map((p) => Number(p.payload.version ?? 0)));
  }

  async searchPoints(
    ownerId: string,
    _vector: number[],
    limit = 5,
    filterOptions?: {
      folderId?: string | null;
      tags?: string[];
      embeddingModel?: string;
    },
  ): Promise<QdrantSearchResult[]> {
    let matched = this.points.filter((p) => p.payload.ownerId === ownerId);

    if (filterOptions?.embeddingModel) {
      matched = matched.filter(
        (p) =>
          !p.payload.embeddingModel ||
          p.payload.embeddingModel === filterOptions.embeddingModel,
      );
    }

    if (
      filterOptions?.folderId !== undefined &&
      filterOptions.folderId !== null
    ) {
      matched = matched.filter(
        (p) => p.payload.folderId === filterOptions.folderId,
      );
    }

    if (filterOptions?.tags && filterOptions.tags.length > 0) {
      matched = matched.filter((p) =>
        filterOptions.tags!.some((tag) => p.payload.tags?.includes(tag)),
      );
    }

    return matched.slice(0, limit).map((p, idx) => ({
      id: p.id,
      score: 0.95 - idx * 0.01,
      payload: p.payload,
    }));
  }

  getAllPoints(): Array<{
    id: string;
    vector: number[];
    payload: QdrantPointPayload;
  }> {
    return [...this.points];
  }

  clear(): void {
    this.points = [];
  }
}
