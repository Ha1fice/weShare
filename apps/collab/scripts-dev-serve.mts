/**
 * 本地开发 / e2e 共用的协同服务入口。
 *
 * `src/server.ts` 只导出 buildCollab/start，不会自行启动——测试会 import 它，
 * 在那里自动监听会污染测试进程。所以 `pnpm dev` 指向本文件；e2e 的 playwright
 * webServer 也用同一入口，保证本地与 CI 跑的是同一套启动逻辑。
 * 直接 `tsx watch src/server.ts` 会起一个 watcher 但永远不监听端口，别再这么写。
 */
import { start } from './src/server.ts'

await start()
// 挂住进程：由 playwright 收尾时杀掉
setInterval(() => {}, 60_000)
