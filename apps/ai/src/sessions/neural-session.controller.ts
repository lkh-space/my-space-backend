import {
  Controller,
  Get,
  Post,
  Body,
  UseGuards,
  HttpStatus,
  HttpCode,
  UsePipes,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiHeader } from '@nestjs/swagger';
import {
  RemoteUserGuard,
  type AuthUser,
} from '@app/common/guards/remote-user.guard.js';
import { CurrentUser } from '@app/common/decorators/current-user.decorator.js';
import { ZodValidationPipe } from '@app/common/pipes/zod-validation.pipe.js';
import { NeuralSessionService } from './neural-session.service.js';
import {
  CreateNeuralSessionDto,
  NeuralStreamSessionDto,
  createNeuralSessionSchema,
} from './dto/neural-session.dto.js';

@ApiTags('J.A.R.V.I.S. Neural Sessions')
@ApiHeader({
  name: 'Remote-User',
  description: '사용자 ID (프로덕션 필수, 로컬은 dev-admin)',
})
@UseGuards(RemoteUserGuard)
@Controller('api/v1/ai/sessions')
export class NeuralSessionController {
  constructor(private readonly sessionService: NeuralSessionService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '신경망 스트림 세션 목록 조회',
    description: '현재 사용자의 활성/저장된 J.A.R.V.I.S. 신경망 세션 목록을 반환합니다.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: '세션 목록 반환 성공',
    type: [NeuralStreamSessionDto],
  })
  async listSessions(
    @CurrentUser() user: AuthUser,
  ): Promise<NeuralStreamSessionDto[]> {
    return this.sessionService.listSessions(user.username);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UsePipes(new ZodValidationPipe(createNeuralSessionSchema))
  @ApiOperation({
    summary: '신규 신경망 스트림 세션 생성',
    description: '새로운 신경망 대화 세션을 생성합니다.',
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: '세션 생성 성공',
    type: NeuralStreamSessionDto,
  })
  async createSession(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateNeuralSessionDto,
  ): Promise<NeuralStreamSessionDto> {
    return this.sessionService.createSession(user.username, dto);
  }
}
