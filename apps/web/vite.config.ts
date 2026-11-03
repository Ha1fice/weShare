import { fileURLToPath, URL } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import UnoCSS from 'unocss/vite'

export default defineConfig(({ mode }) => {
  // 代理目标从环境变量读，避免"改了 api 端口就忘了改 vite 代理"这类失配。
  // VITE_ 前缀是 Vite 暴露给客户端的约定；这里在 Node 侧读取，
  // 不会泄漏到前端产物。
  const env = loadEnv(mode, process.cwd(), '')
  const apiTarget = env.API_PROXY_TARGET ?? 'http://127.0.0.1:3000'
  const collabTarget = env.COLLAB_PROXY_TARGET ?? 'ws://127.0.0.1:3100'

  return {
    plugins: [UnoCSS(), vue()],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    server: {
      port: Number(env.WEB_PORT ?? 5173),
      host: env.WEB_HOST ?? '127.0.0.1',
      // 开发期把 /api 与 /collab 代理到后端，避免跨域配置
      proxy: {
        '/api': {
          target: apiTarget,
          changeOrigin: true,
        },
        '/collab': {
          target: collabTarget,
          ws: true,
          changeOrigin: true,
        },
      },
    },
  }
})
