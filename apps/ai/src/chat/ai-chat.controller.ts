import {
  Controller,
  Post,
  Body,
  UseGuards,
  HttpStatus,
  HttpCode,
  UsePipes,
  Req,
  Res,
  Logger,
} from '@nestjs/common';
import { once } from 'node:events';
import type { Request, Response } from 'express';
import { ApiTags, ApiOperation, ApiResponse, ApiHeader } from '@nestjs/swagger';
import {
  RemoteUserGuard,
  type AuthUser,
} from '@app/common/guards/remote-user.guard.js';
import { CurrentUser } from '@app/common/decorators/current-user.decorator.js';
import { ZodValidationPipe } from '@app/common/pipes/zod-validation.pipe.js';
import { BaseDomainException } from '@app/common/exceptions/domain.exception.js';
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
  private readonly logger = new Logger(AiChatController.name);

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
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const ac = new AbortController();
    req.on('close', () => {
      if (!res.writableEnded) {
        ac.abort();
      }
    });

    res.status(HttpStatus.OK);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    // 프록시 유휴 타임아웃 방지를 위한 15초 주기 Keep-Alive 주석 핑
    const hb = setInterval(() => {
      if (!res.writableEnded && !ac.signal.aborted) {
        res.write(': ping\n\n');
      }
    }, 15_000);

    const writeSseChunk = async (chunkStr: string): Promise<boolean> => {
      if (ac.signal.aborted || res.writableEnded) return false;
      const canContinue = res.write(chunkStr);
      if (!canContinue && !res.writableEnded && !ac.signal.aborted) {
        try {
          await once(res, 'drain', { signal: ac.signal });
        } catch {
          return false;
        }
      }
      return true;
    };

    try {
      for await (const chunk of this.chatService.streamChat(
        user.username,
        dto,
        ac.signal,
      )) {
        if (ac.signal.aborted) break;
        const sent = await writeSseChunk(
          `event: ${chunk.event}\ndata: ${chunk.data}\n\n`,
        );
        if (!sent) break;
      }
    } catch (err: unknown) {
      const errMessage = err instanceof Error ? err.message : String(err);
      this.logger.error(`[AiChatController] 스트리밍 중 예외 발생: ${errMessage}`);

      if (!ac.signal.aborted && !res.writableEnded) {
        const errorCode =
          err instanceof BaseDomainException ? err.code : 'AI_STREAM_ERROR';
        await writeSseChunk(
          `event: error\ndata: ${JSON.stringify({ code: errorCode })}\n\n`,
        );
      }
    } finally {
      clearInterval(hb);
      if (!res.writableEnded) {
        res.end();
      }
    }
  }
}
