/**
 * Repository 实现。
 *
 * 每个实现负责 Prisma Model ↔ 业务领域类型的转换，
 * 对外只暴露 interfaces.ts 中定义的接口。
 *
 * 注意：Prisma Client 的类型不出现在任何导出的签名里——
 * 实现类可以持有它，但接口不能。
 */

import type { PrismaClient } from '../../generated/client/client.js'
import type { DocumentContentUncheckedUpdateInput as PrismaDocumentContentUncheckedUpdateInput } from '../../generated/client/models/DocumentContent.js'
import type {
  AclRepository,
  AttachmentsRepository,
  AuditRepository,
  ContentsRepository,
  NodesRepository,
  Repositories,
  UsersRepository,
  VersionsRepository,
  WorkspacesRepository,
} from './interfaces.js'
import type {
  AclEntry,
  Attachment,
  AuditEvent,
  CreateAclInput,
  CreateAuditInput,
  CreateNodeInput,
  CreateUserInput,
  DocumentContent,
  SaveContentInput,
  Session,
  TreeNode,
  UpdateNodeInput,
  User,
  Version,
  Workspace,
  WorkspaceMember,
  WorkspaceRole,
} from './types.js'

/** Prisma Model 的行类型（内部用，不外泄）。 */
type PrismaUser = {
  id: string
  email: string
  emailLower: string
  passwordHash: string
  displayName: string
  avatarKey: string | null
  status: string
  createdAt: Date
  updatedAt: Date
  lastLoginAt: Date | null
}

type PrismaWorkspace = {
  id: string
  name: string
  ownerId: string
  defaultRole: string
  createdAt: Date
  updatedAt: Date
  deletedAt: Date | null
}

type PrismaNode = {
  id: string
  workspaceId: string
  parentId: string | null
  type: string
  title: string
  titleNorm: string
  ownerId: string
  visibility: string
  sortOrder: number
  createdAt: Date
  updatedAt: Date
  deletedAt: Date | null
  deletedBy: string | null
  trashRootId: string | null
}

type PrismaContent = {
  nodeId: string
  contentSchemaVersion: number
  yjsSchemaVersion: number
  contentJson: unknown
  yjsState: Uint8Array | null
  stateVector: Uint8Array | null
  docSizeBytes: number
  revision: number
  textPreview: string | null
  charCount: number
  updatedAt: Date
  storedAt: Date | null
}

type PrismaAcl = {
  id: string
  nodeId: string
  subjectType: string
  subjectId: string
  role: string
  effect: string
  createdBy: string
  createdAt: Date
}

type PrismaVersion = {
  id: string
  nodeId: string
  versionNo: number
  kind: string
  label: string | null
  contentSchemaVersion: number
  yjsSchemaVersion: number
  contentJson: unknown
  yjsState: Uint8Array | null
  createdBy: string | null
  createdAt: Date
}

type PrismaAttachment = {
  id: string
  workspaceId: string
  nodeId: string | null
  uploaderId: string
  originalName: string
  mimeType: string
  byteSize: number
  sha256: string
  storageKey: string
  width: number | null
  height: number | null
  createdAt: Date
}

type PrismaAudit = {
  id: number
  workspaceId: string
  actorId: string | null
  action: string
  targetType: string
  targetId: string | null
  metadata: unknown
  ip: string | null
  createdAt: Date
}

// ---------------------------------------------------------------- 转换函数

function toUser(row: PrismaUser): User {
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    avatarKey: row.avatarKey,
    status: row.status as User['status'],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastLoginAt: row.lastLoginAt,
  }
}

function toWorkspace(row: PrismaWorkspace): Workspace {
  return {
    id: row.id,
    name: row.name,
    ownerId: row.ownerId,
    defaultRole: row.defaultRole as Workspace['defaultRole'],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  }
}

function toNode(row: PrismaNode): TreeNode {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    parentId: row.parentId,
    type: row.type as TreeNode['type'],
    title: row.title,
    titleNormalized: row.titleNorm,
    ownerId: row.ownerId,
    visibility: row.visibility as TreeNode['visibility'],
    sortOrder: row.sortOrder,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
    deletedBy: row.deletedBy,
    trashRootId: row.trashRootId,
  }
}

