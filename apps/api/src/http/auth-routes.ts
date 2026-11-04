/**
 * 认证路由（架构文档附录 A）。
 *
 *   POST   /api/v1/auth/register  注册
 *   POST   /api/v1/auth/login     登录
 *   POST   /api/v1/auth/logout    登出
 *   GET    /api/v1/me             当前用户 + 空间列表
 *   PATCH  /api/v1/me             修改显示名
 *
 * 安全设计要点：
 *
 * 1. **注册时的邮箱冲突不泄露**。注册接口天然会暴露"该邮箱已被注册"——
 *    这是注册的固有语义（用户需要知道为什么注册不了）。但**登录**接口
 *    必须统一返回"邮箱或密码错误"，否则就成了账号枚举器。
 *
 * 2. **登录耗时一致**。用户不存在时也跑一次哑哈希校验（verifyPasswordOrDummy），
 *    让响应时间与"密码错误"时接近。
 *
 * 3. **会话轮换**。登录成功新建会话 ID，不沿用任何旧会话（防会话固定）。
 *
 * 4. **限流**。同 IP 5 次/分钟失败即锁定（架构文档 T2.2）。
 *
 * 5. **Cookie 全部属性**。见 lib/session-cookie.ts。
 */

import { randomUUID } from 'node:crypto'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import {
  LoginBodySchema,
  RegisterBodySchema,
  UpdateMeBodySchema,
  type CurrentUser,
  type MeResponse,
} from '@weshare/shared'
import type { Repositories } from '@weshare/db'
import { AppError, validationFailed } from '../http/errors.js'
import { hashPassword, needsRehash, verifyPasswordOrDummy } from '../lib/password.js'
import {
  buildSessionCookie,
  clearSessionCookie,
  parseCookies,
  SESSION_COOKIE_NAME,
  SESSION_COOKIE_NAME_DEV,
} from '../lib/session-cookie.js'
import { LoginRateLimiter } from '../lib/login-rate-limit.js'
import { SessionService } from '../domain/session-service.js'

export interface AuthRouteOptions {
  repos: Repositories
  sessions: SessionService
  rateLimiter: LoginRateLimiter
  /** 是否生产环境（决定 Cookie 的 Secure 与 __Host- 前缀）。 */
  secureCookie: boolean
  /** 会话有效期（秒），用于 Cookie 的 Max-Age。 */
  sessionMaxAgeSeconds: number
  /** 是否开放注册。 */
  allowRegister: boolean
}

/** 取请求方 IP。 */
function clientIp(req: FastifyRequest): string {
  return req.ip || req.socket.remoteAddress || 'unknown'
}

/** 取用户代理（截断到 512 字符——数据库列有长度限制，超长会插入失败）。 */
function userAgent(req: FastifyRequest): string {
  const ua = req.headers['user-agent']
  if (typeof ua !== 'string') return ''
  return ua.slice(0, 512)
}

/** 转成 API 层的用户视图。 */
function toCurrentUser(user: {
  id: string
  email: string
  displayName: string
  avatarKey: string | null
  status: string
  createdAt: Date
}): CurrentUser {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    avatarKey: user.avatarKey,
    status: user.status === 'disabled' ? 'disabled' : 'active',
    createdAt: user.createdAt.toISOString(),
  }
}

/**
 * 从 Cookie 中取会话 token。
 *
 * 生产用 `__Host-` 前缀的名字，开发用普通名字——因为 `__Host-` 要求 Secure，
 * 而本地开发走 http。
 */
function readSessionToken(req: FastifyRequest, secureCookie: boolean): string | undefined {
  const cookies = parseCookies(req.headers.cookie)
  const name = secureCookie ? SESSION_COOKIE_NAME : SESSION_COOKIE_NAME_DEV
  return cookies[name]
}

