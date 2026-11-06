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
import { ApiError } from '@/api/client.js'
import { nodesApi, type TrashNodeItem } from '@/api/nodes.js'
import { useSessionStore } from '@/stores/session.js'
import { errorMessage as formatErrorMessage } from '@weshare/shared'
import AppShell from '@/components/layout/AppShell.vue'
import {
  AppAlert,
  AppButton,
  AppDialog,
  AppEmpty,
  AppField,
  AppInput,
  AppSkeleton,
} from '@/components/ui/index.js'
import { toast } from '@/components/ui/toast.js'
import AppIcon from '@/components/icons/AppIcon.vue'

const session = useSessionStore()
const route = useRoute()
const router = useRouter()

const workspaceId = computed(() => String(route.params.workspaceId ?? ''))

const nodes = ref<TrashNodeItem[]>([])
const loading = ref(false)
const errorMessage = ref('')

/** 统一错误文案：shared 的 errorMessage 已收 NETWORK_ERROR，直接透传。 */
function messageOf(err: unknown): string {
  if (err instanceof ApiError) {
    return formatErrorMessage({ code: err.code, message: err.message })
  }
  return '操作失败，请稍后重试'
}

/** 确认弹窗状态：当前待彻底删除的批次根。null 表示弹窗关闭。 */
const purgeTarget = ref<TrashNodeItem | null>(null)
const purgeInput = ref('')
const purging = ref(false)
const restoringId = ref<string | null>(null)

/** 当前用户在该空间的成员角色。 */
const myRole = computed(
  () => session.workspaces.find((w) => w.id === workspaceId.value)?.role ?? null,
)
/** 彻底删除仅空间 owner/admin（§8.2 第 5 条）；还原只需 manage，服务端已过滤。 */
const canPurge = computed(() => myRole.value === 'owner' || myRole.value === 'admin')
/** 是否存在整批不可完整看见的批次（用于给出整批操作被禁用的原因）。 */
const hasIncompleteBatch = computed(() => batches.value.some((b) => b.incomplete))

interface TrashBatch {
  rootId: string
  title: string
  /** 这一批里**我能看见**的项数。 */
  count: number
  /** 这一批的**整批**项数（服务端在权限过滤前聚合，只给数字）。 */
  batchSize: number
  deletedAt: string
  root: TrashNodeItem
  /**
   * 整批不可完整看见——可见项数少于整批项数。
   *
   * 判据必须是「可见项数 = 整批项数」，不能是「批次根在不在可见列表」：
   * 根可见但部分子项无权时，后者恒为 false，界面会把批次当完整的，
   * 彻底删除可点，purge 级联删掉用户看不见的私密内容（评审 #18 F1）。
   */
  incomplete: boolean
}

