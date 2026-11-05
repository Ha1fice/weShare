<script setup lang="ts">
/**
 * 文档页：编辑器 + 自动保存 + 实时协同。
 *
 * **两种模式共存，但不能同时生效**（架构文档不变式 I2）：
 *
 *   - **单机模式**：正文走 `GET/PUT /nodes/:id/content`，1.2s 防抖自动保存，
 *     revision 乐观锁挡并发覆盖。用于文档还没被协同打开过的情况。
 *   - **协同模式**：文档一旦被协同服务装载过（`yjs_state` 非空），正文事实源
 *     就是 Y.Doc，编辑器由 y-prosemirror 接管，写入走 WebSocket。
 *     此时 REST 写入会被服务端拒绝（`409 COLLAB_ENABLED`）——这是对的，
 *     同一文档不能有两套写入路径。
 *
 * 四个不变量，任何改动都不能破坏：
 *
 *   1. **正文事实源在服务端。** 本地没有"浏览器缓存兜底"。刷新后内容仍在，
 *      是因为存进去了，不是因为存在 localStorage 里。
 *   2. **只读由服务端强制。** 前端禁用输入只是体验优化。协同模式下服务端把
 *      连接设为 readOnly，收到的 update 帧直接丢弃。
 *   3. **冲突必须让用户看见。** 单机模式下 revision 不一致返回 409，界面给出
 *      两个明确出口（载入最新 / 另存为副本），不静默覆盖也不静默丢弃。
 *   4. **断线要说出来。** 协同断线时界面明确显示"离线"，不能让人以为
 *      "还在实时协作"。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router'
import { useEditor, EditorContent } from '@tiptap/vue-3'
import type { Editor } from '@tiptap/vue-3'
import type { JSONContent } from '@tiptap/vue-3'
import { ApiError } from '@/api/client.js'
import { contentsApi } from '@/api/contents.js'
import { nodesApi } from '@/api/nodes.js'
import type { ContentView, NodeView } from '@weshare/shared'
import { useSessionStore } from '@/stores/session.js'
import AppShell from '@/components/layout/AppShell.vue'
import { AppAlert, AppButton, AppDialog, AppSkeleton } from '@/components/ui/index.js'
import { toast } from '@/components/ui/toast.js'
import AppIcon from '@/components/icons/AppIcon.vue'
import EditorToolbar from '@/editor/EditorToolbar.vue'
import SaveStatus from '@/editor/SaveStatus.vue'
import { Autosave, type AutosaveState, type SaveOutcome } from '@/editor/autosave.js'
import { buildExtensions, EMPTY_DOC } from '@/editor/schema.js'
import {
  connectCollab,
  rememberCollabDraft,
  takeCollabDraft,
  type CollabHandle,
  type CollabStatus,
} from '@/editor/collab.js'
import { createCollabEditor, type CollabEditorResult } from '@/editor/useCollabEditor.js'
import PeerAvatars from '@/editor/PeerAvatars.vue'

const route = useRoute()
const router = useRouter()
const session = useSessionStore()

const nodeId = computed(() => String(route.params.nodeId ?? ''))
const node = ref<NodeView | null>(null)
const crumbs = ref<Array<{ id: string; title: string }>>([])
const content = ref<ContentView | null>(null)
const loading = ref(true)
const loadError = ref('')

const canEdit = computed(() => node.value?.role === 'edit' || node.value?.role === 'manage')
const titleDraft = ref('')
const titleSaving = ref(false)

/** 当前 revision。每次成功保存后由服务端返回值刷新——不能用本地 +1 猜。 */
let revision = 0
/** 自动保存状态的镜像（供模板用）。 */
const saveState = ref<AutosaveState>({ kind: 'idle' })

/** 协同连接（null = 单机模式）。 */
let collab: CollabHandle | null = null
let collabEditor: CollabEditorResult | null = null
const collabStatus = ref<CollabStatus | null>(null)
/** 是否已经尝试过建立协同连接（决定界面显示"协同"还是"单机"那套控件）。 */
const collabAttempted = ref(false)
const collabDeniedReason = ref('')
const peers = ref<Array<{ clientId: number; name: string }>>([])
/** 协同模式：正文由 Y.Doc 驱动，不再有 REST 自动保存。 */
const isCollab = computed(() => collab !== null || collabAttempted.value)

/**
 * 编辑器实例。
 *
 * 用 `shallowRef` 持有：Editor 内部有庞大的 PM 状态树，被 Vue 深度代理后
 * 每次事务都会触发大量无意义的依赖追踪，实测能卡到无法输入。
 */
