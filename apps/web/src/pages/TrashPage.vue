<script setup lang="ts">
/**
 * 回收站。
 *
 * 两级危险动作，风险不同、确认方式也不同：
 *   - **还原**：可逆，一次点击即可，无需确认；
 *   - **永久删除**：不可逆，要求**手打标题**确认——不是点两下的肌肉记忆。
 *
 * 列表只显示当前用户有 manage 权限的已删除节点（服务端过滤）。
 */
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ApiError } from '@/api/client.js'
import { nodesApi, type TreeNodeItem } from '@/api/nodes.js'
import { useSessionStore } from '@/stores/session.js'
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

const route = useRoute()
const router = useRouter()
const session = useSessionStore()

const workspaceId = computed(() => String(route.params.workspaceId ?? ''))
const items = ref<TreeNodeItem[]>([])
const loading = ref(true)
const errorMessage = ref('')
const busyId = ref<string | null>(null)

/** 当前用户是否能在该空间永久删除（仅 owner/admin）。 */
const canPurge = computed(() => {
  const role = session.workspaces.find((w) => w.id === workspaceId.value)?.role
  return role === 'owner' || role === 'admin'
})

async function load(): Promise<void> {
  errorMessage.value = ''
  try {
    const res = await nodesApi.trash(workspaceId.value)
    items.value = res.nodes
  } catch (err) {
    errorMessage.value = err instanceof ApiError ? err.message : '加载回收站失败'
  } finally {
    loading.value = false
  }
}

onMounted(load)

async function restore(node: TreeNodeItem): Promise<void> {
  busyId.value = node.id
  try {
    const res = await nodesApi.restore(node.id)
    await load()
    toast(res.affected > 1 ? `已还原 ${res.affected} 项` : `「${node.title || '未命名'}」已还原`)
  } catch (err) {
    errorMessage.value = err instanceof ApiError ? err.message : '还原失败'
  } finally {
    busyId.value = null
  }
}

// ------------------------------------------------------------ 永久删除
const purgeDialog = ref<{ open: boolean; node: TreeNodeItem | null; typed: string; busy: boolean }>({
  open: false,
  node: null,
  typed: '',
  busy: false,
})

function openPurge(node: TreeNodeItem): void {
  purgeDialog.value = { open: true, node, typed: '', busy: false }
}

const purgeTargetTitle = computed(() => purgeDialog.value.node?.title || '未命名')
const purgeConfirmable = computed(() => purgeDialog.value.typed.trim() === purgeTargetTitle.value)

async function submitPurge(): Promise<void> {
  const d = purgeDialog.value
  if (!d.node || !purgeConfirmable.value) return
  d.busy = true
  try {
    await nodesApi.purge(d.node.id)
    d.open = false
    await load()
    toast('已永久删除')
  } catch (err) {
    errorMessage.value = err instanceof ApiError ? err.message : '永久删除失败'
    d.busy = false
  }
}

function fmtTime(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function back(): void {
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
              @click="back"
            >
              <AppIcon name="chevron-left" :size="15" />
            </button>
            <h1 class="text-[17px] font-semibold tracking-tight text-ink">回收站</h1>
          </div>
          <p class="mt-1 pl-5 text-[12px] text-muted">
            只显示你有权限管理的已删除内容。还原后回到原来的位置。
          </p>
        </div>
        <AppButton size="sm" icon="restore" :disabled="loading" @click="load">刷新</AppButton>
      </div>

      <AppAlert v-if="errorMessage" tone="error" class="mb-3">
        {{ errorMessage }}
        <button type="button" class="ml-2 underline" @click="load">重试</button>
      </AppAlert>

      <div v-if="loading" class="space-y-2">
        <AppSkeleton v-for="i in 4" :key="i" height="40px" rounded="6px" />
      </div>

      <div v-else-if="items.length === 0" class="rounded-lg border border-line bg-surface">
        <AppEmpty
          icon="trash"
          title="回收站是空的"
          description="被删除的文档和文件夹会先来到这里，方便你在误删后还原。"
        >
          <AppButton @click="back">回到工作区</AppButton>
        </AppEmpty>
      </div>

      <ul v-else class="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
        <li
          v-for="item in items"
          :key="item.id"
          class="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-subtle/60"
        >
          <AppIcon
            :name="item.type === 'folder' ? 'folder' : 'file'"
            :size="14"
            :class="item.type === 'folder' ? 'text-[#c9a24a]' : 'text-faint'"
          />
          <div class="min-w-0 flex-1">
            <p class="truncate text-[13px] text-ink">{{ item.title || '未命名' }}</p>
            <p class="mt-0.5 text-[11px] text-faint">
              {{ item.type === 'folder' ? '文件夹' : '文档' }} · 删除于 {{ fmtTime(item.deletedAt) }}
            </p>
          </div>

          <AppButton
            size="sm"
            icon="restore"
            :loading="busyId === item.id"
            :disabled="busyId !== null"
            @click="restore(item)"
          >
            还原
          </AppButton>
          <AppButton
            v-if="canPurge"
            size="sm"
            variant="danger-ghost"
            icon="trash"
            :disabled="busyId !== null"
            @click="openPurge(item)"
          >
            永久删除
          </AppButton>
        </li>
      </ul>

      <p v-if="!loading && items.length > 0 && !canPurge" class="mt-3 text-[11.5px] text-faint">
        永久删除仅空间所有者与管理员可用。
      </p>
    </main>

    <!-- 永久删除：要求手打标题 -->
    <AppDialog
      v-model:open="purgeDialog.open"
      title="永久删除，无法恢复"
      tone="danger"
      icon="alert"
      confirm-text="永久删除"
      :loading="purgeDialog.busy"
      :confirm-disabled="!purgeConfirmable || purgeDialog.busy"
      @confirm="submitPurge"
    >
      <template #description>
        「{{ purgeTargetTitle }}」
        <template v-if="purgeDialog.node?.type === 'folder'">及其所有子项</template>
        的正文、版本与协同时状态都会被从数据库里删掉，**不能还原**。
      </template>

      <AppField
        :label="`请输入「${purgeTargetTitle}」以确认`"
        html-for="purge-confirm"
        :hint="purgeConfirmable ? '' : '标题必须完全一致（含空格）'"
      >
        <AppInput
          id="purge-confirm"
          v-model="purgeDialog.typed"
          :placeholder="purgeTargetTitle"
          autocomplete="off"
          @keyup.enter="submitPurge"
        />
      </AppField>
    </AppDialog>
  </AppShell>
</template>
