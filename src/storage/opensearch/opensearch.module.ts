import { Module, Global } from '@nestjs/common';
import { OpenSearchService } from './opensearch.service.js';

@Global()
@Module({
  providers: [OpenSearchService],
  exports: [OpenSearchService],
})
export class OpenSearchModule {}
