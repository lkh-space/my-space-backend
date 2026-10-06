import { Test, TestingModule } from '@nestjs/testing';
import { describe, it, expect, beforeEach } from 'vitest';
import { VersionController } from './version.controller.js';
import { VersionService } from './version.service.js';
import { VersionResponseDto } from './dto/version-info.dto.js';

describe('VersionController', () => {
  let controller: VersionController;
  let service: VersionService;

  const mockVersionDto: VersionResponseDto = new VersionResponseDto({
    name: 'my-space-backend',
    version: '0.0.1',
    gitBranch: 'main',
    gitCommit: 'c334cc2',
    buildTime: '2026-10-03T16:45:00.000Z',
    env: 'production',
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [VersionController],
      providers: [
        {
          provide: VersionService,
          useValue: {
            getVersionInfo: () => mockVersionDto,
          },
        },
      ],
    }).compile();

    controller = module.get<VersionController>(VersionController);
    service = module.get<VersionService>(VersionService);
  });

  it('컨트롤러가 정의되어 있어야 한다', () => {
    // then
    expect(controller).toBeDefined();
    expect(service).toBeDefined();
  });

  it('getVersionInfo 호출 시 VersionService에서 반환한 DTO를 그대로 응답해야 한다', () => {
    // given
    // mockVersionDto가 준비됨

    // when
    const result = controller.getVersionInfo();

    // then
    expect(result).toEqual(mockVersionDto);
    expect(result.name).toBe('my-space-backend');
    expect(result.version).toBe('0.0.1');
    expect(result.gitCommit).toBe('c334cc2');
    expect(result.gitBranch).toBe('main');
  });
});