const editor = shallowRef<Editor | null>(null)
let autosave: Autosave | null = null
/** 装载内容期间的 update 回调不算用户改动（见下方 watch 的说明）。 */
let allowRealMark = true

/** PM JSON → Tiptap 的 Content 类型。服务端只保证"是个 doc"，形状由编辑器校验。 */
function asContent(doc: unknown): JSONContent {
  return (doc ?? EMPTY_DOC) as JSONContent
}

// ------------------------------------------------------------ 自动保存
function createAutosave(): void {
  autosave?.dispose()
  autosave = new Autosave({
    delayMs: 1200,
    save: doSave,
    onStateChange: (s) => {
      saveState.value = s
    },
  })
  saveState.value = { kind: 'idle' }
}

async function doSave(): Promise<SaveOutcome> {
  const ed = editor.value
  if (!ed || !content.value) return 'failed'
  if (!canEdit.value) return 'readonly'

  try {
    const res = await contentsApi.save(nodeId.value, {
      revision,
      doc: ed.getJSON() as never,
    })
    revision = res.revision
    content.value = res
    return 'saved'
  } catch (err) {
    if (err instanceof ApiError) {
      if (err.code === 'CONFLICT') return 'conflict'
      if (err.code === 'FORBIDDEN') return 'readonly'
      if (err.code === 'COLLAB_ENABLED') {
        toast('这篇文档已启用实时协同，请刷新页面', 'error')
        return 'conflict'
      }
    }
    return 'failed'
  }
}

// ------------------------------------------------------------ 协同
/**
 * 进入协同模式。
 *
 * 顺序不能反：先连 provider，等 synced，再建编辑器。
 * 反过来会先渲染出空文档再被远端内容覆盖——用户看到的是"内容丢了"。
 */
async function startCollab(options: { seedFromDraft?: boolean } = {}): Promise<void> {
  if (!session.user) return

  collabAttempted.value = true
  collab = connectCollab({
    nodeId: nodeId.value,
    // 只在"这篇还没进过协同"时把草稿灌进去，否则服务端已有事实源
    ...(options.seedFromDraft ? { seedDoc: takeCollabDraft(nodeId.value) } : {}),
    user: { id: session.user.id, displayName: session.user.displayName },
    readOnly: !canEdit.value,
    onStatus: (status, detail) => {
      collabStatus.value = status
      if (status === 'denied') collabDeniedReason.value = detail ?? ''
    },
    onPeers: (list) => {
      peers.value = list
    },
  })

  try {
    const built = await createCollabEditor({
      handle: collab,
      user: { id: session.user.id, displayName: session.user.displayName },
      readOnly: !canEdit.value,
      onStatus: () => {},
      onPeers: () => {},
    })
    collabEditor = built
    editor.value = built.editor.value
    // 协同模式下编辑器由 Y.Doc 驱动，装载内容不算"改动"
    saveState.value = { kind: 'idle' }
  } catch (err) {
    collabStatus.value = 'denied'
    collabDeniedReason.value = err instanceof Error ? err.message : '协同连接失败'
  }
}

function teardownCollab(): void {
  // 顺序与创建相反：先销毁编辑器，再断开 provider
  collabEditor?.destroy()
  collabEditor = null
  collab?.destroy()
  collab = null
  collabAttempted.value = false
  collabStatus.value = null
  collabDeniedReason.value = ''
  peers.value = []
  editor.value = null
}

// ------------------------------------------------------------ 加载
async function load(): Promise<void> {
  allowRealMark = false

  loading.value = true
  loadError.value = ''
  try {
    const [detail, crumb, body] = await Promise.all([
      nodesApi.detail(nodeId.value),
      nodesApi.breadcrumb(nodeId.value),
      contentsApi.get(nodeId.value),
    ])
    node.value = detail.node
    crumbs.value = crumb.items
    content.value = body
    revision = body.revision
    titleDraft.value = detail.node.title

    // ---- 分支：这篇文档是否已经进入协同模式 ----
    //
    // 一次编辑最多被回滚一个防抖窗口；可接受，见 `connectCollab` 里
    // `rememberCollabDraft` 的说明。
    if (!body.collabEnabled) {
      rememberCollabDraft(nodeId.value, body.doc ?? EMPTY_DOC)
    }

    // 一律走协同：正文事实源放在 Y.Doc，单机 REST 写入只是"还没人协同
    // 打开过"时的过渡态。一次打开之后 `yjs_state` 就非空了，服务端会继续
    // 拒绝 REST 写入（409 COLLAB_ENABLED），两条路径不会同时生效。
    //
    // 先把单机编辑器拆掉，避免两个编辑器同时挂在页面上。
    autosave?.dispose()
    autosave = null
    editor.value?.destroy()
    editor.value = null
    await startCollab({ seedFromDraft: !body.collabEnabled })
  } catch (err) {
    loadError.value = err instanceof ApiError ? err.message : '加载失败'
  } finally {
    loading.value = false
    // 装载内容引起的 update 回调都落在这一拍之后，等它跑完再接受真实改动
    void nextTick(() => {
      allowRealMark = true
    })
  }
}

