<script setup lang="ts">
/**
 * 回收站页面（Phase 1 T5.3 S3/S4）。
 *
 * 数据来自 `GET /workspaces/:id/trash`（只有具备 manage 权限的节点会返回，
 * 服务端已做过滤——前端只做显隐优化，不重复做安全判断，架构文档 §8.4）。
 *
 * 聚批规则：软删除时整棵子树共享同一个 `trashRootId`（批次根是被删节点自身）。
 * 页面上按批次根 id 分组，每组呈现为一条"删除批次"，还原/彻底删除都按批次
 * 根节点发起——后端 restore 按 trashRootId 整批还原，purge 靠 FK 级联删子树。
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { AlertDialogRoot, AlertDialogTrigger, AlertDialogContent, AlertDialogTitle, AlertDialogDescription, AlertDialogCancel, AlertDialogAction } from 'reka-ui'
import { ApiError } from '@/api/client.js'
import { nodesApi, type TreeNodeItem } from '@/api/nodes.js'
import { useSessionStore } from '@/stores/session.js'
import { errorMessage as formatErrorMessage } from '@weshare/shared'

const session = useSessionStore()
const route = useRoute()
const router = useRouter()

const workspaceId = computed(() => String(route.params.workspaceId ?? ''))

const nodes = ref<TreeNodeItem[]>([])
const loading = ref(false)
const errorMessage = ref('')

/** 统一错误文案：服务端错误用 shared 映射，网络错误给可读提示。 */
function messageOf(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.network) return '网络异常，请稍后重试'
    // err.code 已收窄为服务端错误码（network=false 时不会是 NETWORK_ERROR）
    return formatErrorMessage({ code: err.code, message: err.message } as Parameters<typeof formatErrorMessage>[0])
  }
  return '操作失败，请稍后重试'
}

/** 确认弹窗状态：当前待彻底删除的批次根。null 表示弹窗关闭。 */
const purgeTarget = ref<TreeNodeItem | null>(null)
const purgeInput = ref('')
const purging = ref(false)
const restoringId = ref<string | null>(null)

/** 当前用户在该空间的成员角色。 */
const myRole = computed(
  () => session.workspaces.find((w) => w.id === workspaceId.value)?.role ?? null,
)
/** 彻底删除仅空间 owner/admin（§8.2 第 5 条）；还原只需 manage，服务端已过滤。 */
const canPurge = computed(() => myRole.value === 'owner' || myRole.value === 'admin')

interface TrashBatch {
  rootId: string
  title: string
  count: number
  deletedAt: string
  root: TreeNodeItem
}

/** 按 trashRootId 分组聚批（兜底：无 trashRootId 的旧数据按自身 id 成批）。 */
const batches = computed<TrashBatch[]>(() => {
  const byRoot = new Map<string, TreeNodeItem[]>()
  for (const n of nodes.value) {
    const rootId = n.trashRootId ?? n.id
    const list = byRoot.get(rootId)
    if (list) list.push(n)
    else byRoot.set(rootId, [n])
  }
  const result: TrashBatch[] = []
  for (const [rootId, list] of byRoot) {
    const root: TreeNodeItem = list.find((n) => n.id === rootId) ?? list[0]!
    result.push({
      rootId,
      title: root.title || '未命名',
      count: list.length,
      deletedAt: root.deletedAt ?? root.updatedAt,
      root,
    })
  }
  // 按删除时间倒序，最近删的在前
  result.sort((a, b) => b.deletedAt.localeCompare(a.deletedAt))
  return result
})

async function load(): Promise<void> {
  if (!workspaceId.value) return
  loading.value = true
  errorMessage.value = ''
  try {
    const res = await nodesApi.trash(workspaceId.value)
    nodes.value = res.nodes
  } catch (err) {
    errorMessage.value = messageOf(err)
  } finally {
    loading.value = false
  }
}

onMounted(load)

watch(workspaceId, () => {
  nodes.value = []
  void load()
})

/** 整批还原。422（上级目录已被删除等）原样提示。 */
async function onRestore(batch: TrashBatch): Promise<void> {
  restoringId.value = batch.rootId
  errorMessage.value = ''
  try {
    await nodesApi.restore(batch.rootId)
    await load()
  } catch (err) {
    errorMessage.value = messageOf(err)
  } finally {
    restoringId.value = null
  }
}

function openPurge(batch: TrashBatch): void {
  purgeTarget.value = batch.root
  purgeInput.value = ''
}

function cancelPurge(): void {
  purgeTarget.value = null
  purgeInput.value = ''
}

/** 彻底删除需输入批次根标题精确匹配（防误触，不可逆操作）。 */
const purgeConfirmEnabled = computed(
  () => purgeTarget.value !== null && purgeInput.value === (purgeTarget.value.title || '未命名'),
)

