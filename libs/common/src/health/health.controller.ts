import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { HealthCheckResponseDto } from './dto/health-check-response.dto.js';
import { HealthReadyResponseDto } from './dto/health-ready-response.dto.js';
import { HealthService } from './health.service.js';
import { Public } from '../decorators/public.decorator.js';

@ApiTags('System')
@Public()
@Controller('health')
export class HealthController {
  constructor(
    private readonly configService: ConfigService,
    private readonly healthService: HealthService,
  ) {}

  @Get()
  @ApiOperation({ summary: '서버 헬스체크 및 런타임 상태 조회 (Liveness Probe)' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: '서버가 정상적으로 동작 중임',
    type: HealthCheckResponseDto,
  })
  check(): HealthCheckResponseDto {
    const mem = process.memoryUsage();
    const toMB = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: Math.floor(process.uptime()),
      memory: {
        heapUsed: toMB(mem.heapUsed),
        rss: toMB(mem.rss),
      },
      environment:
        this.configService.get<string>('app.nodeEnv') ??
        process.env.NODE_ENV ??
        'development',
    };
  }

  @Get('ready')
  @ApiOperation({
    summary: '서버 준비 상태(Readiness Probe) 심층 진단',
    description:
      '데이터베이스(PostgreSQL), 메시지 브로커(RabbitMQ), 스토리지(MinIO/Qdrant/OpenSearch) 연결 상태를 전수 점검합니다.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: '모든 핵심 인프라 서비스가 정상 준비됨',
    type: HealthReadyResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.SERVICE_UNAVAILABLE,
    description: '하나 이상의 인프라 의존성 장애 발생',
    type: HealthReadyResponseDto,
  })
  async ready(
    @Res({ passthrough: true }) res: Response,
  ): Promise<HealthReadyResponseDto> {
    const result = await this.healthService.checkReadiness();
    if (result.status === 'error') {
      res.status(HttpStatus.SERVICE_UNAVAILABLE);
    }
    return result;
  }
}

