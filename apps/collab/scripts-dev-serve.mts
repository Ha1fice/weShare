/**
 * e2e 专用协同服务入口（playwright webServer 用）。
 *
 * 不用 `pnpm dev`（tsx watch）——watcher 在 CI 容器里会让整条命令静默退出。
 * start() 返回后 server 挂着、进程不退出，正好当长驻服务用。
 */
import { start } from './src/server.ts'

await start()
// 挂住进程：由 playwright 收尾时杀掉
setInterval(() => {}, 60_000)
