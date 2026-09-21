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
import { PdfService } from './pdf.service.js';
import type { InspectPdfResponseDto } from './dto/inspect-pdf.dto.js';
import { InspectPdfDto } from './dto/inspect-pdf.dto.js';
import { UnlockPdfDto } from './dto/unlock-pdf.dto.js';
import { MergePdfDto } from './dto/merge-pdf.dto.js';
import { SplitAllPdfDto, SplitRangePdfDto } from './dto/split-pdf.dto.js';
import {
  validateSinglePdf,
  validateMultiplePdfs,
} from './utils/pdf-file.validator.js';
import { buildMergeInputs } from './utils/password.parser.js';

@Controller('api/v1/pdf')
export class PdfController {
  constructor(private readonly pdfService: PdfService) {}

  /**
   * PDF 정보 및 암호화 여부 사전 검사
   */
  @Post('inspect')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('file'))
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
