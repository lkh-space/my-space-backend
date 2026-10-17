import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { HttpStatus } from '@nestjs/common';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Response } from 'express';
import { HealthController } from './health.controller.js';
import { HealthService } from './health.service.js';

describe('HealthController', () => {
  let controller: HealthController;
  let mockHealthService: {
    checkReadiness: ReturnType<typeof vi.fn>;
  };
  let mockResponse: Partial<Response>;

  beforeEach(async () => {
    // given
    mockHealthService = {
      checkReadiness: vi.fn(),
    };

    mockResponse = {
      status: vi.fn().mockReturnThis(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        {
          provide: ConfigService,
          useValue: {
            get: vi.fn().mockReturnValue('test'),
          },
        },
        {
          provide: HealthService,
          useValue: mockHealthService,
        },
      ],
    }).compile();

    controller = module.get<HealthController>(HealthController);
  });

  it('컨트롤러가 정의되어 있어야 한다', () => {
    // then
    expect(controller).toBeDefined();
  });

  describe('check (Liveness Probe)', () => {
    it('헬스체크 응답 객체를 반환해야 한다', () => {
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

  describe('ready (Readiness Probe)', () => {
    it('모든 인프라 의존성이 정상이면 status: "ok"를 반환하고 200 OK여야 한다', async () => {
      // given
      mockHealthService.checkReadiness.mockResolvedValue({
        status: 'ok',
        timestamp: '2026-10-17T11:00:00.000Z',
        checks: {
          database: { status: 'up', latencyMs: 5 },
          rabbitmq: { status: 'up', latencyMs: 1 },
        },
      });

      // when
      const result = await controller.ready(mockResponse as Response);

      // then
      expect(result.status).toBe('ok');
      expect(result.checks.database.status).toBe('up');
      expect(mockResponse.status).not.toHaveBeenCalled();
    });

    it('인프라 의존성 중 하나라도 실패하면 status: "error"를 반환하고 503 Service Unavailable을 설정해야 한다', async () => {
      // given
      mockHealthService.checkReadiness.mockResolvedValue({
        status: 'error',
        timestamp: '2026-10-17T11:00:00.000Z',
        checks: {
          database: { status: 'down', error: 'Connection refused', latencyMs: 10 },
          rabbitmq: { status: 'up', latencyMs: 2 },
        },
      });

      // when
      const result = await controller.ready(mockResponse as Response);

      // then
      expect(result.status).toBe('error');
      expect(result.checks.database.status).toBe('down');
      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
    });
  });
});

