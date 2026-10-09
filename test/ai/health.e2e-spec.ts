import { describe, it, expect } from 'vitest';
import { initAiE2ETest } from '../lib/init-ai-e2e-test.js';

describe('AI Health API (E2E)', () => {
  const ctx = initAiE2ETest();

  describe('GET /health (런타임 헬스체크)', () => {
    it('AI 앱의 헬스체크 정보를 정상적으로 반환해야 한다 (200)', async () => {
      // given
      // AI 애플리케이션이 정상 부트스트랩된 상태

      // when
      const res = await ctx.req.get('/health').expect(200);

      // then
      expect(res.body).toHaveProperty('status', 'ok');
      expect(res.body).toHaveProperty('timestamp');
      expect(res.body).toHaveProperty('uptime');
      expect(typeof res.body.uptime).toBe('number');
      expect(res.body).toHaveProperty('memory');
      expect(res.body.memory).toHaveProperty('heapUsed');
      expect(res.body.memory).toHaveProperty('rss');
      expect(res.body).toHaveProperty('environment');
    });
  });
});
