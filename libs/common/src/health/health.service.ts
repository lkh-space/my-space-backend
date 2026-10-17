import { Injectable, Logger } from '@nestjs/common';
import { DiscoveryService } from '@nestjs/core';
import {
  HealthReadyResponseDto,
  ServiceCheckResultDto,
} from './dto/health-ready-response.dto.js';

const TARGET_SERVICE_MAP: Record<string, string> = {
  PrismaService: 'database',
  RabbitmqService: 'rabbitmq',
  MinioService: 'minio',
  OpenSearchService: 'opensearch',
  QdrantService: 'qdrant',
};

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(private readonly discoveryService: DiscoveryService) {}

  async checkReadiness(): Promise<HealthReadyResponseDto> {
    const checks: Record<string, ServiceCheckResultDto> = {};
    let hasFailure = false;

    const providers = this.discoveryService.getProviders();
    const matchedTargets = new Map<string, any>();

    for (const wrapper of providers) {
      const instance = wrapper.instance;
      if (!instance) continue;
      const className = instance.constructor?.name;
      const targetName = TARGET_SERVICE_MAP[className];
      if (targetName && typeof instance.checkHealth === 'function') {
        matchedTargets.set(targetName, instance);
      }
    }

    for (const [name, instance] of matchedTargets.entries()) {
      const start = Date.now();
      try {
        await Promise.race([
          instance.checkHealth(),
          new Promise((_, reject) =>
            setTimeout(
              () => reject(new Error(`${name} 헬스체크 타임아웃 (3초)`)),
              3000,
            ),
          ),
        ]);

        checks[name] = {
          status: 'up',
          latencyMs: Date.now() - start,
        };
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Readiness 진단 실패 [target=${name}]: ${errorMsg}`);
        checks[name] = {
          status: 'down',
          latencyMs: Date.now() - start,
          error: errorMsg,
        };
        hasFailure = true;
      }
    }

    return {
      status: hasFailure ? 'error' : 'ok',
      timestamp: new Date().toISOString(),
      checks,
    };
  }
}
