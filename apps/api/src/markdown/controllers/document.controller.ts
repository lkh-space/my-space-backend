/// <reference types="multer" />
import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  Res,
  HttpCode,
  HttpStatus,
  Headers,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiHeader,
  ApiConsumes,
  ApiBody,
} from '@nestjs/swagger';
import {
  RemoteUserGuard,
  type AuthUser,
} from '@app/common/guards/remote-user.guard.js';
import { CurrentUser } from '@app/common/decorators/current-user.decorator.js';
import { formatContentDisposition } from '@app/common/utils/content-disposition.util.js';
import { DocumentService } from '../services/document.service.js';
import {
  CreateDocumentDto,
  UpdateDocumentDto,
  DocumentQueryDto,
  DocumentDetailDto,
  DocumentListItemDto,
} from '../dto/document.dto.js';

export const MAX_MARKDOWN_FILE_SIZE = 10 * 1024 * 1024; // 10MB

export const MARKDOWN_IMPORT_LIMITS = {
  fileSize: MAX_MARKDOWN_FILE_SIZE,
  files: 1,
  fields: 5,
  fieldSize: 1024 * 1024,
};

@ApiTags('Markdown Documents')
@ApiHeader({
  name: 'Remote-User',
  description: '사용자 ID (프로덕션 환경 필수, 로컬은 Mock 유저 주입)',
})
@UseGuards(RemoteUserGuard)
@Controller('api/v1/markdown/documents')
export class DocumentController {
  constructor(private readonly documentService: DocumentService) {}

  @Post()
  @ApiOperation({
    summary: '새 마크다운 문서 생성',
    description: '새로운 마크다운 문서를 작성하여 저장하고, MinIO 본문 저장 및 OpenSearch 색인을 수행합니다.',
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: '문서 생성 성공',
    type: DocumentDetailDto,
  })
  async createDocument(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateDocumentDto,
  ): Promise<DocumentDetailDto> {
    return this.documentService.createDocument(user.username, dto);
  }

  @Get()
  @ApiOperation({
    summary: '문서 목록 조회',
    description: '폴더별 또는 태그별로 필터링된 문서 목록을 페이징하여 조회합니다.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: '문서 목록 조회 성공',
    type: [DocumentListItemDto],
  })
  async getDocuments(
    @CurrentUser() user: AuthUser,
    @Query() query: DocumentQueryDto,
  ) {
    return this.documentService.getDocuments(user.username, query);
  }

  @Get(':id')
  @ApiOperation({
    summary: '문서 상세 조회',
    description: '지정한 문서의 메타데이터와 MinIO에 저장된 본문 및 Frontmatter를 조회합니다.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: '문서 상세 조회 성공',
    type: DocumentDetailDto,
  })
  async getDocumentDetail(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ): Promise<DocumentDetailDto> {
    return this.documentService.getDocumentDetail(user.username, id);
  }

  @Put(':id')
  @ApiHeader({
    name: 'If-Match',
    description: '낙관적 잠금을 위한 대상 문서 버전 (예: "1" 또는 1). 불일치 시 409 Conflict 반환',
    required: false,
  })
  @ApiOperation({
    summary: '문서 수정',
    description: '문서의 제목, 본문, 폴더 또는 태그를 수정합니다. 본문 변경 시 자동으로 이전 버전 리비전이 생성되며, If-Match 헤더를 통한 낙관적 동시성 잠금을 지원합니다.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: '문서 수정 성공',
    type: DocumentDetailDto,
  })
  @ApiResponse({
    status: HttpStatus.CONFLICT,
    description: '동시 수정 충돌 발생 (다른 요청에 의해 버전이 이미 변경됨)',
  })
  async updateDocument(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateDocumentDto,
    @Headers('if-match') ifMatch?: string,
  ): Promise<DocumentDetailDto> {
    const cleaned = ifMatch ? ifMatch.replace(/["'W/]/g, '').trim() : undefined;
    const parsedHeaderVersion = cleaned && !isNaN(Number(cleaned)) ? Number(cleaned) : undefined;
    const expectedVersion = parsedHeaderVersion ?? dto.expectedVersion;

    return this.documentService.updateDocument(
      user.username,
      id,
      dto,
      expectedVersion,
    );
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: '문서 삭제',
    description: '문서를 삭제하고 연계된 MinIO 파일 및 OpenSearch 색인을 함께 정리합니다.',
  })
  @ApiResponse({
    status: HttpStatus.NO_CONTENT,
    description: '문서 삭제 성공',
  })
  async deleteDocument(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ): Promise<void> {
    await this.documentService.deleteDocument(user.username, id);
  }

  @Post('import')
  @UseInterceptors(FileInterceptor('file', { limits: MARKDOWN_IMPORT_LIMITS }))
  @ApiOperation({
    summary: '.md 파일 업로드하여 문서로 가져오기',
    description: '.md 파일을 업로드하여 Frontmatter와 제목을 자동 추출하고 신규 문서로 생성합니다.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: '가져올 .md 파일',
        },
        folderId: {
          type: 'string',
          format: 'uuid',
          description: '문서를 저장할 폴더 ID (선택)',
        },
      },
      required: ['file'],
    },
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: '문서 가져오기 성공',
    type: DocumentDetailDto,
  })
  async importMarkdown(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: Express.Multer.File,
    @Body('folderId') folderId?: string,
  ): Promise<DocumentDetailDto> {
    return this.documentService.importMarkdown(user.username, file, folderId);
  }

  @Get(':id/export/md')
  @ApiOperation({
    summary: '마크다운 문서 .md 원본 파일 다운로드',
    description: '현재 문서를 Frontmatter를 포함한 .md 파일로 다운로드합니다.',
  })
  async exportMarkdown(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Res() res: Response,
  ): Promise<void> {
    const { filename, content } = await this.documentService.exportMarkdown(
      user.username,
      id,
    );

    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader('Content-Disposition', formatContentDisposition(filename));
    res.send(content);
  }

  @Get(':id/export/pdf')
  @ApiOperation({
    summary: '마크다운 문서 PDF 파일 다운로드',
    description: '현재 문서의 내용을 기반으로 생성된 PDF 문서를 다운로드합니다.',
  })
  async exportPdf(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Res() res: Response,
  ): Promise<void> {
    const { filename, buffer } = await this.documentService.exportPdf(
      user.username,
      id,
    );

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', formatContentDisposition(filename));
    res.send(Buffer.from(buffer));
  }

  @Post(':id/export/pdf')
  @ApiOperation({
    summary: '마크다운 문서 PDF 파일 다운로드 (렌더링된 자산 포함)',
    description: '클라이언트에서 사전 렌더링된 다이어그램 및 수식 그래픽 자산을 포함하여 고품질 PDF 문서를 다운로드합니다.',
  })
  async exportPdfWithAssets(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body()
    body: {
      renderedAssets?: Array<{
        type: 'mermaid' | 'math' | string;
        code: string;
        imageBase64: string;
        width?: number;
        height?: number;
      }>;
    },
    @Res() res: Response,
  ): Promise<void> {
    const { filename, buffer } = await this.documentService.exportPdf(
      user.username,
      id,
      body,
    );

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', formatContentDisposition(filename));
    res.send(Buffer.from(buffer));
  }
}
