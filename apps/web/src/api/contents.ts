/**
 * 正文 API 封装。
 */

import type { ContentView, ProseMirrorDoc } from '@weshare/shared'
import { api } from './client.js'

export const contentsApi = {
  get: (nodeId: string) => api.get<ContentView>(`/nodes/${nodeId}/content`),

  /**
   * 保存正文。
   *
   * `revision` 必传——它是乐观锁，不是可选优化。
   * 冲突时抛 `ApiError`（code = CONFLICT），由调用方决定"载入最新还是另存"。
   */
  save: (nodeId: string, input: { revision: number; doc: ProseMirrorDoc }) =>
    api.put<ContentView>(`/nodes/${nodeId}/content`, input),
}
