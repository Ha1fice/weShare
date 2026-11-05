/**
 * collab 侧的错误类型。
 *
 * 独立一份而不是从 api 引：两个进程的边界只该共享 `packages/*`，
 * 让 collab 依赖 api 会把整个 Fastify 拖进协同服务。
 */
export class AppError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'AppError'
  }
}
