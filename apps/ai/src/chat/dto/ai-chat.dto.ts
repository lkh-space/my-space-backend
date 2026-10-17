import { z } from 'zod';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export const chatMessageSchema = z.object({
  role: z.enum(['user', 'assistant'], {
    message: '메시지 역할(role)은 user 또는 assistant만 허용됩니다.',
  }),
  content: z
    .string()
    .min(1, '메시지 본문은 최소 1자 이상이어야 합니다.')
    .max(8_000, '메시지 본문은 최대 8,000자 이하여야 합니다.'),
});

export const aiChatSchema = z.object({
  messages: z
    .array(chatMessageSchema)
    .min(1, '최소 1개 이상의 메시지가 필요합니다.')
    .max(50, '메시지는 최대 50개까지 전송 가능합니다.'),
  provider: z.enum(['gemini', 'ollama']).optional().default('gemini'),
  enableTools: z.boolean().optional().default(true),
});

export type AiChatInput = z.infer<typeof aiChatSchema>;

export class ChatMessageDto {
  @ApiProperty({ enum: ['user', 'assistant'], example: 'user' })
  role!: 'user' | 'assistant';

  @ApiProperty({ example: '내 문서 중에서 NestJS 아키텍처 요약해줘' })
  content!: string;
}

export class AiChatDto {
  static readonly schema = aiChatSchema;

  @ApiProperty({ type: [ChatMessageDto], description: '대화 히스토리 및 현재 사용자 메시지' })
  messages!: ChatMessageDto[];

  @ApiPropertyOptional({ enum: ['gemini', 'ollama'], default: 'gemini', description: '사용할 AI Provider' })
  provider?: 'gemini' | 'ollama';

  @ApiPropertyOptional({ default: true, description: '개인 문서 검색 및 마크다운 저장 도구 활성화 여부' })
  enableTools?: boolean;
}

export class ToolExecutionDto {
  @ApiProperty({ example: 'search_my_documents' })
  name!: string;

  @ApiProperty({ example: { query: 'NestJS 아키텍처' } })
  args!: Record<string, unknown>;

  @ApiPropertyOptional({ description: '도구 실행 결과 요약' })
  result?: string;
}

export class AiChatResponseDto {
  @ApiProperty({ type: ChatMessageDto, description: 'AI의 최종 답변 메시지' })
  message!: ChatMessageDto;

  @ApiPropertyOptional({ type: [ToolExecutionDto], description: '실행된 도구 목록' })
  toolExecutions?: ToolExecutionDto[];
}