function toContent(row: PrismaContent): DocumentContent {
  return {
    nodeId: row.nodeId,
    contentSchemaVersion: row.contentSchemaVersion,
    yjsSchemaVersion: row.yjsSchemaVersion,
    contentJson: row.contentJson ?? null,
    yjsState: row.yjsState ?? null,
    stateVector: row.stateVector ?? null,
    docSizeBytes: row.docSizeBytes,
    revision: row.revision,
    textPreview: row.textPreview,
    charCount: row.charCount,
    updatedAt: row.updatedAt,
    storedAt: row.storedAt,
  }
}

function toAcl(row: PrismaAcl): AclEntry {
  return {
    id: row.id,
    nodeId: row.nodeId,
    subjectType: row.subjectType as AclEntry['subjectType'],
    subjectId: row.subjectId,
    role: row.role,
    effect: row.effect as AclEntry['effect'],
    createdBy: row.createdBy,
    createdAt: row.createdAt,
  }
}

function toVersion(row: PrismaVersion): Version {
  return {
    id: row.id,
    nodeId: row.nodeId,
    versionNo: row.versionNo,
    kind: row.kind as Version['kind'],
    label: row.label,
    contentSchemaVersion: row.contentSchemaVersion,
    yjsSchemaVersion: row.yjsSchemaVersion,
    contentJson: row.contentJson,
    yjsState: row.yjsState ?? null,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
  }
}

function toAttachment(row: PrismaAttachment): Attachment {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    nodeId: row.nodeId,
    uploaderId: row.uploaderId,
    originalName: row.originalName,
    mimeType: row.mimeType,
    byteSize: row.byteSize,
    sha256: row.sha256,
    storageKey: row.storageKey,
    width: row.width,
    height: row.height,
    createdAt: row.createdAt,
  }
}

function toAudit(row: PrismaAudit): AuditEvent {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    actorId: row.actorId,
    action: row.action,
    targetType: row.targetType,
    targetId: row.targetId,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    ip: row.ip,
    createdAt: row.createdAt,
  }
}

/** 邮箱归一化：小写去空白。emailLower 唯一索引靠它保证大小写不敏感唯一。 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

/** 标题归一化：小写去空白。仅用于检索。 */
export function normalizeTitle(title: string): string {
  return title.trim().toLowerCase()
}

/**
 * 把 Uint8Array 窄化为 Prisma 的 Bytes 类型。
 *
 * Prisma 的 Bytes 是 `Uint8Array<ArrayBuffer>`（TS 5.7+ 之后 Uint8Array
 * 的泛型参数区分 ArrayBuffer 与 SharedArrayBuffer）。领域层用宽松的
 * `Uint8Array`，写入时需要一次显式窄化——内容完全相同，只是类型声明更严。
 *
 * 这个转换属于 Prisma 特有的实现细节，只允许出现在实现层。
 */
function toBytes(data: Uint8Array): Uint8Array<ArrayBuffer> {
  return new Uint8Array(data) as Uint8Array<ArrayBuffer>
}

// ---------------------------------------------------------------- 实现

