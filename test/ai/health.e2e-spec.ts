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

  describe('GET /health/ready (Readiness Probe)', () => {
    it('인프라 상태를 심층 진단하고 데이터베이스가 정상 up 상태여야 한다', async () => {
      // when
      const res = await ctx.req.get('/health/ready');

      // then: HTTP 상태 코드는 200 또는 503(일부 선택적 외부 브로커 미기동 시)
      expect([200, 503]).toContain(res.status);
      expect(res.body).toHaveProperty('status');
      expect(['ok', 'error']).toContain(res.body.status);
      expect(res.body).toHaveProperty('timestamp');
      expect(res.body).toHaveProperty('checks');
      expect(res.body.checks).toHaveProperty('database');
      expect(res.body.checks.database.status).toBe('up');
      expect(typeof res.body.checks.database.latencyMs).toBe('number');
    });
  });
});

