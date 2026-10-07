import { describe, it, expect, beforeEach } from 'vitest';
import { initAiE2ETest } from '../lib/init-ai-e2e-test.js';
import { withAuthHeaders, DEFAULT_TEST_USER } from '../lib/utils.js';

describe('AI Chat API (E2E)', () => {
  const ctx = initAiE2ETest();

  beforeEach(async () => {
    await ctx.testService.cleanDatabase();
    ctx.fakeQdrant.clear();
    ctx.fakeMinio.clear();
    ctx.fakeLlm.reset();
  });

  describe('POST /api/v1/ai/chat (단발성 대화)', () => {
    it('기본 질문 전송 시 모의 AI 응답을 정상적으로 수신해야 한다 (200)', async () => {
      // given
      const payload = {
        messages: [
          { role: 'user', content: 'NestJS의 장점에 대해 알려줘' },
        ],
        provider: 'gemini',
      };

      // when
      const res = await withAuthHeaders(
        ctx.req.post('/api/v1/ai/chat').send(payload),
        DEFAULT_TEST_USER,
      ).expect(200);

      // then
      expect(res.body).toHaveProperty('message');
      expect(res.body.message.role).toBe('assistant');
      expect(res.body.message.content).toContain('NestJS의 장점에 대해 알려줘');
      expect(res.body.toolExecutions).toBeUndefined();
    });

    it('문서 검색 도구가 트리거되면 search_my_documents를 실행하고 결과를 종합하여 답변해야 한다 (200)', async () => {
      // given
      // FakeQdrant에 사전 문서 청크 등록
      await ctx.fakeQdrant.upsertPoints([
        {
          id: 'chunk-1',
          vector: Array.from({ length: 768 }, () => 0.05),
          payload: {
            ownerId: DEFAULT_TEST_USER.user!,
            documentId: 'doc-123',
            chunkIndex: 0,
            title: 'NestJS 아키텍처 가이드',
            heading: '모듈 구조',
            content: 'NestJS는 모듈 단위 아키텍처를 권장합니다.',
            tags: ['nestjs', 'architecture'],
          },
        },
      ]);

      const payload = {
        messages: [
          { role: 'user', content: '내 문서 검색해줘: NestJS 모듈 구조' },
        ],
        provider: 'gemini',
        enableTools: true,
      };

      // when
      const res = await withAuthHeaders(
        ctx.req.post('/api/v1/ai/chat').send(payload),
        DEFAULT_TEST_USER,
      ).expect(200);

      // then
      expect(res.body).toHaveProperty('message');
      expect(res.body.message.role).toBe('assistant');
      expect(res.body.toolExecutions).toBeDefined();
      expect(res.body.toolExecutions).toHaveLength(1);
      expect(res.body.toolExecutions[0].name).toBe('search_my_documents');
      expect(res.body.message.content).toContain('도구 검색 결과를 바탕으로 답변을 완성했습니다.');
    });

    it('문서 저장 도구가 트리거되면 save_to_markdown을 실행하여 DB에 새 문서를 생성해야 한다 (200)', async () => {
      // given
      const payload = {
        messages: [
          { role: 'user', content: '이번 회의록 문서 저장해줘' },
        ],
        provider: 'gemini',
        enableTools: true,
      };

      // when
      const res = await withAuthHeaders(
        ctx.req.post('/api/v1/ai/chat').send(payload),
        DEFAULT_TEST_USER,
      ).expect(200);

      // then
      expect(res.body.toolExecutions).toBeDefined();
      expect(res.body.toolExecutions[0].name).toBe('save_to_markdown');

      // 실제 DB에 저장이 수행되었는지 확인
      const savedDocs = await ctx.testService.prisma.document.findMany({
        where: { ownerId: DEFAULT_TEST_USER.user! },
      });
      expect(savedDocs).toHaveLength(1);
      expect(savedDocs[0].title).toBe('자동 저장된 AI 문서');
    });

    it('enableTools 옵션이 false이면 도구 호출 키워드가 있어도 일반 답변만 생성해야 한다 (200)', async () => {
      // given
      const payload = {
        messages: [
          { role: 'user', content: '문서 검색 키워드가 있어도 도구 미사용' },
        ],
        enableTools: false,
      };

      // when
      const res = await withAuthHeaders(
        ctx.req.post('/api/v1/ai/chat').send(payload),
        DEFAULT_TEST_USER,
      ).expect(200);

      // then
      expect(res.body.toolExecutions).toBeUndefined();
      expect(res.body.message.content).toContain('Mock AI 응답');
    });

    it('메시지 배열이 비어있으면 유효성 검사 실패로 400 Bad Request를 반환해야 한다', async () => {
      // given
      const invalidPayload = {
        messages: [],
      };

      // when & then
      await withAuthHeaders(
        ctx.req.post('/api/v1/ai/chat').send(invalidPayload),
        DEFAULT_TEST_USER,
      ).expect(400);
    });
  });

  describe('POST /api/v1/ai/chat/stream (SSE 실시간 스트리밍)', () => {
    it('SSE 스트리밍 요청 시 토큰 청크와 완료 이벤트를 올바른 규격으로 전송해야 한다 (200)', async () => {
      // given
      // 스트리밍 모의 동작 설정: 도구 호출 없이 바로 토큰 스트리밍
      ctx.fakeLlm.setCustomGenerate(async () => ({
        content: '', // content 비어있으면 generator로 넘어감
      }));
      ctx.fakeLlm.setCustomStream(async function* () {
        yield '안녕';
        yield '하세요!';
      });

      const payload = {
        messages: [
          { role: 'user', content: '스트리밍으로 대답해줘' },
        ],
        enableTools: false,
      };

      // when
      const res = await withAuthHeaders(
        ctx.req.post('/api/v1/ai/chat/stream').send(payload),
        DEFAULT_TEST_USER,
      ).expect(200);

      // then
      expect(res.header['content-type']).toContain('text/event-stream');
      expect(res.text).toContain('event: token');
      expect(res.text).toContain('event: done');
      expect(res.text).toContain('안녕');
      expect(res.text).toContain('하세요!');
    });

    it('도구 호출이 수반된 스트리밍 요청 시 tool_start 및 tool_end 이벤트가 발행되어야 한다 (200)', async () => {
      // given
      const payload = {
        messages: [
          { role: 'user', content: '내 문서 검색해줘' },
        ],
        enableTools: true,
      };

      // when
      const res = await withAuthHeaders(
        ctx.req.post('/api/v1/ai/chat/stream').send(payload),
        DEFAULT_TEST_USER,
      ).expect(200);

      // then
      expect(res.header['content-type']).toContain('text/event-stream');
      expect(res.text).toContain('event: tool_start');
      expect(res.text).toContain('search_my_documents');
      expect(res.text).toContain('event: tool_end');
      expect(res.text).toContain('event: done');
    });
  });
});
