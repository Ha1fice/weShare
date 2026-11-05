/**
 * 账号与会话仓储。
 *
 * 聚合边界：用户账号 + 它们的登录会话（同一个人相关的数据放一处，
 * 而不是 users 表一个文件、sessions 表一个文件）。
 */

import type { PrismaClient } from '../../generated/client/client.js'
import type { UsersRepository } from './interfaces.js'
import type { AuthRecord, CreateUserInput, Session, User } from './types.js'
import {
  normalizeEmail,
  toBytes,
  toSession,
  toUser,
  type PrismaSession,
  type PrismaUser,
} from './mapping.js'

export class UsersRepositoryImpl implements UsersRepository {
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

  async findByEmailLower(emailLower: string): Promise<User | null> {
    const row = (await this.prisma.user.findUnique({
      where: { emailLower: normalizeEmail(emailLower) },
    })) as PrismaUser | null
    return row ? toUser(row) : null
  }

  async findAuthRecordByEmail(email: string): Promise<AuthRecord | null> {
    const row = (await this.prisma.user.findUnique({
      where: { emailLower: normalizeEmail(email) },
    })) as PrismaUser | null
    if (!row) return null
    return { user: toUser(row), passwordHash: row.passwordHash }
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

  async updatePasswordHash(id: string, passwordHash: string): Promise<void> {
    await this.prisma.user.update({ where: { id }, data: { passwordHash } })
  }

  async touchLastLogin(id: string, at: Date): Promise<void> {
    await this.prisma.user.update({ where: { id }, data: { lastLoginAt: at } })
  }

  async setStatus(id: string, status: 'active' | 'disabled'): Promise<User> {
    const row = (await this.prisma.user.update({
      where: { id },
      data: { status },
    })) as PrismaUser
    return toUser(row)
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
    })) as PrismaSession
    return toSession(row)
  }

  async findSessionByTokenHash(tokenHash: Uint8Array): Promise<Session | null> {
    const row = (await this.prisma.session.findUnique({
      where: { tokenHash: toBytes(tokenHash) },
    })) as PrismaSession | null
    if (!row) return null
    return toSession(row)
  }

  async revokeSession(id: string, at: Date): Promise<void> {
    await this.prisma.session.update({ where: { id }, data: { revokedAt: at } })
  }

  async extendSession(id: string, newExpiresAt: Date): Promise<void> {
    // 不换 session id——换 id 会让客户端手里的 token 立刻失效
    await this.prisma.session.update({ where: { id }, data: { expiresAt: newExpiresAt } })
  }

  async deleteExpiredSessions(before: Date): Promise<number> {
    const result = await this.prisma.session.deleteMany({
      where: { expiresAt: { lt: before } },
    })
    return result.count
  }
}