class UsersRepositoryImpl implements UsersRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(id: string): Promise<User | null> {
    const row = (await this.prisma.user.findUnique({ where: { id } })) as PrismaUser | null
    return row ? toUser(row) : null
  }

  async findByEmail(email: string): Promise<User | null> {
    const row = (await this.prisma.user.findUnique({
      where: { emailLower: normalizeEmail(email) },
    })) as PrismaUser | null
    return row ? toUser(row) : null
  }

  async create(input: CreateUserInput): Promise<User> {
    const row = (await this.prisma.user.create({
      data: {
        id: input.id,
        email: input.email,
        emailLower: normalizeEmail(input.email),
        passwordHash: input.passwordHash,
        displayName: input.displayName,
        status: 'active',
      },
    })) as PrismaUser
    return toUser(row)
  }

  async updateDisplayName(id: string, displayName: string): Promise<User> {
    const row = (await this.prisma.user.update({
      where: { id },
      data: { displayName },
    })) as PrismaUser
    return toUser(row)
  }

  async touchLastLogin(id: string, at: Date): Promise<void> {
    await this.prisma.user.update({ where: { id }, data: { lastLoginAt: at } })
  }

  async createSession(input: {
    id: string
    userId: string
    tokenHash: Uint8Array
    expiresAt: Date
    ip?: string | null
    userAgent?: string | null
  }): Promise<Session> {
    const row = (await this.prisma.session.create({
      data: {
        id: input.id,
        userId: input.userId,
        tokenHash: toBytes(input.tokenHash),
        expiresAt: input.expiresAt,
        ip: input.ip ?? null,
        userAgent: input.userAgent ?? null,
      },
    })) as {
      id: string
      userId: string
      expiresAt: Date
      createdAt: Date
      lastSeenAt: Date
      revokedAt: Date | null
    }
    return {
      id: row.id,
      userId: row.userId,
      expiresAt: row.expiresAt,
      createdAt: row.createdAt,
      lastSeenAt: row.lastSeenAt,
      revokedAt: row.revokedAt,
    }
  }

  async findSessionByTokenHash(tokenHash: Uint8Array): Promise<Session | null> {
    const row = (await this.prisma.session.findUnique({
      where: { tokenHash: toBytes(tokenHash) },
    })) as
      | {
          id: string
          userId: string
          expiresAt: Date
          createdAt: Date
          lastSeenAt: Date
          revokedAt: Date | null
        }
      | null
    if (!row) return null
    return {
      id: row.id,
      userId: row.userId,
      expiresAt: row.expiresAt,
      createdAt: row.createdAt,
      lastSeenAt: row.lastSeenAt,
      revokedAt: row.revokedAt,
    }
  }

  async revokeSession(id: string, at: Date): Promise<void> {
    await this.prisma.session.update({ where: { id }, data: { revokedAt: at } })
  }

  async deleteExpiredSessions(before: Date): Promise<number> {
    const result = await this.prisma.session.deleteMany({
      where: { expiresAt: { lt: before } },
    })
    return result.count
  }
}

class WorkspacesRepositoryImpl implements WorkspacesRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(id: string): Promise<Workspace | null> {
    const row = (await this.prisma.workspace.findUnique({ where: { id } })) as PrismaWorkspace | null
    return row ? toWorkspace(row) : null
  }

  async create(input: {
    id: string
    name: string
    ownerId: string
    defaultRole?: 'view' | 'comment' | 'edit'
  }): Promise<Workspace> {
    // 创建空间与添加 owner 成员必须原子——否则会出现"空间存在但无 owner"
    const [row] = await this.prisma.$transaction([
      this.prisma.workspace.create({
        data: {
          id: input.id,
          name: input.name,
          ownerId: input.ownerId,
          defaultRole: input.defaultRole ?? 'edit',
        },
      }),
      this.prisma.workspaceMember.create({
        data: { workspaceId: input.id, userId: input.ownerId, role: 'owner' },
      }),
    ])
    return toWorkspace(row as PrismaWorkspace)
  }

  async update(
    id: string,
    input: { name?: string; defaultRole?: Workspace['defaultRole'] },
  ): Promise<Workspace> {
    const row = (await this.prisma.workspace.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.defaultRole !== undefined ? { defaultRole: input.defaultRole } : {}),
      },
    })) as PrismaWorkspace
    return toWorkspace(row)
  }

  async listForUser(userId: string): Promise<Workspace[]> {
    const rows = (await this.prisma.workspace.findMany({
      where: { members: { some: { userId } } },
      orderBy: { createdAt: 'asc' },
    })) as PrismaWorkspace[]
    return rows.map(toWorkspace)
  }

  async listMembers(workspaceId: string): Promise<WorkspaceMember[]> {
    const rows = (await this.prisma.workspaceMember.findMany({
      where: { workspaceId },
    })) as {
      workspaceId: string
      userId: string
      role: string
      createdAt: Date
    }[]
    return rows.map((r) => ({
      workspaceId: r.workspaceId,
      userId: r.userId,
      role: r.role as WorkspaceRole,
      createdAt: r.createdAt,
    }))
  }

  async findMemberRole(workspaceId: string, userId: string): Promise<WorkspaceRole | null> {
    const row = (await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
    })) as { role: string } | null
    return row ? (row.role as WorkspaceRole) : null
  }

  async upsertMember(input: {
    workspaceId: string
    userId: string
    role: WorkspaceRole
  }): Promise<WorkspaceMember> {
    const row = (await this.prisma.workspaceMember.upsert({
      where: {
        workspaceId_userId: { workspaceId: input.workspaceId, userId: input.userId },
      },
      create: {
        workspaceId: input.workspaceId,
        userId: input.userId,
        role: input.role,
      },
      update: { role: input.role },
    })) as { workspaceId: string; userId: string; role: string; createdAt: Date }
    return {
      workspaceId: row.workspaceId,
      userId: row.userId,
      role: row.role as WorkspaceRole,
      createdAt: row.createdAt,
    }
  }

  async removeMember(workspaceId: string, userId: string): Promise<boolean> {
    const result = await this.prisma.workspaceMember.deleteMany({
      where: { workspaceId, userId },
    })
    return result.count > 0
  }
}

