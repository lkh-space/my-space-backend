import { Injectable, NotFoundException } from '@nestjs/common';
import { Readable } from 'node:stream';
import type {
  QdrantPointPayload,
  QdrantSearchResult,
} from '@app/storage/qdrant/qdrant.service.js';

@Injectable()
export class FakeMinioService {
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
      throw new NotFoundException(`스토리지에서 파일을 찾을 수 없습니다: ${key}`);
    }
    return item.body.toString('utf-8');
  }

  async getObjectStream(
    bucket: string,
    key: string,
  ): Promise<{ stream: Readable; contentType?: string; contentLength?: number }> {
    const item = this.storage.get(`${bucket}:${key}`);
    if (!item) {
      throw new NotFoundException(`스토리지에서 파일을 찾을 수 없습니다: ${key}`);
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

  clear(): void {
    this.storage.clear();
  }
}

@Injectable()
export class FakeOpenSearchService {
  async indexDocument(_doc: unknown): Promise<void> {}
  async deleteDocument(_id: string): Promise<void> {}
  async searchDocuments(_options: unknown): Promise<{ total: number; hits: unknown[] }> {
    return { total: 0, hits: [] };
  }
}

@Injectable()
export class FakeRabbitmqService {
  readonly indexingQueue = 'markdown-indexing-queue';

  async publish(_queue: string, _message: unknown): Promise<boolean> {
    return true;
  }

  async consume(): Promise<void> {}
}

@Injectable()
export class FakeQdrantService {
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

  async deletePointsByDocument(ownerId: string, documentId: string): Promise<void> {
    this.points = this.points.filter(
      (p) => !(p.payload.ownerId === ownerId && p.payload.documentId === documentId),
    );
  }

  async searchPoints(
    ownerId: string,
    _vector: number[],
    limit = 5,
    filterOptions?: { folderId?: string | null; tags?: string[] },
  ): Promise<QdrantSearchResult[]> {
    let matched = this.points.filter((p) => p.payload.ownerId === ownerId);

    if (filterOptions?.folderId !== undefined && filterOptions.folderId !== null) {
      matched = matched.filter((p) => p.payload.folderId === filterOptions.folderId);
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

  getAllPoints(): Array<{ id: string; vector: number[]; payload: QdrantPointPayload }> {
    return [...this.points];
  }

  clear(): void {
    this.points = [];
  }
}

