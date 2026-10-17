import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { MinioService } from './minio.service.js';
import { DeleteObjectsCommand } from '@aws-sdk/client-s3';

describe('MinioService (BDD 단위 테스트)', () => {
  let service: MinioService;
  let mockConfigService: ConfigService;
  let mockS3Send: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockConfigService = {
      get: vi.fn((key: string) => {
        if (key === 'MINIO_ENDPOINT') return 'localhost';
        if (key === 'MINIO_PORT') return '9000';
        if (key === 'MINIO_ACCESS_KEY') return 'minioadmin';
        if (key === 'MINIO_SECRET_KEY') return 'minioadmin';
        if (key === 'MINIO_DOCS_BUCKET') return 'my-space-markdown';
        if (key === 'MINIO_ASSETS_BUCKET') return 'my-space-assets';
        return undefined;
      }),
    } as unknown as ConfigService;

    service = new MinioService(mockConfigService);
    mockS3Send = vi.fn().mockResolvedValue({});
    (service as any).client = {
      send: mockS3Send,
    };
    (service as any).bucketDocs = 'my-space-markdown';
    (service as any).bucketAssets = 'my-space-assets';
  });

  describe('deleteObjects (일괄 배치 삭제)', () => {
    it('여러 개의 키가 주어지면 DeleteObjectsCommand를 호출하여 한 번에 삭제해야 한다', async () => {
      // given
      const bucket = 'my-space-markdown';
      const keys = ['docs/doc-1.md', 'docs/doc-1/rev1.md', 'docs/doc-1/rev2.md'];

      // when
      await service.deleteObjects(bucket, keys);

      // then
      expect(mockS3Send).toHaveBeenCalledTimes(1);
      const command = mockS3Send.mock.calls[0][0];
      expect(command).toBeInstanceOf(DeleteObjectsCommand);
      expect(command.input).toEqual({
        Bucket: bucket,
        Delete: {
          Objects: [{ Key: 'docs/doc-1.md' }, { Key: 'docs/doc-1/rev1.md' }, { Key: 'docs/doc-1/rev2.md' }],
          Quiet: true,
        },
      });
    });

    it('빈 키 배열이 전달되면 S3 요청을 호출하지 않아야 한다', async () => {
      // given
      const bucket = 'my-space-markdown';
      const keys: string[] = [];

      // when
      await service.deleteObjects(bucket, keys);

      // then
      expect(mockS3Send).not.toHaveBeenCalled();
    });
  });
});
