import { ApiProperty } from '@nestjs/swagger';

export class ServiceCheckResultDto {
  @ApiProperty({ example: 'up', enum: ['up', 'down'], description: '서비스 연결 상태' })
  status: 'up' | 'down';

  @ApiProperty({ example: 5, description: '응답 지연 시간(ms)', required: false })
  latencyMs?: number;

  @ApiProperty({ example: 'Connection refused', description: '장애 원인 메시지', required: false })
  error?: string;
}

export class HealthReadyResponseDto {
  @ApiProperty({ example: 'ok', enum: ['ok', 'error'], description: '전체 준비 상태' })
  status: 'ok' | 'error';

  @ApiProperty({ example: '2026-10-17T11:00:00.000Z', description: '진단 일시 (ISO 8601)' })
  timestamp: string;

  @ApiProperty({
    description: '각 인프라 의존성 진단 결과',
    example: {
      database: { status: 'up', latencyMs: 3 },
      rabbitmq: { status: 'up', latencyMs: 1 },
    },
  })
  checks: Record<string, ServiceCheckResultDto>;
}
