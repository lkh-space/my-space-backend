import { z } from 'zod';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export type NeuralSessionStatus = 'LIVE' | 'idle' | 'saved';

export const createNeuralSessionSchema = z.object({
  title: z.string().max(100).optional(),
});

export type CreateNeuralSessionInput = z.infer<typeof createNeuralSessionSchema>;

export class CreateNeuralSessionDto {
  static readonly schema = createNeuralSessionSchema;

  @ApiPropertyOptional({
    description: '세션 제목 (미지정 시 자동 생성)',
    example: 'Neural Stream Diagnostic Session',
  })
  title?: string;
}

export class NeuralStreamSessionDto {
  @ApiProperty({ description: '세션 고유 ID', example: 'session-jarvis-123' })
  id!: string;

  @ApiProperty({ description: '세션 제목', example: 'System Architecture Analysis' })
  title!: string;

  @ApiProperty({
    enum: ['LIVE', 'idle', 'saved'],
    description: '세션 상태 (LIVE: 스트리밍 중, idle: 대기 중, saved: 보관됨)',
    example: 'idle',
  })
  status!: NeuralSessionStatus;

  @ApiProperty({ description: '생성 일시 (ISO string)', example: '2026-10-09T08:00:00.000Z' })
  createdAt!: string;

  @ApiProperty({ description: '수정 일시 (ISO string)', example: '2026-10-09T08:30:00.000Z' })
  updatedAt!: string;
}
