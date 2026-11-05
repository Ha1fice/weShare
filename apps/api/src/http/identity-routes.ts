/**
 * 免密身份路由（设备指纹）。
 *
 *   POST /api/v1/auth/device  拿设备标识换会话（首次调用会建账号与默认空间）
 *
 * 只在 `DEVICE_IDENTITY` 打开时注册（见 server.ts）。关闭时路径 404，
 * 前端据 /api/v1/me 的响应回到登录页 —— 两种形态共用同一套会话机制。
 */

import type { FastifyInstance, FastifyRequest } from 'fastify'
import {
  BindIdentityBodySchema,
  DeviceIdentityBodySchema,
  type AuthResponse,
} from '@weshare/shared'
import type { Repositories } from '@weshare/db'
import { AppError } from './errors.js'
import { buildSessionCookie } from '../lib/session-cookie.js'
import type { SessionService } from '../domain/session-service.js'
import type { IdentityService } from '../domain/identity-service.js'
import { requireAuth, requireUser } from './auth-routes.js'

export interface IdentityRouteOptions {
  repos: Repositories
  sessions: SessionService
  identity: IdentityService
  secureCookie: boolean
  sessionMaxAgeSeconds: number
}

function clientIp(req: FastifyRequest): string {
  return req.ip || req.socket.remoteAddress || 'unknown'
}

function userAgent(req: FastifyRequest): string {
  const ua = req.headers['user-agent']
  return typeof ua === 'string' ? ua.slice(0, 512) : ''
}

/** 注册免密身份路由。 */
export function registerIdentityRoutes(app: FastifyInstance, options: IdentityRouteOptions): void {
  const { identity, sessions, secureCookie, sessionMaxAgeSeconds } = options

  const cookieOptions = { secure: secureCookie, maxAgeSeconds: sessionMaxAgeSeconds }

  /**
   * 已登录时调用：给当前会话补绑设备标识。
   *
   * 用在"关掉免密模式、以登录态回来"的场景——让本设备下次打开能直接落到这个账号。
   */
  app.post(
    '/api/v1/auth/device/bind',
    { preHandler: requireAuth(options) },
    async (req) => {
      const parsed = BindIdentityBodySchema.safeParse(req.body)
      if (!parsed.success) {
        throw new AppError(
          'VALIDATION_FAILED',
          parsed.error.issues[0]?.message ?? '请求参数不合法',
        )
      }

      const user = await requireUser(req, options)
      // 只允许"把设备绑到自己"，不能借这个接口接管别人的身份
      const own = await identity.establish(parsed.data.deviceKey, user.displayName)
      if (own.user.id !== user.id) {
        throw new AppError('CONFLICT', '该设备已绑定其他身份')
      }
      return { ok: true }
    },
  )

  /**
   * 取会话。
   *
   * 幂等：同一设备重复调用返回同一账号（已有会话也重新下发，相当于刷新有效期）。
   */
  app.post('/api/v1/auth/device', async (req, reply) => {
    const parsed = DeviceIdentityBodySchema.safeParse(req.body)
    if (!parsed.success) {
      throw new AppError('VALIDATION_FAILED', parsed.error.issues[0]?.message ?? '请求参数不合法')
    }

    const { deviceKey, displayName } = parsed.data
    const result = await identity.establish(deviceKey, displayName)

    // 会话轮换：不复用任何旧会话（与密码登录一致，避免会话固定）
    const session = await sessions.create(result.user.id, {
      ip: clientIp(req),
      userAgent: userAgent(req),
    })

    const body: AuthResponse & { created: boolean } = {
      user: result.user,
      created: result.created,
    }

    return reply
      .status(result.created ? 201 : 200)
      .header('Set-Cookie', buildSessionCookie(session.token, cookieOptions))
      .send(body)
  })
}
