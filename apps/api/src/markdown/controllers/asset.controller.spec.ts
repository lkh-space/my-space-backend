import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AssetController } from './asset.controller.js';
import { AssetService } from '../services/asset.service.js';
import type { AuthUser } from '@app/common/guards/remote-user.guard.js';
import type { Response } from 'express';
import { Readable, Writable } from 'node:stream';

describe('AssetController (에셋 보안 헤더 및 스트리밍 단위 테스트)', () => {
  let controller: AssetController;
  let assetService: AssetService;

  const mockUser: AuthUser = {
    username: 'admin',
    groups: ['admins'],
  };

  beforeEach(() => {
    assetService = {
      uploadAsset: vi.fn(),
      getAssetStream: vi.fn(),
    } as unknown as AssetService;

    controller = new AssetController(assetService);
  });

  describe('uploadAsset', () => {
    it('업로드된 파일을 AssetService에 위임하여 처리해야 한다', async () => {
      // given
      const mockFile = { originalname: 'test.png' } as Express.Multer.File;
      const expectedResponse = {
        key: 'images/admin/uuid-test.png',
        filename: 'test.png',
        url: '/api/v1/markdown/assets/images/admin/uuid-test.png',
        contentType: 'image/png',
        size: 1024,
      };
      vi.mocked(assetService.uploadAsset).mockResolvedValueOnce(expectedResponse);

      // when
      const result = await controller.uploadAsset(mockUser, mockFile);

      // then
      expect(result).toEqual(expectedResponse);
      expect(assetService.uploadAsset).toHaveBeenCalledWith(mockUser.username, mockFile);
    });
  });

  describe('getAsset (보안 헤더 및 스트리밍 처리)', () => {
    function createMockResponse(): Response {
      const headers: Record<string, string | number> = {};
      const writable = new Writable({
        write(_chunk, _encoding, callback) {
          callback();
        },
      });

      const res = Object.assign(writable, {
        setHeader: vi.fn((name: string, value: string | number) => {
          headers[name.toLowerCase()] = value;
          return res;
        }),
        getHeader: vi.fn((name: string) => headers[name.toLowerCase()]),
        headers,
      }) as unknown as Response;

      return res;
    }

    it('일반 이미지 서빙 시 보안 헤더, private 캐시, inline Content-Disposition을 설정해야 한다', async () => {
      // given
      const sourceStream = Readable.from([Buffer.from('png-binary-data')]);
      vi.mocked(assetService.getAssetStream).mockResolvedValueOnce({
        stream: sourceStream,
        contentType: 'image/png',
        contentLength: 100,
      });

      const res = createMockResponse();

      // when
      await controller.getAsset(mockUser, ['images', 'admin', 'test.png'], res);

      // then
      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'image/png');
      expect(res.setHeader).toHaveBeenCalledWith('Content-Length', 100);
      expect(res.setHeader).toHaveBeenCalledWith('X-Content-Type-Options', 'nosniff');
      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Security-Policy',
        "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      );
      expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, max-age=86400');
      expect(res.setHeader).toHaveBeenCalledWith('Content-Disposition', 'inline');
    });

    it('SVG 서빙 시 XSS 방어를 위해 Content-Disposition: attachment 및 CSP sandbox를 적용해야 한다', async () => {
      // given
      const sourceStream = Readable.from([Buffer.from('<svg></svg>')]);
      vi.mocked(assetService.getAssetStream).mockResolvedValueOnce({
        stream: sourceStream,
        contentType: 'image/svg+xml',
        contentLength: 11,
      });

      const res = createMockResponse();

      // when
      await controller.getAsset(mockUser, 'images/admin/test.svg', res);

      // then
      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'image/svg+xml');
      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        'attachment; filename="test.svg"; filename*=UTF-8\'\'test.svg',
      );
      expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, max-age=86400');
      expect(res.setHeader).toHaveBeenCalledWith('X-Content-Type-Options', 'nosniff');
      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Security-Policy',
        "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      );
    });

    it('스트림 도중 클라이언트 연결 조기 종료(ERR_STREAM_PREMATURE_CLOSE)가 발생해도 프로세스가 다운되지 않아야 한다', async () => {
      // given
      const brokenStream = new Readable({
        read() {
          const err = new Error('Premature close');
          (err as { code: string }).code = 'ERR_STREAM_PREMATURE_CLOSE';
          this.destroy(err);
        },
      });

      vi.mocked(assetService.getAssetStream).mockResolvedValueOnce({
        stream: brokenStream,
        contentType: 'image/png',
        contentLength: 100,
      });

      const res = createMockResponse();

      // when & then: 예외가 상위로 전파되어 프로세스를 크래시하지 않음
      await expect(controller.getAsset(mockUser, 'test.png', res)).resolves.not.toThrow();
    });
  });
});
