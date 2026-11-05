/**
 * 文档正文路由（Phase 2）。
 *
 *   GET /api/v1/nodes/:id/content   读正文
 *   PUT /api/v1/nodes/:id/content   保存正文（带 revision 乐观锁）
 *
 * 权限判定在 ContentService（它复用 NodeService.requireRole）——
 * 本文件只做 HTTP 适配。
 */

import type { FastifyInstance, FastifyRequest } from 'fastify'
import { SaveContentBodySchema, type ContentView } from '@weshare/shared'
import type { Repositories } from '@weshare/db'
import { validationFailed } from '../http/errors.js'
import { requireUser } from './auth-routes.js'
import type { SessionService } from '../domain/session-service.js'
import type { ContentService, ContentResult } from '../domain/content-service.js'

export interface ContentRouteOptions {
  repos: Repositories
  contents: ContentService
  sessions: SessionService
  secureCookie: boolean
}

function toContentView(c: ContentResult): ContentView {
  return {
    nodeId: c.nodeId,
    doc: c.doc,
    revision: c.revision,
    contentSchemaVersion: c.contentSchemaVersion,
    textPreview: c.textPreview,
    charCount: c.charCount,
    updatedAt: c.updatedAt.toISOString(),
    collabEnabled: c.collabEnabled,
  }
}

export function registerContentRoutes(app: FastifyInstance, options: ContentRouteOptions): void {
  const { contents, repos, sessions } = options

  const currentUser = (req: FastifyRequest) =>
    requireUser(req, { repos, sessions, secureCookie: options.secureCookie })

  app.get('/api/v1/nodes/:id/content', async (req): Promise<ContentView> => {
    const user = await currentUser(req)
    const { id } = req.params as { id: string }
    return toContentView(await contents.get(id, user.id))
  })

  app.put('/api/v1/nodes/:id/content', async (req): Promise<ContentView> => {
    const user = await currentUser(req)
    const { id } = req.params as { id: string }

    const parsed = SaveContentBodySchema.safeParse(req.body)
    if (!parsed.success) {
      throw validationFailed(parsed.error.issues[0]?.message ?? '请求参数不合法')
    }

    const saved = await contents.save({
      nodeId: id,
      userId: user.id,
      doc: parsed.data.doc,
      revision: parsed.data.revision,
    })
    return toContentView(saved)
  })
}