onMounted(async () => {
  await load()
})

/**
 * 编辑器实例。
 *
 * `onUpdate` 只在用户真的改动时标记脏——加载内容时用的
 * `setContent(..., { emitUpdate: false })` 不会触发它，否则每打开一篇文档
 * 都会立刻回写一次、revision 白涨一格。
 */
/**
 * 单机模式的编辑器。
 *
 * 协同模式不用它——`useEditor` 的扩展在创建时就固定了，没法中途把
 * Collaboration 塞进去。所以两种模式各建一个编辑器实例，互斥使用。
 */
const editorRef = useEditor({
  content: EMPTY_DOC as unknown as JSONContent,
  editable: false,
  extensions: buildExtensions({ editable: true }),
  editorProps: {
    attributes: {
      class: 'doc-editor',
      'aria-label': '文档正文',
      spellcheck: 'false',
    },
  },
  onUpdate: () => {
    if (!allowRealMark) return
    autosave?.markDirty(!canEdit.value)
  },
})

watch(editorRef, (ed) => {
  editor.value = ed ?? null
  if (!ed) return

  // 顺序有讲究：
  //   1. 先静默装入内容。
  //      Tiptap 3 的 `setContent(..., { emitUpdate: false })` 只抑制 onUpdate，
  //      **不抑制 transaction 事件**（实测：docChanged 仍为 true）。而 vue-3 的
  //      `useEditor` 自带一个 onTransaction 钩子去 sync 响应式状态，如果编辑器
  //      已经挂载进 DOM，这次 sync 会被当作一次用户改动。
  //   2. 再创建自动保存调度器。
  //      在装入之前创建，装入的副作用会被记成"未保存的改动"，一打开文档
  //      界面就挂着"未保存"，还要白涨一次 revision。
  ed.commands.setContent(asContent(content.value?.doc), { emitUpdate: false })
  ed.setEditable(canEdit.value)
  createAutosave()
  autosave?.reset()
})

// 编辑器实例由 useEditor 创建，它内部随组件卸载自动销毁；
// 这里管自动保存的定时器与协同连接。
onBeforeUnmount(() => {
  autosave?.dispose()
  teardownCollab()
})

// ------------------------------------------------------------ 失焦 / 切标签则落盘
function flushNow(): void {
  void autosave?.flush()
}

if (typeof window !== 'undefined') {
  window.addEventListener('blur', flushNow)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushNow()
  })
}

onBeforeRouteLeave(async () => {
  // 离开前尽力落盘一次。beforeunload 里的异步请求不可靠（浏览器可能直接杀进程），
  // 所以这里不承诺"关页面 0 丢失"——架构文档已明示最坏丢失为防抖窗口。
  //
  // 协同模式不需要 flush：Y.Doc 在服务端，断开时服务端会落库。
  await autosave?.flush()
  teardownCollab()
  return true
})

watch(canEdit, (editable) => {
  editor.value?.setEditable(editable)
})

// ------------------------------------------------------------ 标题
const titleDirty = computed(
  () => node.value !== null && titleDraft.value.trim() !== node.value.title,
)

async function saveTitle(): Promise<void> {
  if (!node.value || !titleDirty.value || titleSaving.value) return
  const title = titleDraft.value.trim()
  if (!title) {
    titleDraft.value = node.value.title
    return
  }
  titleSaving.value = true
  try {
    const res = await nodesApi.update(node.value.id, { title })
    node.value = { ...node.value, title: res.node.title }
    titleDraft.value = res.node.title
    toast('标题已更新')
  } catch (err) {
    toast(err instanceof ApiError ? err.message : '标题保存失败', 'error')
    titleDraft.value = node.value.title
  } finally {
    titleSaving.value = false
  }
}

// ------------------------------------------------------------ 冲突处理
const conflictDialog = ref(false)