/** 注册认证路由。 */
export function registerAuthRoutes(app: FastifyInstance, options: AuthRouteOptions): void {
  const { repos, sessions, rateLimiter, secureCookie, sessionMaxAgeSeconds } = options

  const cookieOptions = {
    secure: secureCookie,
    maxAgeSeconds: sessionMaxAgeSeconds,
  }

  // ------------------------------------------------------------ 注册
  app.post('/api/v1/auth/register', async (req, reply) => {
    if (!options.allowRegister) {
      throw new AppError('FORBIDDEN', '当前未开放注册')
    }

    const parsed = RegisterBodySchema.safeParse(req.body)
    if (!parsed.success) {
      throw validationFailed(parsed.error.issues[0]?.message ?? '请求参数不合法')
    }

    const { email, password, displayName } = parsed.data

    // 邮箱已存在 → 明确告知（注册场景需要，否则用户无法理解失败原因）
    const existing = await repos.users.findByEmail(email)
    if (existing) {
      throw new AppError('CONFLICT', '该邮箱已被注册')
    }

    const passwordHash = await hashPassword(password)

    let user
    try {
      user = await repos.users.create({
        id: randomUUID(),
        email,
        passwordHash,
        displayName,
      })
    } catch (err) {
      // 唯一约束冲突——并发注册同一邮箱时可能走到这里
      if (isUniqueViolation(err)) {
        throw new AppError('CONFLICT', '该邮箱已被注册')
      }
      throw err
    }

    // 注册即登录：直接下发会话，省去用户再登一次
    const session = await sessions.create(user.id, {
      ip: clientIp(req),
      userAgent: userAgent(req),
    })

    reply
      .status(201)
      .header('Set-Cookie', buildSessionCookie(session.token, cookieOptions))
      .send({ user: toCurrentUser(user) })
  })

  // ------------------------------------------------------------ 登录
  app.post('/api/v1/auth/login', async (req, reply) => {
    const parsed = LoginBodySchema.safeParse(req.body)
    if (!parsed.success) {
      throw validationFailed(parsed.error.issues[0]?.message ?? '请求参数不合法')
    }

    const { email, password } = parsed.data
    const ip = clientIp(req)

    // 限流检查——在查库之前，避免被限流的 IP 还能探测
    if (rateLimiter.isLocked(ip)) {
      const retryAfter = Math.ceil(rateLimiter.retryAfterMs(ip) / 1000)
      throw new AppError('RATE_LIMITED', `尝试过于频繁，请在 ${retryAfter} 秒后重试`)
    }

    const record = await repos.users.findAuthRecordByEmail(email)

    // 无论用户是否存在都跑一次校验——耗时一致，不泄露账号是否存在
    const passwordOk = await verifyPasswordOrDummy(record?.passwordHash, password)

    if (!record || !passwordOk) {
      rateLimiter.recordFailure(ip)
      // 统一的错误信息：不区分"用户不存在"与"密码错误"
      throw new AppError('UNAUTHENTICATED', '邮箱或密码错误')
    }

    const user = record.user

    if (user.status === 'disabled') {
      throw new AppError('FORBIDDEN', '账号已被禁用')
    }

    rateLimiter.recordSuccess(ip)

    // 参数升级：当前参数偏低则用新参数重新哈希（OWASP 建议）
    if (needsRehash(record.passwordHash)) {
      const newHash = await hashPassword(password)
      await repos.users.updatePasswordHash(user.id, newHash)
    }

    await repos.users.touchLastLogin(user.id, new Date())

    // 会话轮换：新建会话，不沿用任何旧会话
    const session = await sessions.create(user.id, {
      ip,
      userAgent: userAgent(req),
    })

    reply
      .header('Set-Cookie', buildSessionCookie(session.token, cookieOptions))
      .send({ user: toCurrentUser(user) })
  })

  // ------------------------------------------------------------ 登出
  app.post('/api/v1/auth/logout', async (req, reply) => {
    const token = readSessionToken(req, secureCookie)
    if (token) {
      const resolved = await sessions.resolve(token)
      if (resolved) {
        await sessions.revoke(resolved.sessionId)
      }
    }

    reply.header('Set-Cookie', clearSessionCookie(cookieOptions)).send({ ok: true })
  })

  // ------------------------------------------------------------ 当前用户
  app.get('/api/v1/me', async (req): Promise<MeResponse> => {
    const user = await requireUser(req, options)
    const workspaces = await repos.workspaces.listForUser(user.id)

    const withRole = await Promise.all(
      workspaces.map(async (w) => ({
        id: w.id,
        name: w.name,
        ownerId: w.ownerId,
        defaultRole: w.defaultRole,
        role: (await repos.workspaces.findMemberRole(w.id, user.id)) ?? 'viewer',
      })),
    )

    return { user: toCurrentUser(user), workspaces: withRole }
  })

  // ------------------------------------------------------------ 修改显示名
  app.patch('/api/v1/me', async (req) => {
    const parsed = UpdateMeBodySchema.safeParse(req.body)
    if (!parsed.success) {
      throw validationFailed(parsed.error.issues[0]?.message ?? '请求参数不合法')
    }

    const user = await requireUser(req, options)
    const updated = await repos.users.updateDisplayName(user.id, parsed.data.displayName)

    return { user: toCurrentUser(updated) }
  })
}

/**
 * 解析当前会话里的用户。
 *
 * 无有效会话时抛 401。
 */
export async function requireUser(
  req: FastifyRequest,
  options: Pick<AuthRouteOptions, 'repos' | 'sessions' | 'secureCookie'>,
) {
  const token = readSessionToken(req, options.secureCookie)
  if (!token) {
    throw new AppError('UNAUTHENTICATED', '未登录或会话已失效')
  }

  const resolved = await options.sessions.resolve(token)
  if (!resolved) {
    throw new AppError('UNAUTHENTICATED', '未登录或会话已失效')
  }

  const user = await options.repos.users.findById(resolved.userId)
  if (!user) {
    // 会话指向的用户已不存在（数据不一致）——按未登录处理
    throw new AppError('UNAUTHENTICATED', '未登录或会话已失效')
  }

  if (user.status === 'disabled') {
    throw new AppError('FORBIDDEN', '账号已被禁用')
  }

  return user
}

/**
 * Fastify preHandler：要求已登录。
 *
 * 用于后续需要认证的路由。挂上后 `request.currentUser` 一定有值。
 */
export function requireAuth(options: Pick<AuthRouteOptions, 'repos' | 'sessions' | 'secureCookie'>) {
  return async function preHandler(req: FastifyRequest, _reply: FastifyReply): Promise<void> {
    const user = await requireUser(req, options)
    // 挂到 request 上供路由使用
    ;(req as FastifyRequest & { currentUser?: unknown }).currentUser = user
  }
}

/** 判断错误是否是唯一约束冲突。 */
function isUniqueViolation(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false
  const e = err as { code?: unknown; message?: unknown }
  // Prisma 的 P2002 = 唯一约束冲突；SQLite 原生错误码 19/2067
  if (e.code === 'P2002') return true
  if (typeof e.message === 'string' && /UNIQUE constraint failed/i.test(e.message)) return true
  return false
}
