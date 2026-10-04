import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HealthController } from './health.controller.js';

describe('HealthController', () => {
  let controller: HealthController;

  beforeEach(async () => {
    // given
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        {
          provide: ConfigService,
          useValue: {
            get: vi.fn().mockReturnValue('test'),
          },
        },
      ],
    }).compile();

    controller = module.get<HealthController>(HealthController);
  });

  it('컨트롤러가 정의되어 있어야 한다', () => {
    // then
    expect(controller).toBeDefined();
  });

  describe('check', () => {
    it('헬스체크 응답 객체를 반환해야 한다', () => {
      // given
      // controller가 정상 초기화된 상태

      // when
      const result = controller.check();

      // then
      expect(result).toHaveProperty('status', 'ok');
      expect(result).toHaveProperty('timestamp');
      expect(result).toHaveProperty('uptime');
      expect(typeof result.uptime).toBe('number');
      expect(result).toHaveProperty('memory');
      expect(result.memory).toHaveProperty('heapUsed');
      expect(result.memory).toHaveProperty('rss');
      expect(result).toHaveProperty('environment', 'test');
    });
  });
});
