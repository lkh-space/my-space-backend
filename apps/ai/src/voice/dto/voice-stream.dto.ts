import { z } from 'zod';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export const voiceSettingsSchema = z.object({
  selectedVoice: z.enum([
    'JARVIS British AI',
    'JARVIS Fast Neural',
    'JARVIS Deep Resonant',
  ]).default('JARVIS British AI'),
  speechSpeed: z.number().min(0.5).max(2.0).default(1.0),
  enableTelemetry: z.boolean().optional().default(true),
});

export const voiceStreamQuerySchema = z.object({
  sessionId: z.string().min(1, 'sessionId는 필수입니다.'),
  textQuery: z.string().optional(),
  voiceSettings: voiceSettingsSchema.optional(),
  enableTools: z.boolean().optional().default(true),
});

export const interruptQuerySchema = z.object({
  sessionId: z.string().min(1, 'sessionId는 필수입니다.'),
  streamId: z.string().optional(),
});

export type VoiceSettingsInput = z.infer<typeof voiceSettingsSchema>;
export type VoiceStreamQueryInput = z.infer<typeof voiceStreamQuerySchema>;
export type InterruptQueryInput = z.infer<typeof interruptQuerySchema>;

export class VoiceSettingsDto {
  @ApiPropertyOptional({
    enum: ['JARVIS British AI', 'JARVIS Fast Neural', 'JARVIS Deep Resonant'],
    default: 'JARVIS British AI',
    description: '합성할 J.A.R.V.I.S. 보이스 프로필',
  })
  selectedVoice?: 'JARVIS British AI' | 'JARVIS Fast Neural' | 'JARVIS Deep Resonant';

  @ApiPropertyOptional({
    default: 1.0,
    example: 1.25,
    description: '발화 배속 (1.0, 1.25, 1.5 등)',
  })
  speechSpeed?: number;

  @ApiPropertyOptional({
    default: true,
    description: '벤치마크 델타 텔레메트리 스트리밍 활성화 여부',
  })
  enableTelemetry?: boolean;
}

export class VoiceStreamQueryDto {
  static readonly schema = voiceStreamQuerySchema;

  @ApiProperty({ description: '신경망 스트림 세션 ID', example: 'session-jarvis-123' })
  sessionId!: string;

  @ApiPropertyOptional({
    description: '텍스트 질의 (음성 Blob 미전송 시 전달)',
    example: 'OPFS 캐싱 구조와 벤치마크 비교해줘',
  })
  textQuery?: string;

  @ApiPropertyOptional({ type: VoiceSettingsDto, description: '음성 합성 설정' })
  voiceSettings?: VoiceSettingsDto;

  @ApiPropertyOptional({
    default: true,
    description: 'Qdrant 개인 문서 시맨틱 검색 연동 여부',
  })
  enableTools?: boolean;
}

export class BenchmarkDeltaMetricsDto {
  @ApiProperty({ example: 'local-storage-worker' })
  workerName!: string;

  @ApiProperty({ example: '~1.8ms lat / 0 locks' })
  opfsStream!: string;

  @ApiProperty({ example: '~8.4ms lat / 3 retries' })
  remoteSse!: string;
}

export class ReferencedContextDto {
  @ApiProperty({ example: 'c1' })
  id!: string;

  @ApiProperty({ example: 'mongodb-streaming.md' })
  title!: string;

  @ApiProperty({ example: 'mongodb-streaming.md' })
  filename!: string;

  @ApiProperty({ enum: ['doc', 'architecture', 'code'], example: 'doc' })
  type!: 'doc' | 'architecture' | 'code';
}

export class InterruptQueryDto {
  static readonly schema = interruptQuerySchema;

  @ApiProperty({ description: '중단할 신경망 스트림 세션 ID', example: 'session-jarvis-123' })
  sessionId!: string;

  @ApiPropertyOptional({ description: '스트림 ID (선택)', example: 'stream-1' })
  streamId?: string;
}

export class AudioCompleteDto {
  @ApiProperty({ example: '/api/v1/ai/audio/msg-jarvis-1.wav' })
  audioUrl!: string;

  @ApiProperty({ example: '0:38' })
  duration!: string;
}

export class StreamDoneDto {
  @ApiProperty({ example: true })
  finished!: boolean;

  @ApiProperty({ example: 2410 })
  tokensUsed!: number;

  @ApiProperty({ example: 8192 })
  contextLimit!: number;
}