async function loadLatest(): Promise<void> {
  autosave?.discard()
  conflictDialog.value = false
  // 协同模式下重连即重新装载：内容来自服务端的 Y.Doc，不用再 setContent
  teardownCollab()
  await load()
  toast('已载入最新版本')
}

async function saveAsCopy(): Promise<void> {
  conflictDialog.value = false
  if (!node.value) return
  try {
    const created = await nodesApi.create({
      workspaceId: node.value.workspaceId,
      parentId: node.value.parentId,
      type: 'doc',
      title: `${node.value.title}（我的副本）`,
    })
    const latest = await contentsApi.get(created.node.id)
    await contentsApi.save(created.node.id, {
      revision: latest.revision,
      doc: editor.value?.getJSON() as never,
    })
    toast('已另存为副本')
    await router.push({ name: 'doc', params: { nodeId: created.node.id } })
  } catch (err) {
    toast(err instanceof ApiError ? err.message : '另存失败', 'error')
  }
}

async function retrySave(): Promise<void> {
  await autosave?.retry()
}

function back(): void {
  const wsId = node.value?.workspaceId ?? session.workspaces[0]?.id
  if (wsId) void router.push({ name: 'workspace', params: { workspaceId: wsId } })
  else void router.push({ name: 'home' })
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString('zh-CN', { hour12: false })
}
</script>

<template>
  <AppShell>
    <main class="flex min-h-0 flex-1 flex-col">
      <!-- 文档头：路径 + 标题 + 保存状态 -->
      <div class="shrink-0 border-b border-line bg-surface px-4 pb-2 pt-1.5">
        <nav class="mb-1 flex items-center gap-0.5 text-[11.5px] text-faint" aria-label="文档位置">
          <button
            type="button"
            class="flex items-center gap-0.5 rounded px-1 py-0.5 hover:bg-subtle hover:text-ink focus-ring"
            @click="back"
          >
            <AppIcon name="chevron-left" :size="11" />返回
          </button>
          <template v-for="c in crumbs" :key="c.id">
            <span class="text-line-strong">/</span>
            <span class="max-w-[160px] truncate">{{ c.title }}</span>
          </template>
        </nav>

        <div class="flex items-center gap-2">
          <input
            v-model="titleDraft"
            :readonly="!canEdit"
            :aria-label="'文档标题'"
            :class="[
              'min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-0.5',
              'text-[19px] font-semibold tracking-tight text-ink outline-none transition-colors',
              canEdit ? 'hover:border-line focus:border-brand-400 focus:bg-surface' : 'cursor-default',
            ]"
            @blur="saveTitle"
            @keyup.enter="($event.target as HTMLInputElement).blur()"
          />

          <!-- 协同模式：在线成员 + 连接状态；单机模式：自动保存状态 -->
          <PeerAvatars v-if="isCollab" :peers="peers" />

          <span
            v-if="isCollab"
            :class="[
              'flex items-center gap-1 text-[11.5px]',
              collabStatus === 'connected' ? 'text-success' : collabStatus === 'denied' ? 'text-danger' : 'text-warning',
            ]"
            role="status"
            aria-live="polite"
            :title="collabStatus === 'denied' ? collabDeniedReason : undefined"
          >
            <AppIcon
              :name="collabStatus === 'connected' ? 'cloud' : 'cloud-off'"
              :size="12"
            />
            {{
              collabStatus === 'connected'
                ? '实时协同'
                : collabStatus === 'denied'
                  ? '无法协同'
                  : collabStatus === 'connecting'
                    ? '连接中…'
                    : '已断线'
            }}
          </span>

          <SaveStatus v-else :state="saveState">
            <AppButton
              v-if="saveState.kind === 'failed'"
              size="sm"
              variant="danger-ghost"
              @click="retrySave"
            >
              重试
            </AppButton>
            <AppButton
              v-if="saveState.kind === 'conflict'"
              size="sm"
              variant="danger-ghost"
              @click="conflictDialog = true"
            >
              处理冲突
            </AppButton>
          </SaveStatus>

          <span v-if="node && !canEdit" class="rounded bg-subtle px-1.5 py-0.5 text-[11px] text-muted">
            只读
          </span>
        </div>

        <p v-if="node" class="mt-0.5 px-1 text-[11px] text-faint">
          更新于 {{ fmtTime(node.updatedAt) }}
        </p>
      </div>

      <!-- 正文区 -->
      <div v-if="loading" class="mx-auto w-full max-w-[760px] space-y-2 px-8 py-8">
        <AppSkeleton width="40%" height="22px" />
        <AppSkeleton v-for="i in 6" :key="i" :width="`${70 + ((i * 17) % 28)}%`" height="13px" />
      </div>

      <div v-else-if="loadError" class="mx-auto w-full max-w-[560px] px-6 py-12">
        <AppAlert tone="error">
          {{ loadError }}
          <button type="button" class="ml-2 underline" @click="load">重试</button>
        </AppAlert>
      </div>

      <div v-else class="flex min-h-0 flex-1 flex-col">
        <AppAlert v-if="isCollab && collabStatus === 'denied'" tone="error" class="m-2">
          无法建立协同连接：{{ collabDeniedReason || '权限不足或会话已失效' }}。
          若你刚刚改过内容，已尽力写回服务端；刷新页面可重试。
        </AppAlert>

        <EditorToolbar v-if="editor" :editor="editor" :editable="canEdit" />

        <div class="min-h-0 flex-1 overflow-auto scroll-thin">
          <div class="mx-auto w-full max-w-[760px] px-8 py-7">
            <EditorContent v-if="editor" :editor="editor" />
            <div v-else class="flex items-center gap-2 py-10 text-[12.5px] text-muted">
              <AppIcon name="cloud" :size="14" class="animate-pulse" />正在与服务器同步…
            </div>
          </div>
        </div>
      </div>
    </main>

    <!-- 冲突：两个明确出口 -->
    <AppDialog
      v-model:open="conflictDialog"
      title="这篇文档已被其他人修改"
      icon="alert"
      tone="danger"
      confirm-text="载入最新版本"
      cancel-text="我的另存为副本"
      @confirm="loadLatest"
      @cancel="saveAsCopy"
    >
      <template #description>
        你手上的版本基于 revision 之外的旧内容，直接保存会覆盖别人的修改。
        请二选一：载入别人保存后的最新版本（你的未保存改动会丢失），
        或者把你现在的内容另存为一篇新文档。
      </template>
      <div class="rounded border border-line bg-subtle px-3 py-2 text-[12px] text-muted">
        你这边的改动仍在编辑器里，直到你做出选择。
      </div>
    </AppDialog>
  </AppShell>
