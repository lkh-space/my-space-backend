import { Injectable } from '@nestjs/common';
import { PrismaService } from '@app/storage/prisma/prisma.service.js';
import {
  CreateFolderDto,
  UpdateFolderDto,
  FolderResponseDto,
} from '../dto/folder.dto.js';
import {
  FolderNotFoundException,
  FolderAlreadyExistsException,
  FolderCyclicDependencyException,
} from '../exceptions/markdown.exception.js';

interface RawFolder {
  id: string;
  name: string;
  parentId: string | null;
  ownerId: string;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class FolderService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 신규 폴더 생성
   */
  async createFolder(
    ownerId: string,
    dto: CreateFolderDto,
  ): Promise<FolderResponseDto> {
    const parentId = dto.parentId || null;

    // 상위 부모 폴더 유효성 검증
    if (parentId) {
      const parent = await this.prisma.folder.findFirst({
        where: { id: parentId, ownerId },
      });
      if (!parent) {
        throw new FolderNotFoundException(parentId);
      }
    }

    // 동일 경로 내 중복 이름 검증
    const existing = await this.prisma.folder.findFirst({
      where: {
        name: dto.name,
        parentId,
        ownerId,
      },
    });

    if (existing) {
      throw new FolderAlreadyExistsException(dto.name, parentId);
    }

    const created = await this.prisma.folder.create({
      data: {
        name: dto.name,
        parentId,
        ownerId,
      },
    });

    return new FolderResponseDto({
      id: created.id,
      name: created.name,
      parentId: created.parentId,
      createdAt: created.createdAt.toISOString(),
      updatedAt: created.updatedAt.toISOString(),
      children: [],
    });
  }

  /**
   * 사용자의 전체 폴더 계층 트리 목록 조회
   */
  async getFolderTree(ownerId: string): Promise<FolderResponseDto[]> {
    const folders: RawFolder[] = await this.prisma.folder.findMany({
      where: { ownerId },
      orderBy: { name: 'asc' },
    });

    return this.buildTree(folders);
  }

  /**
   * 폴더 정보 수정 (이름 변경 및 상위 폴더 이동)
   */
  async updateFolder(
    ownerId: string,
    folderId: string,
    dto: UpdateFolderDto,
  ): Promise<FolderResponseDto> {
    const folder = await this.prisma.folder.findFirst({
      where: { id: folderId, ownerId },
    });

    if (!folder) {
      throw new FolderNotFoundException(folderId);
    }

    const newName = dto.name !== undefined ? dto.name : folder.name;
    const newParentId =
      dto.parentId !== undefined ? dto.parentId : folder.parentId;

    // 부모 폴더가 변경되는 경우 순환 참조 검증
    if (dto.parentId !== undefined && dto.parentId !== folder.parentId) {
      if (dto.parentId === folderId) {
        throw new FolderCyclicDependencyException(folderId, dto.parentId);
      }

      if (dto.parentId !== null) {
        const targetParent = await this.prisma.folder.findFirst({
          where: { id: dto.parentId, ownerId },
        });

        if (!targetParent) {
          throw new FolderNotFoundException(dto.parentId);
        }

        // targetParent의 상위 체인을 검사하여 folderId가 포함되어 있는지 확인
        let currentParentId: string | null = targetParent.parentId;
        while (currentParentId) {
          if (currentParentId === folderId) {
            throw new FolderCyclicDependencyException(folderId, dto.parentId);
          }
          const ancestor = await this.prisma.folder.findUnique({
            where: { id: currentParentId },
          });
          currentParentId = ancestor?.parentId || null;
        }
      }
    }

    // 동일 부모 내 중복 이름 검증
    if (newName !== folder.name || newParentId !== folder.parentId) {
      const conflict = await this.prisma.folder.findFirst({
        where: {
          name: newName,
          parentId: newParentId,
          ownerId,
          NOT: { id: folderId },
        },
      });

      if (conflict) {
        throw new FolderAlreadyExistsException(newName, newParentId);
      }
    }

    const updated = await this.prisma.folder.update({
      where: { id: folderId },
      data: {
        name: newName,
        parentId: newParentId,
      },
    });

    return new FolderResponseDto({
      id: updated.id,
      name: updated.name,
      parentId: updated.parentId,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
      children: [],
    });
  }

  /**
   * 폴더 삭제 (하위 폴더는 cascade 삭제, 문서는 folderId = null 처리)
   */
  async deleteFolder(ownerId: string, folderId: string): Promise<void> {
    const folder = await this.prisma.folder.findFirst({
      where: { id: folderId, ownerId },
    });

    if (!folder) {
      throw new FolderNotFoundException(folderId);
    }

    await this.prisma.folder.delete({
      where: { id: folderId },
    });
  }

  /**
   * 평탄한 폴더 배열을 계층형 트리 구조로 변환
   */
  private buildTree(folders: RawFolder[]): FolderResponseDto[] {
    const map = new Map<string, FolderResponseDto>();
    const roots: FolderResponseDto[] = [];

    // 먼저 모든 폴더를 DTO로 매핑
    for (const f of folders) {
      map.set(
        f.id,
        new FolderResponseDto({
          id: f.id,
          name: f.name,
          parentId: f.parentId,
          createdAt: f.createdAt.toISOString(),
          updatedAt: f.updatedAt.toISOString(),
          children: [],
        }),
      );
    }

    // 부모-자식 트리 연결
    for (const f of folders) {
      const node = map.get(f.id)!;
      if (f.parentId && map.has(f.parentId)) {
        map.get(f.parentId)!.children.push(node);
      } else {
        roots.push(node);
      }
    }

    return roots;
  }
}