async function onPurge(): Promise<void> {
  const target = purgeTarget.value
  if (!target || !purgeConfirmEnabled.value || purging.value) return
  purging.value = true
  errorMessage.value = ''
  try {
    await nodesApi.purge(target.id)
    cancelPurge()
    await load()
  } catch (err) {
    errorMessage.value = messageOf(err)
    cancelPurge()
  } finally {
    purging.value = false
  }
}

function backToWorkspace(): void {
  void router.push({ name: 'workspace', params: { workspaceId: workspaceId.value } })
}
</script>

<template>
  <div class="flex h-screen flex-col">
    <!-- 顶栏 -->
    <header class="flex items-center gap-3 border-b border-gray-200 px-4 py-2.5">
      <span class="text-sm font-semibold text-gray-900">weShare</span>
      <button
        type="button"
        class="rounded border border-gray-300 px-2.5 py-1 text-sm text-gray-700 hover:bg-gray-50"
        @click="backToWorkspace"
      >
        返回空间
      </button>
      <span class="text-sm text-gray-500">回收站</span>
      <span class="ml-auto text-sm text-gray-500">{{ session.user?.displayName }}</span>
    </header>

    <main class="min-w-0 flex-1 overflow-auto p-4">
      <p
        v-if="errorMessage"
        role="alert"
        class="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
      >
        {{ errorMessage }}
      </p>

      <div v-if="loading" data-testid="trash-loading" class="py-8 text-center text-sm text-gray-500">
        加载中…
      </div>

      <div
        v-else-if="batches.length === 0"
        data-testid="trash-empty"
        class="rounded border border-dashed border-gray-200 py-10 text-center text-sm text-gray-500"
      >
        回收站是空的
      </div>

      <ul v-else data-testid="trash-list" class="divide-y divide-gray-100 rounded border border-gray-200 bg-white">
        <li
          v-for="batch in batches"
          :key="batch.rootId"
          data-testid="trash-batch"
          class="flex items-center gap-3 px-4 py-3"
        >
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-medium text-gray-900">{{ batch.title }}</p>
            <p class="mt-0.5 text-xs text-gray-500">
              {{ batch.count }} 项 · 删除于 {{ new Date(batch.deletedAt).toLocaleString() }}
            </p>
          </div>

          <button
            type="button"
            data-testid="restore-btn"
            class="rounded border border-gray-300 px-2.5 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-40"
            :disabled="restoringId === batch.rootId"
            @click="onRestore(batch)"
          >
            {{ restoringId === batch.rootId ? '还原中…' : '还原' }}
          </button>

          <AlertDialogRoot v-if="canPurge">
            <AlertDialogTrigger as-child>
              <button
                type="button"
                data-testid="purge-btn"
                class="rounded border border-red-200 px-2.5 py-1 text-xs text-red-600 hover:bg-red-50"
                @click="openPurge(batch)"
              >
                彻底删除
              </button>
            </AlertDialogTrigger>

            <AlertDialogContent
              class="fixed left-1/2 top-1/2 z-50 w-[420px] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-gray-200 bg-white p-5 shadow-lg"
            >
              <AlertDialogTitle class="text-base font-semibold text-gray-900">
                彻底删除「{{ purgeTarget?.title || '未命名' }}」？
              </AlertDialogTitle>
              <AlertDialogDescription class="mt-1 text-sm text-gray-600">
                此操作不可恢复，将连同全部子项一起删除。输入
                <span class="font-medium text-gray-900">{{ purgeTarget?.title || '未命名' }}</span>
                以确认。
              </AlertDialogDescription>

              <input
                v-model="purgeInput"
                data-testid="purge-confirm-input"
                type="text"
                class="mt-3 w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                placeholder="输入标题以确认"
              />

              <div class="mt-4 flex justify-end gap-2">
                <AlertDialogCancel as-child>
                  <button
                    type="button"
                    data-testid="purge-cancel-btn"
                    class="rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
                  >
                    取消
                  </button>
                </AlertDialogCancel>
                <AlertDialogAction as-child>
                  <button
                    type="button"
                    data-testid="purge-confirm-btn"
                    class="rounded bg-red-600 px-3 py-1.5 text-sm text-white hover:bg-red-700 disabled:opacity-40"
                    :disabled="!purgeConfirmEnabled || purging"
                    @click="onPurge"
                  >
                    {{ purging ? '删除中…' : '彻底删除' }}
                  </button>
                </AlertDialogAction>
              </div>
            </AlertDialogContent>
          </AlertDialogRoot>
        </li>
      </ul>
    </main>
  </div>
</template>