/** 按 trashRootId 分组聚批（兜底：无 trashRootId 的旧数据按自身 id 成批）。 */
const batches = computed<TrashBatch[]>(() => {
  const byRoot = new Map<string, TrashNodeItem[]>()
  for (const n of nodes.value) {
    const rootId = n.trashRootId ?? n.id
    const list = byRoot.get(rootId)
    if (list) list.push(n)
    else byRoot.set(rootId, [n])
  }
  const result: TrashBatch[] = []
  for (const [rootId, list] of byRoot) {
    const root: TrashNodeItem | undefined = list.find((n) => n.id === rootId)
    // 批次根缺席：还原会 404、purge 只能删掉可见子树，整批操作必须禁用。
    // 但"根在不在"只是整批可见性的一半——根可见、子项不可见同样必须禁用，
    // 所以统一按「可见项数 < 整批项数」判定。标题取最早删除的可见子项快照。
    const head: TrashNodeItem =
      root ??
      [...list].sort((a, b) =>
        (a.deletedAt ?? a.updatedAt).localeCompare(b.deletedAt ?? b.updatedAt),
      )[0]!
    const count = list.length
    // 同批次所有项的 batchSize 相同；缺字段（旧数据/旧服务端）时按可见项数兜底，
    // 宁可少禁用一次操作，也不凭空宣称批次残缺。
    const batchSize = Math.max(
      count,
      ...list.map((n) => n.batchSize ?? count),
    )
    result.push({
      rootId,
      title: head.title || '未命名',
      count,
      batchSize,
      deletedAt: head.deletedAt ?? head.updatedAt,
      root: head,
      incomplete: count < batchSize,
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

/** 整批还原。批次根不可见时禁用；422（上级目录已被删除等）原样提示。 */
async function onRestore(batch: TrashBatch): Promise<void> {
  if (batch.incomplete || restoringId.value !== null) return
  restoringId.value = batch.rootId
  errorMessage.value = ''
  try {
    const res = await nodesApi.restore(batch.rootId)
    await load()
    toast(res.affected > 1 ? `已还原 ${res.affected} 项` : `已还原「${batch.title}」`)
  } catch (err) {
    errorMessage.value = messageOf(err)
  } finally {
    restoringId.value = null
  }
}

function openPurge(batch: TrashBatch): void {
  if (batch.incomplete || restoringId.value !== null) return
  purgeTarget.value = batch.root
  purgeInput.value = ''
}

function cancelPurge(): void {
  purgeTarget.value = null
  purgeInput.value = ''
}

/** 弹窗开关（AppDialog 的 v-model:open 需要可写布尔）。 */
const purgeOpen = computed({
  get: () => purgeTarget.value !== null,
  set: (v: boolean) => {
    if (!v) cancelPurge()
  },
})

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
    const title = target.title || '未命名'
    cancelPurge()
    await load()
    toast(`「${title}」已彻底删除`)
  } catch (err) {
    errorMessage.value = messageOf(err)
    cancelPurge()
  } finally {
    purging.value = false
  }
}

function fmtTime(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function backToWorkspace(): void {
  void router.push({ name: 'workspace', params: { workspaceId: workspaceId.value } })
}
</script>

<template>
  <AppShell>
    <main class="mx-auto w-full max-w-4xl px-5 py-6">
      <div class="mb-5 flex items-end justify-between gap-4">
        <div>
          <div class="flex items-center gap-1.5">
            <button
              type="button"
              class="rounded text-muted transition-colors hover:text-ink focus-ring"
              aria-label="返回工作区"
              @click="backToWorkspace"
            >
              <AppIcon name="chevron-left" :size="15" />
            </button>
            <h1 class="text-[17px] font-semibold tracking-tight text-ink">回收站</h1>
          </div>
          <p class="mt-1 pl-5 text-[12px] text-muted">
            只显示你有权限管理的已删除内容。还原会把整批内容放回原来的位置。
          </p>
        </div>
        <AppButton size="sm" icon="restore" :disabled="loading" @click="load">刷新</AppButton>
      </div>

      <AppAlert v-if="errorMessage" tone="error" class="mb-3">
        <span role="alert">{{ errorMessage }}</span>
        <button type="button" class="ml-2 underline" @click="load">重试</button>
      </AppAlert>

      <div v-if="loading" data-testid="trash-loading" class="space-y-2">
        <AppSkeleton v-for="i in 4" :key="i" height="40px" rounded="6px" />
      </div>

      <div v-else-if="batches.length === 0" data-testid="trash-empty" class="rounded-lg border border-line bg-surface">
        <AppEmpty
          icon="trash"
          title="回收站是空的"
          description="被删除的文档和文件夹会先来到这里，方便你在误删后还原。"
        >
          <AppButton @click="backToWorkspace">回到工作区</AppButton>
        </AppEmpty>
      </div>

      <ul
        v-else
        data-testid="trash-list"
        class="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface"
      >
        <li
          v-for="batch in batches"
          :key="batch.rootId"
          data-testid="trash-batch"
          class="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-subtle/60"
        >
          <AppIcon
            :name="batch.root.type === 'folder' ? 'folder' : 'file'"
            :size="14"
            :class="batch.root.type === 'folder' ? 'text-[#c9a24a]' : 'text-faint'"
          />
          <div class="min-w-0 flex-1">
            <p class="truncate text-[13px] text-ink" :class="batch.incomplete ? 'text-faint' : ''">
              {{ batch.title }}
            </p>
            <p class="mt-0.5 text-[11px] text-faint">
              <template v-if="batch.incomplete">
                该批次共 {{ batch.batchSize }} 项，你只能看到 {{ batch.count }} 项 ·
              </template>
              <template v-else>{{ batch.count }} 项 ·</template>
              删除于 {{ fmtTime(batch.deletedAt) }}
            </p>
          </div>

          <AppButton
            size="sm"
            icon="restore"
            data-testid="restore-btn"
            :loading="restoringId === batch.rootId"
            :disabled="restoringId !== null || batch.incomplete"
            @click="onRestore(batch)"
          >
            还原
          </AppButton>
          <AppButton
            v-if="canPurge"
            size="sm"
            variant="danger-ghost"
            icon="trash"
            data-testid="purge-btn"
            :disabled="restoringId !== null || batch.incomplete"
            @click="openPurge(batch)"
          >
            彻底删除
          </AppButton>
        </li>
      </ul>

      <p v-if="!loading && batches.length > 0 && !canPurge" class="mt-3 text-[11.5px] text-faint">
        彻底删除仅空间所有者与管理员可用。
      </p>
      <AppAlert
        v-if="!loading && hasIncompleteBatch"
        tone="warning"
        data-testid="incomplete-batch-alert"
        class="mt-3"
      >
        <span data-testid="incomplete-batch-hint">
          部分批次你只能看到其中一部分内容，整批还原与彻底删除已禁用。每行标注的是「该批次共 N 项，你只能看到 M
          项」——M 小于 N 时，整批操作会动到你无权查看的内容。
        </span>
      </AppAlert>
    </main>

    <!-- 彻底删除：要求手打批次根标题 -->
    <AppDialog
      v-model:open="purgeOpen"
      title="彻底删除，无法恢复"
      tone="danger"
      icon="alert"
      confirm-text="彻底删除"
      :loading="purging"
      :confirm-disabled="!purgeConfirmEnabled || purging"
      @confirm="onPurge"
    >
      <template #description>
        「{{ purgeTarget?.title || '未命名' }}」
        <template v-if="purgeTarget?.type === 'folder'">及其所有子项</template>
        的正文、版本与协同状态都会被从数据库里删掉，不能还原。
      </template>

      <AppField
        :label="`请输入「${purgeTarget?.title || '未命名'}」以确认`"
        html-for="purge-confirm"
        :hint="purgeConfirmEnabled ? '' : '标题必须完全一致（含空格）'"
      >
        <AppInput
          id="purge-confirm"
          v-model="purgeInput"
          data-testid="purge-confirm-input"
          :placeholder="purgeTarget?.title || '未命名'"
          autocomplete="off"
          @keyup.enter="onPurge"
        />
      </AppField>
    </AppDialog>
  </AppShell>
</template>
