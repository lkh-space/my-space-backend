import {
  Controller,
  Post,
  Body,
  UseGuards,
  HttpStatus,
  HttpCode,
  UsePipes,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { ApiTags, ApiOperation, ApiResponse, ApiHeader } from '@nestjs/swagger';
import {
  RemoteUserGuard,
  type AuthUser,
} from '@app/common/guards/remote-user.guard.js';
import { CurrentUser } from '@app/common/decorators/current-user.decorator.js';
import { ZodValidationPipe } from '@app/common/pipes/zod-validation.pipe.js';
import { AiChatService } from './ai-chat.service.js';
import {
  AiChatDto,
  AiChatResponseDto,
  aiChatSchema,
} from './dto/ai-chat.dto.js';

@ApiTags('AI Chat')
@ApiHeader({
  name: 'Remote-User',
  description: '사용자 ID (프로덕션 필수, 로컬은 dev-admin)',
})
@UseGuards(RemoteUserGuard)
@Controller('api/v1/ai/chat')
export class AiChatController {
  constructor(private readonly chatService: AiChatService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ZodValidationPipe(aiChatSchema))
  @ApiOperation({
    summary: 'AI 대화 (단발성 JSON 응답)',
    description: 'Gemini 3.8 Flash 또는 Ollama 모델과 대화하며, 필요 시 개인 문서를 시맨틱 검색하거나 저장합니다.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: '대화 응답 성공',
    type: AiChatResponseDto,
  })
  async chat(
    @CurrentUser() user: AuthUser,
    @Body() dto: AiChatDto,
  ): Promise<AiChatResponseDto> {
    return this.chatService.chat(user.username, dto);
  }

  @Post('stream')
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ZodValidationPipe(aiChatSchema))
  @ApiOperation({
    summary: 'AI 대화 실시간 SSE 스트리밍',
    description: 'Server-Sent Events (SSE) 방식으로 AI 답변 토큰을 실시간 스트리밍합니다.',
  })
  async streamChat(
    @CurrentUser() user: AuthUser,
    @Body() dto: AiChatDto,
    @Res() res: Response,
  ): Promise<void> {
    res.status(HttpStatus.OK);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    try {
      for await (const chunk of this.chatService.streamChat(
        user.username,
        dto,
      )) {
        res.write(`event: ${chunk.event}\ndata: ${chunk.data}\n\n`);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.write(
        `event: error\ndata: ${JSON.stringify({ error: message })}\n\n`,
      );
    } finally {
      res.end();
    }
  }
}
