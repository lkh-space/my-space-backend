import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { VersionService } from '@app/common';

/**
 * My Space AI Workspace API Swagger(OpenAPI) 문서 초기화
 *
 * @param app NestJS 애플리케이션 인스턴스
 * @returns Swagger UI 활성화 여부
 */
export function setupSwagger(app: INestApplication): boolean {
  const configService = app.get(ConfigService, { strict: false });
  const isSwaggerEnabled =
    configService?.get<boolean>('app.swaggerEnabled') ??
    (process.env.SWAGGER_ENABLED === 'true' ||
      process.env.ENABLE_SWAGGER === 'true' ||
      process.env.IS_LOCAL === 'true');

  if (!isSwaggerEnabled) {
    return false;
  }

  const versionService = app.get(VersionService, { strict: false });
  const appVersion = versionService?.getVersionInfo()?.version ?? '0.1.0';

  const swaggerConfig = new DocumentBuilder()
    .setTitle('My Space AI Workspace API')
    .setDescription(
      'J.A.R.V.I.S. Neural Core 실시간 음성 비서, Qdrant 시맨틱 검색, SSE 스트리밍 API',
    )
    .setVersion(appVersion)
    .addTag(
      'J.A.R.V.I.S. Voice & Neural Core',
      '실시간 음성/텍스트 SSE 스트리밍, 발화 인터럽트 및 오디오 서빙',
    )
    .addTag(
      'J.A.R.V.I.S. Neural Sessions',
      '신경망 스트림 세션 라이프사이클 관리',
    )
    .addTag('AI Chat', 'Gemini / Ollama 실시간 스트리밍 대화 및 Tool 연동')
    .addTag('AI Search', 'Qdrant 벡터 기반 마크다운 문서 시맨틱 검색')
    .addTag('System', '서버 헬스체크 및 런타임 상태 진단')
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document);

  return true;
}