class NodesRepositoryImpl implements NodesRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(id: string): Promise<TreeNode | null> {
    const row = (await this.prisma.node.findUnique({ where: { id } })) as PrismaNode | null
    return row ? toNode(row) : null
  }

  async create(input: CreateNodeInput): Promise<TreeNode> {
    const row = (await this.prisma.node.create({
      data: {
        id: input.id,
        workspaceId: input.workspaceId,
        parentId: input.parentId ?? null,
        type: input.type,
        title: input.title,
        titleNorm: normalizeTitle(input.title),
        ownerId: input.ownerId,
        visibility: input.visibility ?? 'workspace',
        sortOrder: 0,
      },
    })) as PrismaNode
    return toNode(row)
  }

  async update(id: string, input: UpdateNodeInput): Promise<TreeNode> {
    const row = (await this.prisma.node.update({
      where: { id },
      data: {
        ...(input.title !== undefined
          ? { title: input.title, titleNorm: normalizeTitle(input.title) }
          : {}),
        ...(input.parentId !== undefined ? { parentId: input.parentId } : {}),
        ...(input.visibility !== undefined ? { visibility: input.visibility } : {}),
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
        ...(input.deletedAt !== undefined ? { deletedAt: input.deletedAt } : {}),
        ...(input.deletedBy !== undefined ? { deletedBy: input.deletedBy } : {}),
        ...(input.trashRootId !== undefined ? { trashRootId: input.trashRootId } : {}),
      },
    })) as PrismaNode
    return toNode(row)
  }

  async softDelete(input: {
    id: string
    deletedAt: Date
    deletedBy: string
    trashRootId: string
  }): Promise<number> {
    // 子树批量标记，trashRootId 统一，便于整批还原
    const ids = await this.collectSubtreeIds(input.id)
    const result = await this.prisma.node.updateMany({
      where: { id: { in: ids } },
      data: {
        deletedAt: input.deletedAt,
        deletedBy: input.deletedBy,
        trashRootId: input.trashRootId,
      },
    })
    return result.count
  }

  async restore(input: { trashRootId: string; restoredAt: Date }): Promise<number> {
    const result = await this.prisma.node.updateMany({
      where: { trashRootId: input.trashRootId },
      data: { deletedAt: null, deletedBy: null, trashRootId: null },
    })
    return result.count
  }

  async purge(id: string): Promise<boolean> {
    const result = await this.prisma.node.deleteMany({ where: { id } })
    return result.count > 0
  }

  async listTree(workspaceId: string): Promise<TreeNode[]> {
    const rows = (await this.prisma.node.findMany({
      where: { workspaceId, deletedAt: null },
      orderBy: [{ parentId: 'asc' }, { sortOrder: 'asc' }],
    })) as PrismaNode[]
    return rows.map(toNode)
  }

  async listTrash(workspaceId: string): Promise<TreeNode[]> {
    const rows = (await this.prisma.node.findMany({
      where: { workspaceId, deletedAt: { not: null } },
      orderBy: { deletedAt: 'desc' },
    })) as PrismaNode[]
    return rows.map(toNode)
  }

  async listAncestors(id: string): Promise<TreeNode[]> {
    // 逐级向上，直到根。深度上限 8（架构文档 §7.3），不会无限循环。
    const ancestors: TreeNode[] = []
    let current = await this.findById(id)
    while (current?.parentId) {
      const parent = await this.findById(current.parentId)
      if (!parent) break
      ancestors.unshift(parent)
      current = parent
      if (ancestors.length > 16) break
    }
    return ancestors
  }

  async listChildIds(id: string): Promise<string[]> {
    const rows = (await this.prisma.node.findMany({
      where: { parentId: id },
      select: { id: true },
    })) as { id: string }[]
    return rows.map((r) => r.id)
  }

  async searchByTitle(workspaceId: string, keyword: string): Promise<TreeNode[]> {
    const rows = (await this.prisma.node.findMany({
      where: {
        workspaceId,
        deletedAt: null,
        titleNorm: { startsWith: normalizeTitle(keyword) },
      },
      orderBy: { updatedAt: 'desc' },
    })) as PrismaNode[]
    return rows.map(toNode)
  }

  /** 收集子树所有 id（含自身）。 */
  private async collectSubtreeIds(rootId: string): Promise<string[]> {
    const ids: string[] = [rootId]
    let frontier = [rootId]
    while (frontier.length > 0) {
      const children = await this.prisma.node.findMany({
        where: { parentId: { in: frontier } },
        select: { id: true },
      })
      const next = (children as { id: string }[]).map((c) => c.id)
      if (next.length === 0) break
      ids.push(...next)
      frontier = next
    }
    return ids
  }
}

