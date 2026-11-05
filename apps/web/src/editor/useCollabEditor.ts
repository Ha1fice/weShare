/**
 * 协同编辑器的创建与销毁。
 *
 * 抽成函数而不是写在组件里，是因为"先连再建编辑器"的顺序很容易搞错：
 *
 *   - Collaboration 扩展在**创建时**就从 Y.Doc 读内容并订阅更新；
 *   - 所以必须先把 `provider` 连上、等 `synced`，再建编辑器——
 *     否则用户会先看到空文档闪一下，再被远端内容覆盖（体验上像"内容丢了"）。
 *
 * 反过来，销毁时必须先销毁编辑器再断开 provider，否则 disconnected 之后
 * 到达的更新会被写进一个已经没人管的编辑器。
 */

import { ref, shallowRef, type Ref } from 'vue'
import type { Editor } from '@tiptap/vue-3'
import type { HocuspocusProvider } from '@hocuspocus/provider'
import { Editor as CoreEditor } from '@tiptap/core'
import { buildCollabExtensions } from './collabExtensions.js'
import type { CollabHandle, CollabStatus } from './collab.js'

export interface CollabEditorOptions {
  handle: CollabHandle
  user: { id: string; displayName: string }
  readOnly: boolean
  onStatus: (status: CollabStatus, detail?: string) => void
  onPeers: (peers: Array<{ clientId: number; name: string }>) => void
}

export interface CollabEditorResult {
  editor: Ref<Editor | null>
  provider: HocuspocusProvider
  destroy(): void
}

/** 等服务端首次 sync 完成（最多等 timeoutMs，超时也继续——断线也能本地编辑）。 */
function waitForSync(provider: HocuspocusProvider, timeoutMs = 4000): Promise<void> {
  if (provider.synced) return Promise.resolve()
  return new Promise((resolve) => {
    let done = false
    const finish = () => {
      if (done) return
      done = true
      provider.off('synced', finish)
      clearTimeout(timer)
      resolve()
    }
    const timer = setTimeout(finish, timeoutMs)
    provider.on('synced', finish)
  })
}

export async function createCollabEditor(options: CollabEditorOptions): Promise<CollabEditorResult> {
  const { handle } = options

  await waitForSync(handle.provider)

  const instance = new CoreEditor({
    element: document.createElement('div'),
    extensions: buildCollabExtensions({
      ydoc: handle.ydoc,
      provider: handle.provider,
      user: options.user,
      readOnly: options.readOnly,
    }),
    editable: !options.readOnly,
    editorProps: {
      attributes: {
        class: 'doc-editor',
        'aria-label': '文档正文',
        'aria-readonly': options.readOnly ? 'true' : 'false',
      },
    },
  })

  const editor = shallowRef<Editor | null>(instance as unknown as Editor)
  const disposed = ref(false)

  return {
    editor,
    provider: handle.provider,
    destroy() {
      if (disposed.value) return
      disposed.value = true
      instance.destroy()
      editor.value = null
    },
  }
}
