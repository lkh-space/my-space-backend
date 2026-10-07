import { describe, it, expect, beforeEach } from 'vitest';
import { initAiE2ETest } from '../lib/init-ai-e2e-test.js';
import {
  withAuthHeaders,
  DEFAULT_TEST_USER,
  OTHER_TEST_USER,
} from '../lib/utils.js';

const MOCK_VECTOR = Array.from({ length: 768 }, () => 0.05);

describe('AI Search API (E2E)', () => {
  const ctx = initAiE2ETest();

  beforeEach(async () => {
    await ctx.testService.cleanDatabase();
    ctx.fakeQdrant.clear();
  });

  describe('POST /api/v1/ai/search (시맨틱 문서 검색)', () => {
    it('개인 문서에 대한 자연어 시맨틱 검색을 정상 수행해야 한다 (200)', async () => {
      // given: FakeQdrant에 사용자 청크 데이터 등록
      await ctx.fakeQdrant.upsertPoints([
        {
          id: 'chunk-1',
          vector: MOCK_VECTOR,
          payload: {
            ownerId: DEFAULT_TEST_USER.user!,
            documentId: 'doc-1',
            chunkIndex: 0,
            title: 'NestJS 아키텍처 패턴',
            heading: '계층형 아키텍처',
            content: 'Controller, Service, Repository 계층 분리 설명',
            tags: ['nestjs', 'backend'],
            folderId: 'folder-tech',
          },
        },
        {
          id: 'chunk-2',
          vector: MOCK_VECTOR,
          payload: {
            ownerId: DEFAULT_TEST_USER.user!,
            documentId: 'doc-2',
            chunkIndex: 0,
            title: 'Vitest 테스트 가이드',
            heading: '단위 및 E2E 테스트',
            content: 'Vitest를 사용한 초고속 ESM 테스팅 기법',
            tags: ['test', 'vitest'],
            folderId: 'folder-tech',
          },
        },
      ]);

      const payload = {
        query: 'NestJS 계층 구조',
        limit: 5,
      };

      // when
      const res = await withAuthHeaders(
        ctx.req.post('/api/v1/ai/search').send(payload),
        DEFAULT_TEST_USER,
      ).expect(200);

      // then
      expect(res.body).toMatchObject({
        total: 2,
        results: expect.any(Array),
      });
      expect(res.body.results).toHaveLength(2);
      expect(res.body.results[0]).toMatchObject({
        documentId: 'doc-1',
        title: 'NestJS 아키텍처 패턴',
        heading: '계층형 아키텍처',
        content: 'Controller, Service, Repository 계층 분리 설명',
        score: expect.any(Number),
        tags: ['nestjs', 'backend'],
      });
    });

    it('타 사용자의 문서는 검색 결과에 노출되지 않아야 한다 (데이터 격리)', async () => {
      // given: OTHER_TEST_USER의 청크 데이터만 등록
      await ctx.fakeQdrant.upsertPoints([
        {
          id: 'chunk-other',
          vector: MOCK_VECTOR,
          payload: {
            ownerId: OTHER_TEST_USER.user!,
            documentId: 'doc-secret',
            chunkIndex: 0,
            title: '타인의 비밀 문서',
            heading: '비밀 정보',
            content: '접근해서는 안 되는 기밀 데이터',
          },
        },
      ]);

      const payload = {
        query: '기밀 데이터',
      };

      // when: DEFAULT_TEST_USER로 검색 수행
      const res = await withAuthHeaders(
        ctx.req.post('/api/v1/ai/search').send(payload),
        DEFAULT_TEST_USER,
      ).expect(200);

      // then: 타인의 문서는 조회되지 않음
      expect(res.body.total).toBe(0);
      expect(res.body.results).toHaveLength(0);
    });

    it('폴더 ID(folderId) 필터링이 올바르게 적용되어야 한다 (200)', async () => {
      // given: 서로 다른 폴더의 청크 2개 등록
      await ctx.fakeQdrant.upsertPoints([
        {
          id: 'chunk-f1',
          vector: MOCK_VECTOR,
          payload: {
            ownerId: DEFAULT_TEST_USER.user!,
            documentId: 'doc-f1',
            chunkIndex: 0,
            title: '업무 폴더 문서',
            heading: '소개',
            content: '업무 관련 내용입니다.',
            folderId: 'folder-work',
          },
        },
        {
          id: 'chunk-f2',
          vector: MOCK_VECTOR,
          payload: {
            ownerId: DEFAULT_TEST_USER.user!,
            documentId: 'doc-f2',
            chunkIndex: 0,
            title: '개인 폴더 문서',
            heading: '소개',
            content: '개인 취미 관련 내용입니다.',
            folderId: 'folder-personal',
          },
        },
      ]);

      const payload = {
        query: '문서',
        folderId: 'folder-work',
      };

      // when
      const res = await withAuthHeaders(
        ctx.req.post('/api/v1/ai/search').send(payload),
        DEFAULT_TEST_USER,
      ).expect(200);

      // then
      expect(res.body.total).toBe(1);
      expect(res.body.results[0].documentId).toBe('doc-f1');
    });

    it('태그(tags) 필터링이 올바르게 적용되어야 한다 (200)', async () => {
      // given: 태그가 다른 2개 문서 등록
      await ctx.fakeQdrant.upsertPoints([
        {
          id: 'chunk-tag-1',
          vector: MOCK_VECTOR,
          payload: {
            ownerId: DEFAULT_TEST_USER.user!,
            documentId: 'doc-t1',
            chunkIndex: 0,
            title: 'TypeScript 팁',
            heading: '타입 시스템',
            content: '고급 타입 다루기',
            tags: ['typescript', 'frontend'],
          },
        },
        {
          id: 'chunk-tag-2',
          vector: MOCK_VECTOR,
          payload: {
            ownerId: DEFAULT_TEST_USER.user!,
            documentId: 'doc-t2',
            chunkIndex: 0,
            title: 'Python 가이드',
            heading: '문법',
            content: '파이썬 기초',
            tags: ['python'],
          },
        },
      ]);

      const payload = {
        query: '가이드',
        tags: ['typescript'],
      };

      // when
      const res = await withAuthHeaders(
        ctx.req.post('/api/v1/ai/search').send(payload),
        DEFAULT_TEST_USER,
      ).expect(200);

      // then
      expect(res.body.total).toBe(1);
      expect(res.body.results[0].documentId).toBe('doc-t1');
    });

    it('limit 파라미터에 지정된 개수 이하로 결과가 제한되어야 한다 (200)', async () => {
      // given: 3개 청크 등록
      await ctx.fakeQdrant.upsertPoints([
        {
          id: 'chunk-l1',
          vector: MOCK_VECTOR,
          payload: {
            ownerId: DEFAULT_TEST_USER.user!,
            documentId: 'doc-l1',
            chunkIndex: 0,
            title: '문서 1',
            heading: '헤딩',
            content: '내용 1',
          },
        },
        {
          id: 'chunk-l2',
          vector: MOCK_VECTOR,
          payload: {
            ownerId: DEFAULT_TEST_USER.user!,
            documentId: 'doc-l2',
            chunkIndex: 0,
            title: '문서 2',
            heading: '헤딩',
            content: '내용 2',
          },
        },
        {
          id: 'chunk-l3',
          vector: MOCK_VECTOR,
          payload: {
            ownerId: DEFAULT_TEST_USER.user!,
            documentId: 'doc-l3',
            chunkIndex: 0,
            title: '문서 3',
            heading: '헤딩',
            content: '내용 3',
          },
        },
      ]);

      const payload = {
        query: '내용',
        limit: 2,
      };

      // when
      const res = await withAuthHeaders(
        ctx.req.post('/api/v1/ai/search').send(payload),
        DEFAULT_TEST_USER,
      ).expect(200);

      // then
      expect(res.body.total).toBe(2);
      expect(res.body.results).toHaveLength(2);
    });

    it('검색 질의어(query)가 누락되거나 빈 문자열이면 400 Bad Request를 반환해야 한다', async () => {
      // given
      const invalidPayload = {
        query: '',
      };

      // when & then
      await withAuthHeaders(
        ctx.req.post('/api/v1/ai/search').send(invalidPayload),
        DEFAULT_TEST_USER,
      ).expect(400);
    });
  });
});
