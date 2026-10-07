import { describe, it, expect } from 'vitest';
import { initE2ETest } from '../../lib/init-e2e-test.js';
import { withAuthHeaders, DEFAULT_TEST_USER } from '../../lib/utils.js';

describe('Markdown Assets API (E2E)', () => {
  const ctx = initE2ETest();

  describe('이미지 업로드 및 스트리밍 다운로드', () => {
    it('PNG 이미지 파일을 정상적으로 업로드하고 다운로드할 수 있어야 한다', async () => {
      // 1x1 투명 PNG 버퍼
      const pngBuffer = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        'base64',
      );

      // 1. 이미지 업로드 요청
      const uploadReq = ctx.req
        .post('/api/v1/markdown/assets/upload')
        .attach('file', pngBuffer, 'test-image.png');

      const uploadRes = await withAuthHeaders(uploadReq, DEFAULT_TEST_USER).expect(201);

      expect(uploadRes.body).toMatchObject({
        key: expect.stringContaining('.png'),
        filename: 'test-image.png',
        contentType: 'image/png',
      });

      const assetKey = uploadRes.body.key;

      // 2. 업로드된 에셋 스트리밍 조회
      const downloadRes = await withAuthHeaders(
        ctx.req.get(`/api/v1/markdown/assets/${assetKey}`),
        DEFAULT_TEST_USER,
      ).expect(200);

      expect(downloadRes.headers['content-type']).toContain('image/png');
      expect(downloadRes.body).toBeDefined();
    });

    it('허용되지 않은 파일 형식(예: text/plain) 업로드 시 400을 반환해야 한다', async () => {
      const textBuffer = Buffer.from('일반 텍스트 파일입니다.');

      const uploadReq = ctx.req
        .post('/api/v1/markdown/assets/upload')
        .attach('file', textBuffer, 'test.txt');

      await withAuthHeaders(uploadReq, DEFAULT_TEST_USER).expect(400);
    });
  });
});
