import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiHeader } from '@nestjs/swagger';
import {
  RemoteUserGuard,
  type AuthUser,
} from '../../common/guards/remote-user.guard.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { FolderService } from '../services/folder.service.js';
import {
  CreateFolderDto,
  UpdateFolderDto,
  FolderResponseDto,
} from '../dto/folder.dto.js';

@ApiTags('Markdown Folders')
@ApiHeader({
  name: 'Remote-User',
  description: '사용자 ID (프로덕션 환경 필수, 로컬은 Mock 유저 주입)',
})
@UseGuards(RemoteUserGuard)
@Controller('api/v1/markdown/folders')
export class FolderController {
  constructor(private readonly folderService: FolderService) {}

  @Get()
  @ApiOperation({
    summary: '폴더 전체 계층 트리 조회',
    description: '로그인 사용자의 모든 폴더를 부모-자식 트리 구조로 반환합니다.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: '폴더 트리 조회 성공',
    type: [FolderResponseDto],
  })
  async getFolderTree(
    @CurrentUser() user: AuthUser,
  ): Promise<FolderResponseDto[]> {
    return this.folderService.getFolderTree(user.username);
  }

  @Post()
  @ApiOperation({
    summary: '신규 폴더 생성',
    description: '새로운 폴더를 생성합니다. parentId를 지정하지 않으면 루트 폴더가 됩니다.',
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: '폴더 생성 성공',
    type: FolderResponseDto,
  })
  async createFolder(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateFolderDto,
  ): Promise<FolderResponseDto> {
    return this.folderService.createFolder(user.username, dto);
  }

  @Patch(':id')
  @ApiOperation({
    summary: '폴더 정보 수정 및 이동',
    description: '폴더 이름을 변경하거나 다른 상위 폴더로 이동합니다.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: '폴더 수정 성공',
    type: FolderResponseDto,
  })
  async updateFolder(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateFolderDto,
  ): Promise<FolderResponseDto> {
    return this.folderService.updateFolder(user.username, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: '폴더 삭제',
    description: '지정한 폴더를 삭제합니다. (하위 폴더는 함께 삭제되며, 속한 문서는 미분류 상태가 됩니다)',
  })
  @ApiResponse({
    status: HttpStatus.NO_CONTENT,
    description: '폴더 삭제 성공',
  })
  async deleteFolder(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ): Promise<void> {
    await this.folderService.deleteFolder(user.username, id);
  }
}
