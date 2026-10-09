import { ApiProperty } from '@nestjs/swagger';

export class MemoryUsageDto {
  @ApiProperty({ example: '25.4 MB', description: '사용 중인 V8 힙 메모리' })
  heapUsed: string;

  @ApiProperty({
    example: '65.2 MB',
    description: '프로세스 전체 물리 메모리 (RSS)',
  })
  rss: string;
}

export class HealthCheckResponseDto {
  @ApiProperty({ example: 'ok', description: '서버 상태' })
  status: 'ok';

  @ApiProperty({
    example: '2026-10-09T01:45:00.000Z',
    description: '체크 일시 (ISO 8601)',
  })
  timestamp: string;

  @ApiProperty({ example: 3600, description: '프로세스 가동 시간(초)' })
  uptime: number;

  @ApiProperty({ type: MemoryUsageDto, description: '메모리 점유 현황' })
  memory: MemoryUsageDto;

  @ApiProperty({ example: 'production', description: '실행 환경' })
  environment: string;
}