</template>

<style>
/* 编辑器内部样式：Tiptap 生成的 DOM 无法用工具类，只能写这里。 */
.doc-editor {
  min-height: 55vh;
  outline: none;
  font-size: 14.5px;
  line-height: 1.78;
  color: #1b1e24;
}

.doc-editor > * + * {
  margin-top: 0.7em;
}

.doc-editor h1 {
  font-size: 1.55em;
  font-weight: 600;
  letter-spacing: -0.01em;
  margin-top: 1.1em;
}

.doc-editor h2 {
  font-size: 1.28em;
  font-weight: 600;
  margin-top: 1em;
}

.doc-editor h3 {
  font-size: 1.12em;
  font-weight: 600;
  margin-top: 0.9em;
}

.doc-editor ul,
.doc-editor ol {
  padding-left: 1.4em;
}

.doc-editor ul {
  list-style: disc;
}

.doc-editor ol {
  list-style: decimal;
}

.doc-editor li p {
  margin: 0;
}

.doc-editor blockquote {
  border-left: 2.5px solid #d6d9e0;
  padding-left: 0.9em;
  color: #5f6673;
}

.doc-editor code {
  background: #f4f5f7;
  border-radius: 3px;
  padding: 0.12em 0.32em;
  font-size: 0.9em;
  font-family: 'SFMono-Regular', ui-monospace, Menlo, Consolas, monospace;
}

.doc-editor pre {
  background: #f7f8fa;
  border: 1px solid #e8eaee;
  border-radius: 7px;
  padding: 0.75em 0.9em;
  overflow-x: auto;
}

.doc-editor pre code {
  background: none;
  padding: 0;
  font-size: 0.86em;
}

.doc-editor a {
  color: #2551eb;
  text-decoration: underline;
  text-underline-offset: 2px;
  cursor: pointer;
}

.doc-editor hr {
  border: none;
  border-top: 1px solid #e8eaee;
  margin: 1.4em 0;
}

.doc-editor p.is-editor-empty:first-child::before {
  content: attr(data-placeholder);
  float: left;
  height: 0;
  color: #9aa1ad;
  pointer-events: none;
}

/* 只读时连光标都不给 */
.doc-editor[contenteditable='false'] {
  cursor: default;
}
</style>
