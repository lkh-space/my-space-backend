import { describe, it, expect, beforeEach, vi } from 'vitest';
import { VersionController } from './version.controller.js';
import { VersionService } from './version.service.js';
import { VersionResponseDto } from './dto/version-info.dto.js';

describe('VersionController', () => {
  let controller: VersionController;
  let service: VersionService;

  beforeEach(() => {
    // given
    service = new VersionService();
    controller = new VersionController(service);
  });

  it('GET /version 호출 시 서비스의 버전 정보를 반환해야 한다', () => {
    // given
    const mockInfo = new VersionResponseDto({
      name: '@my-space/api',
      version: '0.1.0',
      gitBranch: 'main',
      gitCommit: 'abc1234',
      buildTime: '2026-10-11T12:00:00.000Z',
      env: 'local',
    });
    vi.spyOn(service, 'getVersionInfo').mockReturnValue(mockInfo);

    // when
    const result = controller.getVersionInfo();

    // then
    expect(result).toBe(mockInfo);
    expect(result.name).toBe('@my-space/api');
    expect(result.version).toBe('0.1.0');
    expect(service.getVersionInfo).toHaveBeenCalledTimes(1);
  });
});
