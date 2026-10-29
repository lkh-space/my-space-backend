import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { VersionService } from '@app/common';

/**
 * My Space Backend API Swagger(OpenAPI) 문서 초기화
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
    .setTitle('My Space Backend API')
    .setDescription(
      '개인 맞춤형 유틸리티 백엔드 플랫폼 REST API 명세 및 대화형 테스트 플랫폼',
    )
    .setVersion(appVersion)
    .addTag('System', '애플리케이션 상태 및 버전 정보 API')
    .addTag('PDF', 'PDF 파일 정보 검사, 암호 해제, 병합 및 분할 API')
    .addTag('Auth', 'Authelia SSO 기반 사용자 프로필 및 권한 정보 API')
    .addTag('Markdown Documents', '개인 마크다운 문서 생성, 조회, 수정, 삭제 및 Import/Export API')
    .addTag('Markdown Folders', '계층형 문서 폴더 관리 API')
    .addTag('Markdown Tags', '논리적 문서 태그 목록 및 통계 API')
    .addTag('Markdown Revisions', '문서 수정 이력, 버전 비교 및 복원 API')
    .addTag('Markdown Search', 'OpenSearch 기반 본문/제목/태그 풀텍스트 검색 API')
    .addTag('Markdown Assets', '마크다운 첨부 이미지 업로드 및 스트리밍 API')
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document, {
    swaggerOptions: {
      persistAuthorization: true,
    },
  });

  return true;
}
