import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FolderService } from './folder.service.js';
import { PrismaService } from '../../storage/prisma/prisma.service.js';
import {
  FolderNotFoundException,
  FolderAlreadyExistsException,
  FolderCyclicDependencyException,
} from '../exceptions/markdown.exception.js';

describe('FolderService', () => {
  let service: FolderService;
  let prisma: PrismaService;

  beforeEach(() => {
    prisma = {
      folder: {
        findFirst: vi.fn(),
        findUnique: vi.fn(),
        findMany: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      },
    } as unknown as PrismaService;

    service = new FolderService(prisma);
  });

  describe('createFolder', () => {
    it('루트 폴더를 정상적으로 생성해야 한다', async () => {
      // given
      const ownerId = 'admin';
      const dto = { name: 'Architecture' };

      vi.mocked(prisma.folder.findFirst).mockResolvedValueOnce(null);
      vi.mocked(prisma.folder.create).mockResolvedValueOnce({
        id: 'f-1',
        name: 'Architecture',
        parentId: null,
        ownerId,
        createdAt: new Date('2026-10-05T10:00:00Z'),
        updatedAt: new Date('2026-10-05T10:00:00Z'),
      });

      // when
      const result = await service.createFolder(ownerId, dto);

      // then
      expect(result.id).toBe('f-1');
      expect(result.name).toBe('Architecture');
      expect(result.parentId).toBeNull();
      expect(result.children).toEqual([]);
    });

    it('동일 경로에 동일 이름의 폴더가 이미 있으면 FolderAlreadyExistsException을 던져야 한다', async () => {
      // given
      const ownerId = 'admin';
      const dto = { name: 'Architecture' };

      vi.mocked(prisma.folder.findFirst).mockResolvedValueOnce({
        id: 'f-existing',
        name: 'Architecture',
        parentId: null,
        ownerId,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // when & then
      await expect(service.createFolder(ownerId, dto)).rejects.toThrow(
        FolderAlreadyExistsException,
      );
    });

    it('상위 부모 폴더가 존재하지 않으면 FolderNotFoundException을 던져야 한다', async () => {
      // given
      const ownerId = 'admin';
      const dto = { name: 'Sub', parentId: 'non-existent-parent' };

      vi.mocked(prisma.folder.findFirst).mockResolvedValueOnce(null);

      // when & then
      await expect(service.createFolder(ownerId, dto)).rejects.toThrow(
        FolderNotFoundException,
      );
    });
  });

  describe('getFolderTree', () => {
    it('평탄한 폴더 목록을 계층 트리 구조로 올바르게 재구성해야 한다', async () => {
      // given
      const ownerId = 'admin';
      const rawFolders = [
        {
          id: 'root-1',
          name: 'Architecture',
          parentId: null,
          ownerId,
          createdAt: new Date('2026-10-05T10:00:00Z'),
          updatedAt: new Date('2026-10-05T10:00:00Z'),
        },
        {
          id: 'sub-1',
          name: 'Backend',
          parentId: 'root-1',
          ownerId,
          createdAt: new Date('2026-10-05T10:05:00Z'),
          updatedAt: new Date('2026-10-05T10:05:00Z'),
        },
        {
          id: 'root-2',
          name: 'Frontend',
          parentId: null,
          ownerId,
          createdAt: new Date('2026-10-05T10:10:00Z'),
          updatedAt: new Date('2026-10-05T10:10:00Z'),
        },
      ];

      vi.mocked(prisma.folder.findMany).mockResolvedValueOnce(rawFolders);

      // when
      const tree = await service.getFolderTree(ownerId);

      // then
      expect(tree).toHaveLength(2);
      expect(tree[0].id).toBe('root-1');
      expect(tree[0].children).toHaveLength(1);
      expect(tree[0].children[0].id).toBe('sub-1');
      expect(tree[1].id).toBe('root-2');
      expect(tree[1].children).toHaveLength(0);
    });
  });

  describe('updateFolder', () => {
    it('자기 자신을 부모로 설정하려고 하면 FolderCyclicDependencyException을 던져야 한다', async () => {
      // given
      const ownerId = 'admin';
      const folderId = 'f-1';
      const dto = { parentId: 'f-1' };

      vi.mocked(prisma.folder.findFirst).mockResolvedValueOnce({
        id: folderId,
        name: 'Root',
        parentId: null,
        ownerId,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // when & then
      await expect(
        service.updateFolder(ownerId, folderId, dto),
      ).rejects.toThrow(FolderCyclicDependencyException);
    });
  });

  describe('deleteFolder', () => {
    it('폴더가 존재하면 삭제를 정상 수행해야 한다', async () => {
      // given
      const ownerId = 'admin';
      const folderId = 'f-1';

      vi.mocked(prisma.folder.findFirst).mockResolvedValueOnce({
        id: folderId,
        name: 'Root',
        parentId: null,
        ownerId,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      vi.mocked(prisma.folder.delete).mockResolvedValueOnce({} as never);

      // when
      await service.deleteFolder(ownerId, folderId);

      // then
      expect(prisma.folder.delete).toHaveBeenCalledWith({
        where: { id: folderId },
      });
    });

    it('존재하지 않는 폴더 삭제 요청 시 FolderNotFoundException을 던져야 한다', async () => {
      // given
      const ownerId = 'admin';
      const folderId = 'not-found';

      vi.mocked(prisma.folder.findFirst).mockResolvedValueOnce(null);

      // when & then
      await expect(service.deleteFolder(ownerId, folderId)).rejects.toThrow(
        FolderNotFoundException,
      );
    });
  });
});