class ContentsRepositoryImpl implements ContentsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findByNodeId(nodeId: string): Promise<DocumentContent | null> {
    const row = (await this.prisma.documentContent.findUnique({
      where: { nodeId },
    })) as PrismaContent | null
    return row ? toContent(row) : null
  }

  async create(input: { nodeId: string; contentJson: unknown }): Promise<DocumentContent> {
    const row = (await this.prisma.documentContent.create({
      data: {
        nodeId: input.nodeId,
        contentJson: input.contentJson as never,
        contentSchemaVersion: 1,
        yjsSchemaVersion: 1,
      },
    })) as PrismaContent
    return toContent(row)
  }

  async save(
    input: SaveContentInput & { expectedRevision?: number },
  ): Promise<DocumentContent> {
    // 乐观锁：期望版本不匹配时抛错，由上层转 409（架构文档 §9.1）
    if (input.expectedRevision !== undefined) {
      const current = await this.findByNodeId(input.nodeId)
      if (!current) throw new Error(`正文不存在：${input.nodeId}`)
      if (current.revision !== input.expectedRevision) {
        throw new Error(`版本冲突：期望 ${input.expectedRevision}，实际 ${current.revision}`)
      }
    }
    const row = (await this.prisma.documentContent.update({
      where: { nodeId: input.nodeId },
      data: {
        ...(input.contentJson !== undefined
          ? { contentJson: input.contentJson as never }
          : {}),
        ...(input.yjsState !== undefined
          ? { yjsState: input.yjsState === null ? null : toBytes(input.yjsState) }
          : {}),
        ...(input.stateVector !== undefined
          ? { stateVector: input.stateVector === null ? null : toBytes(input.stateVector) }
          : {}),
        ...(input.textPreview !== undefined ? { textPreview: input.textPreview } : {}),
        ...(input.charCount !== undefined ? { charCount: input.charCount } : {}),
        ...(input.docSizeBytes !== undefined ? { docSizeBytes: input.docSizeBytes } : {}),
        ...(input.updatedBy !== undefined ? { updatedBy: input.updatedBy } : {}),
        revision: { increment: 1 },
      },
    })) as PrismaContent
    return toContent(row)
  }

  async saveCollaborative(input: SaveContentInput): Promise<DocumentContent> {
    // 显式标注为 Unchecked 变体：updatedBy 是可空的外键，
    // 交给 TS 推断会在 checked/unchecked 之间产生歧义。
    const data: PrismaDocumentContentUncheckedUpdateInput = {
      ...(input.contentJson !== undefined ? { contentJson: input.contentJson as never } : {}),
      ...(input.yjsState !== undefined
        ? { yjsState: input.yjsState === null ? null : toBytes(input.yjsState) }
        : {}),
      ...(input.stateVector !== undefined
        ? { stateVector: input.stateVector === null ? null : toBytes(input.stateVector) }
        : {}),
      ...(input.textPreview !== undefined ? { textPreview: input.textPreview } : {}),
      ...(input.charCount !== undefined ? { charCount: input.charCount } : {}),
      ...(input.docSizeBytes !== undefined ? { docSizeBytes: input.docSizeBytes } : {}),
      ...(input.updatedBy !== undefined ? { updatedBy: input.updatedBy } : {}),
      storedAt: new Date(),
    }
    const row = (await this.prisma.documentContent.update({
      where: { nodeId: input.nodeId },
      data,
    })) as PrismaContent
    return toContent(row)
  }
}

