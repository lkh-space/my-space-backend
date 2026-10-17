import { describe, it, expect, beforeEach } from 'vitest';
import { initE2ETest } from '../../lib/init-e2e-test.js';
import { withAuthHeaders, DEFAULT_TEST_USER, OTHER_TEST_USER } from '../../lib/utils.js';

describe('Markdown Tenant Isolation & IDOR Protection (E2E)', () => {
  const ctx = initE2ETest();

  beforeEach(async () => {
    await ctx.testService.cleanDatabase();
  });

  describe('타인(User A) 리소스에 대한 User B의 악의적 접근 차단 검증', () => {
    it('사용자 B는 사용자 A의 문서를 수정, 삭제, 복원, 내보내기할 수 없어야 한다 (404/403 차단)', async () => {
      // 1. [given] 사용자 A(dev-admin)가 폴더와 문서를 생성하고 버전을 수정하여 리비전 생성
      const folderRes = await withAuthHeaders(
        ctx.req.post('/api/v1/markdown/folders').send({ name: 'User A Secret Folder' }),
        DEFAULT_TEST_USER,
      ).expect(201);
      const folderId = folderRes.body.id;

      const docRes = await withAuthHeaders(
        ctx.req.post('/api/v1/markdown/documents').send({
          title: 'User A Confidential Doc',
          content: '# Confidential Content',
          folderId,
          tags: ['confidential'],
        }),
        DEFAULT_TEST_USER,
      ).expect(201);
      const docId = docRes.body.id;

      // 문서 수정하여 버전 2 및 리비전 1 생성
      await withAuthHeaders(
        ctx.req.put(`/api/v1/markdown/documents/${docId}`).send({
          title: 'User A Confidential Doc (v2)',
          content: '# Updated Confidential Content',
        }),
        DEFAULT_TEST_USER,
      ).expect(200);

      // 1x1 투명 PNG 버퍼
      const pngBuffer = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        'base64',
      );

      // 사용자 A가 에셋 파일 업로드
      const uploadReq = ctx.req
        .post('/api/v1/markdown/assets/upload')
        .attach('file', pngBuffer, 'userA-secret.png');
      const assetRes = await withAuthHeaders(uploadReq, DEFAULT_TEST_USER).expect(201);
      const assetKey = assetRes.body.key;

      // 2. [when & then] 사용자 B(other-user)가 사용자 A의 문서 수정 시도 -> 404 차단
      await withAuthHeaders(
        ctx.req.put(`/api/v1/markdown/documents/${docId}`).send({
          title: 'Hacked Title',
          content: '# Hacked Content',
        }),
        OTHER_TEST_USER,
      ).expect(404);

      // 3. [when & then] 사용자 B가 사용자 A의 문서 삭제 시도 -> 404 차단
      await withAuthHeaders(
        ctx.req.delete(`/api/v1/markdown/documents/${docId}`),
        OTHER_TEST_USER,
      ).expect(404);

      // 4. [when & then] 사용자 B가 사용자 A의 리비전 목록 및 단건 조회 시도 -> 404 차단
      await withAuthHeaders(
        ctx.req.get(`/api/v1/markdown/documents/${docId}/revisions`),
        OTHER_TEST_USER,
      ).expect(404);

      await withAuthHeaders(
        ctx.req.get(`/api/v1/markdown/documents/${docId}/revisions/1`),
        OTHER_TEST_USER,
      ).expect(404);

      // 5. [when & then] 사용자 B가 사용자 A의 리비전 복원(restore) 시도 -> 404 차단
      await withAuthHeaders(
        ctx.req.post(`/api/v1/markdown/documents/${docId}/revisions/1/restore`),
        OTHER_TEST_USER,
      ).expect(404);

      // 6. [when & then] 사용자 B가 사용자 A의 마크다운 / PDF 내보내기 시도 -> 404 차단
      await withAuthHeaders(
        ctx.req.get(`/api/v1/markdown/documents/${docId}/export/md`),
        OTHER_TEST_USER,
      ).expect(404);

      await withAuthHeaders(
        ctx.req.get(`/api/v1/markdown/documents/${docId}/export/pdf`),
        OTHER_TEST_USER,
      ).expect(404);

      // 7. [when & then] 사용자 B가 사용자 A의 폴더 수정 및 삭제 시도 -> 404 차단
      await withAuthHeaders(
        ctx.req.patch(`/api/v1/markdown/folders/${folderId}`).send({ name: 'Hacked Folder' }),
        OTHER_TEST_USER,
      ).expect(404);

      await withAuthHeaders(
        ctx.req.delete(`/api/v1/markdown/folders/${folderId}`),
        OTHER_TEST_USER,
      ).expect(404);

      // 8. [when & then] 사용자 B가 사용자 A의 개인 에셋 스트리밍 접근 시도 -> 403 Forbidden 차단 (ASSET_ACCESS_DENIED)
      await withAuthHeaders(
        ctx.req.get(`/api/v1/markdown/assets/${assetKey}`),
        OTHER_TEST_USER,
      ).expect(403);

      // 9. [then] 사용자 A의 원본 문서는 조금도 훼손되지 않고 보존되어 있어야 함
      const checkDoc = await withAuthHeaders(
        ctx.req.get(`/api/v1/markdown/documents/${docId}`),
        DEFAULT_TEST_USER,
      ).expect(200);
      expect(checkDoc.body.title).toBe('User A Confidential Doc (v2)');
      expect(checkDoc.body.currentVersion).toBe(2);
    });
  });
});
