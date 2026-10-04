import { Controller, Get, HttpStatus } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { HealthCheckResponseDto } from './dto/health-check-response.dto.js';

@ApiTags('System')
@Controller('health')
export class HealthController {
  constructor(private readonly configService: ConfigService) {}

  @Get()
  @ApiOperation({ summary: '서버 헬스체크 및 런타임 상태 조회' })
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
}