class AclRepositoryImpl implements AclRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async listForNode(nodeId: string): Promise<AclEntry[]> {
    const rows = (await this.prisma.nodeAcl.findMany({
      where: { nodeId },
      orderBy: { createdAt: 'asc' },
    })) as PrismaAcl[]
    return rows.map(toAcl)
  }

  async listForSubjects(
    nodeId: string,
    userId: string,
    workspaceId: string,
  ): Promise<AclEntry[]> {
    const rows = (await this.prisma.nodeAcl.findMany({
      where: {
        nodeId,
        OR: [
          { subjectType: 'user', subjectId: userId },
          { subjectType: 'workspace', subjectId: workspaceId },
        ],
      },
    })) as PrismaAcl[]
    return rows.map(toAcl)
  }

  async upsert(input: CreateAclInput): Promise<AclEntry> {
    const row = (await this.prisma.nodeAcl.upsert({
      where: {
        nodeId_subjectType_subjectId: {
          nodeId: input.nodeId,
          subjectType: input.subjectType,
          subjectId: input.subjectId,
        },
      },
      create: {
        id: input.id,
        nodeId: input.nodeId,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        role: input.role,
        effect: input.effect ?? 'allow',
        createdBy: input.createdBy,
      },
      update: {
        role: input.role,
        effect: input.effect ?? 'allow',
      },
    })) as PrismaAcl
    return toAcl(row)
  }

  async remove(nodeId: string, aclId: string): Promise<boolean> {
    const result = await this.prisma.nodeAcl.deleteMany({ where: { id: aclId, nodeId } })
    return result.count > 0
  }
}

class VersionsRepositoryImpl implements VersionsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async listForNode(nodeId: string): Promise<Version[]> {
    const rows = (await this.prisma.nodeVersion.findMany({
      where: { nodeId },
      orderBy: { versionNo: 'desc' },
    })) as PrismaVersion[]
    return rows.map(toVersion)
  }

  async findByNo(nodeId: string, versionNo: number): Promise<Version | null> {
    const row = (await this.prisma.nodeVersion.findUnique({
      where: { nodeId_versionNo: { nodeId, versionNo } },
    })) as PrismaVersion | null
    return row ? toVersion(row) : null
  }

  async create(input: {
    id: string
    nodeId: string
    kind: 'auto' | 'manual' | 'restore'
    label?: string | null
    contentJson: unknown
    yjsState?: Uint8Array | null
    createdBy?: string | null
  }): Promise<Version> {
    const versionNo = await this.nextVersionNo(input.nodeId)
    const row = (await this.prisma.nodeVersion.create({
      data: {
        id: input.id,
        nodeId: input.nodeId,
        versionNo,
        kind: input.kind,
        label: input.label ?? null,
        contentJson: input.contentJson as never,
        yjsState: input.yjsState === null || input.yjsState === undefined ? null : toBytes(input.yjsState),
        createdBy: input.createdBy ?? null,
        contentSchemaVersion: 1,
        yjsSchemaVersion: 1,
      },
    })) as PrismaVersion
    return toVersion(row)
  }

  async nextVersionNo(nodeId: string): Promise<number> {
    const latest = (await this.prisma.nodeVersion.findFirst({
      where: { nodeId },
      orderBy: { versionNo: 'desc' },
      select: { versionNo: true },
    })) as { versionNo: number } | null
    return (latest?.versionNo ?? 0) + 1
  }

  async pruneAutoVersions(input: {
    nodeId: string
    keepCount: number
    keepManual: boolean
  }): Promise<number> {
    const autos = (await this.prisma.nodeVersion.findMany({
      where: { nodeId: input.nodeId, kind: 'auto' },
      orderBy: { versionNo: 'desc' },
      select: { id: true, versionNo: true },
    })) as { id: string; versionNo: number }[]

    const toRemove = autos.slice(input.keepCount)
    if (toRemove.length === 0) return 0
    const result = await this.prisma.nodeVersion.deleteMany({
      where: { id: { in: toRemove.map((v) => v.id) } },
    })
    return result.count
  }
}

