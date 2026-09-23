/// <reference types="multer" />
import {
  Controller,
  Post,
  HttpCode,
  UseInterceptors,
  UploadedFile,
  UploadedFiles,
  Body,
  Res,
  HttpStatus,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import {
  ApiTags,
  ApiOperation,
  ApiConsumes,
  ApiBody,
  ApiResponse,
} from '@nestjs/swagger';
import { PdfService } from './pdf.service.js';
import { InspectPdfResponseDto } from './dto/inspect-pdf.dto.js';
import { InspectPdfDto } from './dto/inspect-pdf.dto.js';
import { UnlockPdfDto } from './dto/unlock-pdf.dto.js';
import { MergePdfDto } from './dto/merge-pdf.dto.js';
import { SplitAllPdfDto, SplitRangePdfDto } from './dto/split-pdf.dto.js';
import {
  validateSinglePdf,
  validateMultiplePdfs,
} from './utils/pdf-file.validator.js';
import { buildMergeInputs } from './utils/password.parser.js';

@ApiTags('PDF')
@Controller('api/v1/pdf')
export class PdfController {
  constructor(private readonly pdfService: PdfService) {}

  /**
   * PDF 정보 및 암호화 여부 사전 검사
   */
  @Post('inspect')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({
    summary: 'PDF 정보 및 암호화 여부 사전 검사',
    description:
      '업로드된 PDF 파일의 암호화 여부, 비밀번호 일치 검증, 총 페이지 수 및 메타데이터를 검사합니다.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description: 'PDF 파일 및 비밀번호(선택)',
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: '검사할 PDF 파일 (최대 50MB)',
        },
        password: {
          type: 'string',
          description: '암호화된 PDF 파일인 경우 검증할 비밀번호 (선택)',
        },
      },
      required: ['file'],
    },
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'PDF 검사 완료',
    type: InspectPdfResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: '잘못된 입력 또는 파일 제약 위반',
  })
  @ApiResponse({
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    description: '손상되었거나 유효하지 않은 PDF 형식',
  })
  async inspect(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: InspectPdfDto,
  ): Promise<InspectPdfResponseDto> {
    validateSinglePdf(file);
    return this.pdfService.inspect(file.buffer, dto.password);
  }

  /**
   * PDF 암호 해제 (클린 PDF 다운로드)
   */
  @Post('unlock')
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({
    summary: 'PDF 암호 해제 (클린 PDF 다운로드)',
    description:
      '비밀번호로 보호된 PDF의 암호를 영구 제거하고 클린 PDF 파일로 다운로드합니다.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description: '암호화된 PDF 파일 및 비밀번호(필수)',
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: '암호 해제할 PDF 파일 (최대 50MB)',
        },
        password: {
          type: 'string',
          description: 'PDF 암호 해제 비밀번호 (필수)',
        },
      },
      required: ['file', 'password'],
    },
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: '암호 해제된 클린 PDF 다운로드 (application/pdf)',
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: '비밀번호 불일치 또는 암호화되지 않은 PDF',
  })
  async unlock(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: UnlockPdfDto,
    @Res() res: Response,
  ): Promise<void> {
    validateSinglePdf(file);
    const unlockedBuffer = await this.pdfService.unlock(
      file.buffer,
      dto.password,
    );

    res.status(HttpStatus.OK);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="unlocked.pdf"');
    res.send(unlockedBuffer);
  }

  /**
   * PDF 병합 (2~20개 파일)
   */
  @Post('merge')
  @UseInterceptors(FilesInterceptor('files', 20))
  @ApiOperation({
    summary: 'PDF 파일 병합 (2~20개)',
    description:
      '여러 개의 PDF 파일을 하나의 PDF 파일로 순차 병합하여 다운로드합니다.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description: '병합할 복수 PDF 파일 및 비밀번호 배열',
    schema: {
      type: 'object',
      properties: {
        files: {
          type: 'array',
          items: {
            type: 'string',
            format: 'binary',
          },
          description: '병합할 PDF 파일 목록 (2~20개, 총합 100MB 이내)',
        },
        passwords: {
          type: 'string',
          description:
            '각 파일 인덱스별 비밀번호 (JSON 배열 문자열, 예: ["pw1", ""])',
        },
      },
      required: ['files'],
    },
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: '병합된 PDF 파일 다운로드 (application/pdf)',
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: '파일 개수 위반(2개 미만/20개 초과) 또는 비밀번호 미입력',
  })
  async merge(
    @UploadedFiles() files: Express.Multer.File[],
    @Body() dto: MergePdfDto,
    @Res() res: Response,
  ): Promise<void> {
    validateMultiplePdfs(files);
    const mergeInputs = buildMergeInputs(files, dto.passwords);
    const mergedBuffer = await this.pdfService.merge(mergeInputs);

    res.status(HttpStatus.OK);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="merged.pdf"');
    res.send(mergedBuffer);
  }

  /**
   * PDF 범위 분할 및 추출
   */
  @Post('split/range')
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({
    summary: 'PDF 특정 페이지 범위 추출 및 분할',
    description:
      '단일 PDF 파일에서 지정한 페이지 범위를 추출하여 새로운 PDF 파일로 다운로드합니다.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description: 'PDF 파일, 추출 범위(예: 1-3, 5), 비밀번호(선택)',
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: '분할 대상 PDF 파일 (최대 50MB)',
        },
        ranges: {
          type: 'string',
          description: '추출할 페이지 범위 (예: 1-3, 5, 8-10)',
          example: '1-2',
        },
        password: {
          type: 'string',
          description: '암호화된 PDF인 경우 비밀번호 (선택)',
        },
      },
      required: ['file', 'ranges'],
    },
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: '지정 범위가 추출된 PDF 다운로드 (application/pdf)',
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: '잘못된 페이지 범위 형식이거나 전체 페이지 수 초과',
  })
  async splitRange(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: SplitRangePdfDto,
    @Res() res: Response,
  ): Promise<void> {
    validateSinglePdf(file);
    const extractedBuffer = await this.pdfService.splitRange(
      file.buffer,
      dto.ranges,
      dto.password,
    );

    res.status(HttpStatus.OK);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="extracted.pdf"',
    );
    res.send(extractedBuffer);
  }

  /**
   * PDF 전체 페이지 분할 (ZIP 다운로드)
   */
  @Post('split/all')
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({
    summary: 'PDF 전체 페이지 낱장 분할 (ZIP 압축 다운로드)',
    description:
      'PDF의 모든 페이지를 각각 1페이지짜리 PDF로 분할하여 ZIP 파일로 압축 다운로드합니다.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description: 'PDF 파일 및 비밀번호(선택)',
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: '낱장 분할할 PDF 파일 (최대 50MB)',
        },
        password: {
          type: 'string',
          description: '암호화된 PDF인 경우 비밀번호 (선택)',
        },
      },
      required: ['file'],
    },
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: '분할된 PDF들이 담긴 ZIP 아카이브 다운로드 (application/zip)',
  })
  async splitAll(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: SplitAllPdfDto,
    @Res() res: Response,
  ): Promise<void> {
    validateSinglePdf(file);
    const zipBuffer = await this.pdfService.splitAll(file.buffer, dto.password);

    res.status(HttpStatus.OK);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="split-pages.zip"',
    );
    res.send(zipBuffer);
  }
}
