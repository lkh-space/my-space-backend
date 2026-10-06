import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AssetService } from './asset.service.js';
import { MinioService } from '@app/storage/minio/minio.service.js';
import { InvalidAssetException } from '../exceptions/markdown.exception.js';
import { ForbiddenException } from '@nestjs/common';
import { Readable } from 'node:stream';

describe('AssetService', () => {
  let service: AssetService;
  let minioService: MinioService;

  beforeEach(() => {
    minioService = {
      assetsBucket: 'my-space-assets',
      putObject: vi.fn().mockResolvedValue(undefined),
      getObjectStream: vi.fn(),
    } as unknown as MinioService;

    service = new AssetService(minioService);
  });

  describe('uploadAsset', () => {
    it('유효한 PNG 이미지 파일 업로드 시 MinIO에 저장하고 접근 URL을 반환해야 한다', async () => {
      // given
      const ownerId = 'admin';
      // PNG 매직 바이트: 89 50 4E 47
      const validPngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x00]);
      const file: Express.Multer.File = {
        fieldname: 'file',
        originalname: 'test.png',
        encoding: '7bit',
        mimetype: 'image/png',
        buffer: validPngBuffer,
        size: validPngBuffer.length,
        destination: '',
        filename: '',
        path: '',
        stream: null as never,
      };

      // when
      const result = await service.uploadAsset(ownerId, file);

      // then
      expect(result.url).toMatch(/^\/api\/v1\/markdown\/assets\/images\/admin\/.+-test\.png$/);
      expect(result.contentType).toBe('image/png');
      expect(minioService.putObject).toHaveBeenCalledWith(
        'my-space-assets',
        result.key,
        validPngBuffer,
        'image/png',
      );
    });

    it('허용되지 않은 MIME 타입 파일은 InvalidAssetException을 던져야 한다', async () => {
      // given
      const ownerId = 'admin';
      const file: Express.Multer.File = {
        fieldname: 'file',
        originalname: 'script.sh',
        encoding: '7bit',
        mimetype: 'application/x-sh',
        buffer: Buffer.from('#!/bin/bash'),
        size: 11,
        destination: '',
        filename: '',
        path: '',
        stream: null as never,
      };

      // when & then
      await expect(service.uploadAsset(ownerId, file)).rejects.toThrow(
        InvalidAssetException,
      );
    });
  });

  describe('getAssetStream', () => {
    it('다른 사용자의 에셋 경로에 접근하면 ForbiddenException을 던져야 한다', async () => {
      // given
      const ownerId = 'user-a';
      const otherUserKey = 'images/user-b/uuid-image.png';

      // when & then
      await expect(
        service.getAssetStream(ownerId, otherUserKey),
      ).rejects.toThrow(ForbiddenException);
    });

    it('자신의 에셋 경로에 접근하면 스트림을 정상 반환해야 한다', async () => {
      // given
      const ownerId = 'user-a';
      const validKey = 'images/user-a/uuid-image.png';
      const mockStream = new Readable();

      vi.mocked(minioService.getObjectStream).mockResolvedValueOnce({
        stream: mockStream,
        contentType: 'image/png',
        contentLength: 1024,
      });

      // when
      const result = await service.getAssetStream(ownerId, validKey);

      // then
      expect(result.contentType).toBe('image/png');
      expect(result.stream).toBe(mockStream);
    });
  });
});