class AttachmentsRepositoryImpl implements AttachmentsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(id: string): Promise<Attachment | null> {
    const row = (await this.prisma.attachment.findUnique({ where: { id } })) as PrismaAttachment | null
    return row ? toAttachment(row) : null
  }

  async findByStorageKey(storageKey: string): Promise<Attachment | null> {
    const row = (await this.prisma.attachment.findUnique({
      where: { storageKey },
    })) as PrismaAttachment | null
    return row ? toAttachment(row) : null
  }

  async create(input: {
    id: string
    workspaceId: string
    nodeId?: string | null
    uploaderId: string
    originalName: string
    mimeType: string
    byteSize: number
    sha256: string
    storageKey: string
    width?: number | null
    height?: number | null
  }): Promise<Attachment> {
    const row = (await this.prisma.attachment.create({
      data: {
        id: input.id,
        workspaceId: input.workspaceId,
        nodeId: input.nodeId ?? null,
        uploaderId: input.uploaderId,
        originalName: input.originalName,
        mimeType: input.mimeType,
        byteSize: input.byteSize,
        sha256: input.sha256,
        storageKey: input.storageKey,
        width: input.width ?? null,
        height: input.height ?? null,
      },
    })) as PrismaAttachment
    return toAttachment(row)
  }

  async attachToNode(id: string, nodeId: string): Promise<Attachment> {
    const row = (await this.prisma.attachment.update({
      where: { id },
      data: { nodeId },
    })) as PrismaAttachment
    return toAttachment(row)
  }

  async detachFromNode(id: string): Promise<boolean> {
    const result = await this.prisma.attachment.updateMany({
      where: { id },
      data: { nodeId: null },
    })
    return result.count > 0
  }
}

class AuditRepositoryImpl implements AuditRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: CreateAuditInput): Promise<AuditEvent> {
    const row = (await this.prisma.auditEvent.create({
      data: {
        workspaceId: input.workspaceId,
        actorId: input.actorId ?? null,
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId ?? null,
        // SQLite 下 Json 不能有数据库默认值，由应用层补（见 schema 注释）
        metadata: (input.metadata ?? {}) as never,
        ip: input.ip ?? null,
      },
    })) as PrismaAudit
    return toAudit(row)
  }

  async listForWorkspace(input: {
    workspaceId: string
    limit: number
    offset?: number
  }): Promise<AuditEvent[]> {
    const rows = (await this.prisma.auditEvent.findMany({
      where: { workspaceId: input.workspaceId },
      orderBy: { createdAt: 'desc' },
      take: input.limit,
      skip: input.offset ?? 0,
    })) as PrismaAudit[]
    return rows.map(toAudit)
  }
}

/**
 * 创建全部 Repository。
 *
 * 返回的是接口类型，不是实现类——调用方拿不到 Prisma 类型的痕迹。
 */
export function createRepositories(prisma: PrismaClient): Repositories {
  return {
    users: new UsersRepositoryImpl(prisma),
    workspaces: new WorkspacesRepositoryImpl(prisma),
    nodes: new NodesRepositoryImpl(prisma),
    contents: new ContentsRepositoryImpl(prisma),
    acl: new AclRepositoryImpl(prisma),
    versions: new VersionsRepositoryImpl(prisma),
    attachments: new AttachmentsRepositoryImpl(prisma),
    audit: new AuditRepositoryImpl(prisma),
  }
}
