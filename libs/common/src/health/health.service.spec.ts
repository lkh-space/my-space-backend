import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DiscoveryService } from '@nestjs/core';
import { HealthService } from './health.service.js';

class PrismaService {
  checkHealth = vi.fn().mockResolvedValue(undefined);
}

class RabbitmqService {
  checkHealth = vi.fn().mockResolvedValue(undefined);
}

describe('HealthService (인프라 의존성 심층 헬스 진단 BDD 단위 테스트)', () => {
  let service: HealthService;
  let mockDiscoveryService: {
    getProviders: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockDiscoveryService = {
      getProviders: vi.fn(),
    };
    service = new HealthService(mockDiscoveryService as unknown as DiscoveryService);
  });

  it('등록된 타겟이 모두 정상 동작하면 status: "ok"와 up 결과를 반환해야 한다', async () => {
    // given
    const mockPrisma = new PrismaService();
    const mockRabbitmq = new RabbitmqService();

    mockDiscoveryService.getProviders.mockReturnValue([
      { instance: mockPrisma },
      { instance: mockRabbitmq },
    ]);

    // when
    const result = await service.checkReadiness();

    // then
    expect(result.status).toBe('ok');
    expect(result.checks.database).toBeDefined();
    expect(result.checks.database.status).toBe('up');
    expect(typeof result.checks.database.latencyMs).toBe('number');
    expect(result.checks.rabbitmq).toBeDefined();
    expect(result.checks.rabbitmq.status).toBe('up');
    expect(mockPrisma.checkHealth).toHaveBeenCalled();
    expect(mockRabbitmq.checkHealth).toHaveBeenCalled();
  });

  it('특정 의존성(예: PostgreSQL)의 checkHealth 실패 시 status: "error"와 down 결과를 반환해야 한다', async () => {
    // given
    const mockPrisma = new PrismaService();
    mockPrisma.checkHealth.mockRejectedValue(new Error('Prisma connection refused'));
    const mockRabbitmq = new RabbitmqService();

    mockDiscoveryService.getProviders.mockReturnValue([
      { instance: mockPrisma },
      { instance: mockRabbitmq },
    ]);

    // when
    const result = await service.checkReadiness();

    // then
    expect(result.status).toBe('error');
    expect(result.checks.database.status).toBe('down');
    expect(result.checks.database.error).toBe('Prisma connection refused');
    expect(result.checks.rabbitmq.status).toBe('up');
  });

  it('컨테이너에 등록되지 않은 프로바이더는 검사 대상에서 자연스럽게 제외되어야 한다', async () => {
    // given
    mockDiscoveryService.getProviders.mockReturnValue([
      { instance: { constructor: { name: 'SomeOtherService' } } },
    ]);

    // when
    const result = await service.checkReadiness();

    // then
    expect(result.status).toBe('ok');
    expect(Object.keys(result.checks)).toHaveLength(0);
  });
});
