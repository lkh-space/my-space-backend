import { Injectable, NotFoundException } from '@nestjs/common';
import { Readable } from 'node:stream';

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
