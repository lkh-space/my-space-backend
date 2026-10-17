import { describe, it, expect } from 'vitest';
import { initE2ETest } from '../../lib/init-e2e-test.js';
import { withAuthHeaders, DEFAULT_TEST_USER } from '../../lib/utils.js';

describe('Markdown Assets API (E2E)', () => {
  const ctx = initE2ETest();

  describe('이미지 업로드 및 스트리밍 다운로드', () => {
    it('PNG 이미지 파일을 정상적으로 업로드하고 보안 헤더와 함께 다운로드할 수 있어야 한다', async () => {
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

      // 2. 업로드된 에셋 스트리밍 조회 및 보안 헤더 검증 (H-2)
      const downloadRes = await withAuthHeaders(
        ctx.req.get(`/api/v1/markdown/assets/${assetKey}`),
        DEFAULT_TEST_USER,
      ).expect(200);

      expect(downloadRes.headers['content-type']).toContain('image/png');
      expect(downloadRes.headers['cache-control']).toBe('private, max-age=86400');
      expect(downloadRes.headers['x-content-type-options']).toBe('nosniff');
      expect(downloadRes.headers['content-security-policy']).toBe(
        "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      );
      expect(downloadRes.headers['content-disposition']).toBe('inline');
      expect(downloadRes.body).toBeDefined();
    });

    it('악성 스크립트가 포함된 SVG 파일 업로드 시 400 Bad Request를 반환해야 한다 (H-2)', async () => {
      const maliciousSvg = Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg"><script>alert("XSS")</script></svg>',
        'utf-8',
      );

      const uploadReq = ctx.req
        .post('/api/v1/markdown/assets/upload')
        .attach('file', maliciousSvg, 'xss.svg');

      const res = await withAuthHeaders(uploadReq, DEFAULT_TEST_USER).expect(400);
      expect(res.body.message).toContain('위험한 스크립트');
    });

    it('안전한 SVG 파일은 업로드 후 다운로드 시 Content-Disposition: attachment로 서빙되어야 한다 (H-2)', async () => {
      const safeSvg = Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="50" height="50"><circle cx="25" cy="25" r="20" fill="blue" /></svg>',
        'utf-8',
      );

      // 1. 안전한 SVG 업로드
      const uploadReq = ctx.req
        .post('/api/v1/markdown/assets/upload')
        .attach('file', safeSvg, 'safe.svg');

      const uploadRes = await withAuthHeaders(uploadReq, DEFAULT_TEST_USER).expect(201);
      const assetKey = uploadRes.body.key;

      // 2. 다운로드 시 attachment 및 CSP sandbox 검증
      const downloadRes = await withAuthHeaders(
        ctx.req.get(`/api/v1/markdown/assets/${assetKey}`),
        DEFAULT_TEST_USER,
      ).expect(200);

      expect(downloadRes.headers['content-type']).toContain('image/svg+xml');
      expect(downloadRes.headers['content-disposition']).toContain('attachment');
      expect(downloadRes.headers['cache-control']).toBe('private, max-age=86400');
      expect(downloadRes.headers['content-security-policy']).toBe(
        "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      );
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
