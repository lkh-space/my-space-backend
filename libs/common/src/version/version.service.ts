import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { VersionResponseDto } from './dto/version-info.dto.js';
import {
  VERSION_MODULE_OPTIONS,
  type VersionModuleOptions,
} from './version.constants.js';

@Injectable()
export class VersionService {
  private readonly logger = new Logger(VersionService.name);
  private cachedInfo?: VersionResponseDto;
  private readonly startupTime = new Date().toISOString();

  constructor(
    @Optional()
    @Inject(VERSION_MODULE_OPTIONS)
    private readonly options: VersionModuleOptions = {},
  ) {}

  /**
   * 애플리케이션 버전 및 빌드 메타데이터 반환 (인메모리 캐시 적용)
   */
  getVersionInfo(): VersionResponseDto {
    if (this.cachedInfo) {
      return this.cachedInfo;
    }

    const pkg = this.loadPackageJson();
    const name = process.env.APP_NAME || pkg.name;
    const version = process.env.APP_VERSION || pkg.version;
    const gitBranch = this.resolveGitBranch();
    const gitCommit = this.resolveGitCommit();
    const buildTime = process.env.BUILD_TIME || this.startupTime;
    const env =
      process.env.NODE_ENV ||
      (process.env.IS_LOCAL === 'true' ? 'local' : 'development');

    this.cachedInfo = new VersionResponseDto({
      name,
      version,
      gitBranch,
      gitCommit,
      buildTime,
      env,
    });

    return this.cachedInfo;
  }

  /**
   * 워크스페이스 또는 앱의 package.json에서 name 및 version 로드
   */
  private loadPackageJson(): { name: string; version: string } {
    const fallbackName = this.options.appName
      ? `@my-space/${this.options.appName}`
      : 'my-space-backend';
    const fallbackVersion = this.options.defaultVersion || '0.1.0';

    try {
      const pkgPath = this.resolvePackageJsonPath();
      if (!pkgPath || !existsSync(pkgPath)) {
        return { name: fallbackName, version: fallbackVersion };
      }

      const content = readFileSync(pkgPath, 'utf-8');
      const parsed = JSON.parse(content) as {
        name?: string;
        version?: string;
      };

      return {
        name: parsed.name || fallbackName,
        version: parsed.version || fallbackVersion,
      };
    } catch (error) {
      this.logger.debug(
        `package.json 로드 실패, 기본값 사용: ${(error as Error).message}`,
      );
      return {
        name: fallbackName,
        version: fallbackVersion,
      };
    }
  }

  /**
   * 대상 package.json 파일 경로 탐색
   */
  private resolvePackageJsonPath(): string | undefined {
    if (this.options.packageJsonPath) {
      return this.options.packageJsonPath;
    }

    const appName =
      this.options.appName ||
      (process.env.APP_NAME
        ? process.env.APP_NAME.replace('@my-space/', '')
        : undefined);

    if (appName) {
      // 1순위: 루트에서 실행 시 apps/<appName>/package.json
      const appPkg = resolve(process.cwd(), 'apps', appName, 'package.json');
      if (existsSync(appPkg)) {
        return appPkg;
      }
    }

    // 2순위: 현재 실행 경로의 package.json (컨테이너 내부 또는 앱 디렉토리 실행 시)
    const cwdPkg = resolve(process.cwd(), 'package.json');
    if (existsSync(cwdPkg)) {
      return cwdPkg;
    }

    return undefined;
  }

  /**
   * Git 브랜치명 확인 (환경변수 -> 로컬 Git CLI -> fallback)
   */
  private resolveGitBranch(): string {
    if (process.env.GIT_BRANCH) {
      return process.env.GIT_BRANCH;
    }

    // 로컬 환경 또는 프로덕션이 아닐 때 git CLI 시도
    if (
      process.env.IS_LOCAL === 'true' ||
      process.env.NODE_ENV !== 'production'
    ) {
      try {
        const branch = execSync('git rev-parse --abbrev-ref HEAD', {
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'ignore'],
        }).trim();
        if (branch) {
          return branch;
        }
      } catch {
        // git 미설치 또는 .git 누락 환경
      }
    }

    return 'unknown';
  }

  /**
   * Git 커밋 해시 확인 (환경변수 -> 로컬 Git CLI -> fallback)
   */
  private resolveGitCommit(): string {
    if (process.env.GIT_COMMIT) {
      // 40자리 전체 해시일 경우 앞 7자리로 단축하거나 그대로 사용
      return process.env.GIT_COMMIT.length > 7
        ? process.env.GIT_COMMIT.slice(0, 7)
        : process.env.GIT_COMMIT;
    }

    // 로컬 환경 또는 프로덕션이 아닐 때 git CLI 시도
    if (
      process.env.IS_LOCAL === 'true' ||
      process.env.NODE_ENV !== 'production'
    ) {
      try {
        const commit = execSync('git rev-parse --short HEAD', {
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'ignore'],
        }).trim();
        if (commit) {
          return commit;
        }
      } catch {
        // git 미설치 또는 .git 누락 환경
      }
    }

    return 'unknown';
  }
}
