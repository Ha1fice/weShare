/**
 * 协同服务入口（架构文档 T0.4 骨架；协同逻辑在 Phase 3 实现）。
 *
 * 职责边界（架构文档 §4.1）：连接鉴权、Yjs 同步、在线状态、落库。
 * **不解析业务语义**——不判断"这段该不该改"（那是 api 的权限职责）。
 */

import { Server } from '@hocuspocus/server'
import { loadConfig } from './config.js'

async function start(): Promise<void> {
  const config = loadConfig()

  const server = new Server({
    port: config.PORT,
    // 落库钩子在 Phase 3 实现（架构文档 §5.4）。
    // 目前不配置 onStoreDocument，避免出现"以为存了其实没存"的假象。
  })

  await server.listen()
  console.log(`collab 已启动，监听 ${config.HOST}:${config.PORT}`)

  const shutdown = async (signal: string) => {
    console.log(`收到 ${signal}，开始优雅关闭`)
    try {
      await server.destroy()
      process.exit(0)
    } catch (err) {
      console.error('优雅关闭失败', err)
      process.exit(1)
    }
  }

  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
}

start().catch((err) => {
  console.error('collab 启动失败', err)
  process.exit(1)
})
