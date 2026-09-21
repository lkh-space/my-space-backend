import { Module } from '@nestjs/common';
import { PdfController } from './pdf.controller.js';
import { PdfService } from './pdf.service.js';
import { QpdfEngine } from './engines/qpdf.engine.js';
import { PdflibEngine } from './engines/pdflib.engine.js';
import { ZipEngine } from './engines/zip.engine.js';

@Module({
  controllers: [PdfController],
  providers: [PdfService, QpdfEngine, PdflibEngine, ZipEngine],
  exports: [PdfService],
})
export class PdfModule {}
