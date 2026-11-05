<script setup lang="ts">
/**
 * 空间设置：基本信息 + 成员管理。
 *
 * 页面级权限只决定**是否渲染控件**——服务端每次请求仍会复核
 * （架构文档 §8.4：前端隐藏按钮后端必须复查）。所以这里的判断错
 * 也不会造成越权，只会造成"点了报 403"。
 *
 * 成员列表用卡片行而不是表格：这里每行有 2 行文字 + 2 个控件，
 * 表格的行高与列宽在窄屏下会挤成一团。
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ApiError } from '@/api/client.js'
import { workspacesApi, type MemberView, type WorkspaceDetail } from '@/api/workspaces.js'
import { useSessionStore } from '@/stores/session.js'
import AppShell from '@/components/layout/AppShell.vue'
import {
  AppAlert,
  AppButton,
  AppDialog,
  AppField,
  AppInput,
  AppMenu,
  AppSkeleton,
  type MenuItem,
} from '@/components/ui/index.js'
import { toast } from '@/components/ui/toast.js'
import AppIcon from '@/components/icons/AppIcon.vue'

const route = useRoute()
const session = useSessionStore()

const workspaceId = computed(() => String(route.params.workspaceId ?? ''))

const workspace = ref<WorkspaceDetail | null>(null)
const members = ref<MemberView[]>([])
const loading = ref(true)
const errorMessage = ref('')

const myRole = computed(() => workspace.value?.role ?? null)
const canManageMembers = computed(() => myRole.value === 'owner' || myRole.value === 'admin')
const isOwner = computed(() => myRole.value === 'owner')

const nameDraft = ref('')
const defaultRoleDraft = ref<'view' | 'comment' | 'edit'>('edit')
const savingBasic = ref(false)
const basicDirty = computed(
  () =>
    workspace.value !== null &&
    (nameDraft.value.trim() !== workspace.value.name || defaultRoleDraft.value !== workspace.value.defaultRole),
)

const ROLE_LABEL: Record<string, string> = {
  owner: '所有者',
  admin: '管理员',
  member: '成员',
  viewer: '只读',
}

const DEFAULT_ROLE_OPTIONS = [
  { value: 'edit', label: '可编辑' },
  { value: 'comment', label: '可评论' },
  { value: 'view', label: '只读' },
] as const

function fail(err: unknown, fallback: string): void {
  errorMessage.value = err instanceof ApiError ? err.message : fallback
}

async function load(): Promise<void> {
  if (!workspaceId.value) return
  errorMessage.value = ''
  try {
    const [detail, memberList] = await Promise.all([
      workspacesApi.detail(workspaceId.value),
      workspacesApi.members(workspaceId.value),
    ])
    workspace.value = detail.workspace
    members.value = memberList.members
    nameDraft.value = detail.workspace.name
    defaultRoleDraft.value = detail.workspace.defaultRole
  } catch (err) {
    fail(err, '加载失败')
  } finally {
    loading.value = false
  }
}

onMounted(load)
watch(workspaceId, () => {
  loading.value = true
  void load()
})

async function saveBasic(): Promise<void> {
  if (!workspace.value || !basicDirty.value) return
  savingBasic.value = true
  errorMessage.value = ''
  try {
    const res = await workspacesApi.update(workspaceId.value, {
      name: nameDraft.value.trim(),
      defaultRole: defaultRoleDraft.value,
    })
    workspace.value = res.workspace
    await session.fetchMe()
    toast('空间设置已保存')
  } catch (err) {
    fail(err, '保存失败')
  } finally {
    savingBasic.value = false
  }
}

// ------------------------------------------------------------ 添加成员
const inviteDialog = ref<{ open: boolean; email: string; role: 'admin' | 'member' | 'viewer'; busy: boolean }>({
  open: false,
  email: '',
  role: 'member',
  busy: false,
})

function openInvite(): void {
  inviteDialog.value = { open: true, email: '', role: 'member', busy: false }
}

const inviteInvalid = computed(() => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inviteDialog.value.email.trim()))

async function submitInvite(): Promise<void> {
  const d = inviteDialog.value
  if (inviteInvalid.value || d.busy) return
  d.busy = true
  errorMessage.value = ''
  try {
    await workspacesApi.addMember(workspaceId.value, { email: d.email.trim(), role: d.role })
    d.open = false
    await load()
    toast('已添加成员')
  } catch (err) {
    fail(err, '添加失败')
    d.busy = false
  }
}

// ------------------------------------------------------------ 改角色 / 移除
async function changeRole(member: MemberView, role: 'admin' | 'member' | 'viewer'): Promise<void> {
  errorMessage.value = ''
  try {
    await workspacesApi.updateMember(workspaceId.value, member.userId, role)
    await load()
    toast(`${member.displayName} 现在是${ROLE_LABEL[role]}`)
  } catch (err) {
    fail(err, '修改角色失败')
  }
}

const removeDialog = ref<{ open: boolean; member: MemberView | null; busy: boolean }>({
  open: false,
  member: null,
  busy: false,
})

function openRemove(member: MemberView): void {
  removeDialog.value = { open: true, member, busy: false }
}

async function submitRemove(): Promise<void> {
  const d = removeDialog.value
  if (!d.member) return
  d.busy = true
  try {
    await workspacesApi.removeMember(workspaceId.value, d.member.userId)
    d.open = false
    await load()
    toast('已移除成员')
  } catch (err) {
    fail(err, '移除失败')
    d.busy = false
  }
}

function roleEditable(member: MemberView): boolean {
  return canManageMembers.value && member.role !== 'owner'
}

const roleMenuItems: MenuItem[] = [
  { key: 'admin', label: '管理员 · 可管理成员与设置' },
  { key: 'member', label: '成员 · 可创建与编辑' },
  { key: 'viewer', label: '只读 · 只能查看' },
]

function memberInitial(m: MemberView): string {
  return m.displayName.trim().slice(0, 1).toUpperCase()
}

function memberHue(m: MemberView): number {
  let h = 0
  for (let i = 0; i < m.displayName.length; i++) h = (h * 31 + m.displayName.charCodeAt(i)) % 360
  return h
}
</script>

<template>
  <AppShell>
    <main class="min-h-0 flex-1 overflow-auto">
      <div class="mx-auto w-full max-w-3xl px-5 py-6">
        <div class="mb-5">
          <h1 class="text-[17px] font-semibold tracking-tight text-ink">空间设置</h1>
          <p class="mt-1 text-[12px] text-muted">
            {{ workspace?.name ?? '空间' }} · 你的角色：{{ ROLE_LABEL[myRole ?? ''] ?? '—' }}
          </p>
        </div>

        <AppAlert v-if="errorMessage" tone="error" class="mb-4">
          {{ errorMessage }}
          <button type="button" class="ml-2 underline" @click="load">重试</button>
        </AppAlert>

        <div v-if="loading" class="space-y-3">
          <AppSkeleton height="140px" rounded="10px" />
          <AppSkeleton height="200px" rounded="10px" />
        </div>

        <template v-else-if="workspace">
          <!-- 基本信息 -->
          <section class="rounded-lg border border-line bg-surface">
            <header class="flex items-center gap-2 border-b border-line px-4 py-2.5">
              <AppIcon name="settings" :size="14" class="text-faint" />
              <h2 class="text-[13px] font-medium text-ink">基本信息</h2>
              <span v-if="!isOwner" class="ml-auto text-[11.5px] text-faint">仅所有者可修改</span>
            </header>

            <div class="space-y-4 p-4">
              <AppField label="空间名称" html-for="ws-name" :hint="isOwner ? '同事在切换空间时看到的名字' : undefined">
                <AppInput id="ws-name" v-model="nameDraft" :disabled="!isOwner" :invalid="!nameDraft.trim()" />
              </AppField>

              <AppField
                label="新文档默认权限"
                html-for="ws-default-role"
                hint="影响空间内「工作区可见」文档的默认角色。私密文档不受此影响。"
              >
                <div class="flex gap-1.5">
                  <button
                    v-for="opt in DEFAULT_ROLE_OPTIONS"
                    :key="opt.value"
                    type="button"
                    :disabled="!isOwner"
                    :class="[
                      'h-7 rounded border px-2.5 text-[12.5px] transition-colors focus-ring disabled:opacity-50',
                      defaultRoleDraft === opt.value
                        ? 'border-brand-400 bg-brand-50 font-medium text-brand-700'
                        : 'border-line-strong bg-surface text-muted hover:bg-subtle',
                    ]"
                    @click="defaultRoleDraft = opt.value"
                  >
                    {{ opt.label }}
                  </button>
                </div>
              </AppField>

              <div v-if="isOwner" class="flex items-center gap-2 pt-0.5">
                <AppButton
                  variant="primary"
                  :loading="savingBasic"
                  :disabled="!basicDirty || !nameDraft.trim()"
                  @click="saveBasic"
                >
                  保存
                </AppButton>
                <span v-if="basicDirty" class="text-[11.5px] text-warning">有未保存的修改</span>
              </div>
            </div>
          </section>

          <!-- 成员 -->
          <section class="mt-4 rounded-lg border border-line bg-surface">
            <header class="flex items-center gap-2 border-b border-line px-4 py-2.5">
              <AppIcon name="users" :size="14" class="text-faint" />
              <h2 class="text-[13px] font-medium text-ink">成员</h2>
              <span class="rounded bg-subtle px-1.5 py-0.5 text-[11px] text-muted">{{ members.length }}</span>
              <AppButton
                v-if="canManageMembers"
                class="ml-auto"
                size="sm"
                icon="plus"
                variant="secondary"
                @click="openInvite"
              >
                添加成员
              </AppButton>
            </header>

            <ul class="divide-y divide-line">
              <li
                v-for="m in members"
                :key="m.userId"
                class="flex items-center gap-3 px-4 py-2.5"
                :data-member-id="m.userId"
              >
                <span
                  class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white"
                  :style="{ backgroundColor: `hsl(${memberHue(m)} 40% 48%)` }"
                >
                  {{ memberInitial(m) }}
                </span>

                <div class="min-w-0 flex-1">
                  <p class="truncate text-[13px] text-ink">
                    {{ m.displayName }}
                    <span v-if="m.userId === session.user?.id" class="text-[11.5px] text-faint">（你）</span>
                  </p>
                  <p class="truncate text-[11.5px] text-faint">{{ m.email }}</p>
                </div>

                <AppMenu
                  v-if="roleEditable(m)"
                  :items="roleMenuItems"
                  @select="(key) => changeRole(m, key as 'admin' | 'member' | 'viewer')"
                >
                  <template #trigger>
                    <button
                      type="button"
                      class="flex h-6 items-center gap-1 rounded border border-line-strong px-2 text-[11.5px] text-muted hover:bg-subtle focus-ring"
                    >
                      {{ ROLE_LABEL[m.role] }}
                      <AppIcon name="chevron-down" :size="11" class="text-faint" />
                    </button>
                  </template>
                </AppMenu>
                <span v-else class="rounded bg-subtle px-2 py-0.5 text-[11.5px] text-muted">
                  {{ ROLE_LABEL[m.role] }}
                </span>

                <AppButton
                  v-if="roleEditable(m)"
                  size="sm"
                  variant="danger-ghost"
                  square
                  icon="x"
                  :aria-label="`移除 ${m.displayName}`"
                  @click="openRemove(m)"
                />
                <span v-else class="w-6" />
              </li>
            </ul>

            <p v-if="!canManageMembers" class="border-t border-line px-4 py-2.5 text-[11.5px] text-faint">
              仅空间所有者或管理员可管理成员。
            </p>
          </section>
        </template>
      </div>
    </main>

    <!-- 添加成员 -->
    <AppDialog
      v-model:open="inviteDialog.open"
      title="添加成员"
      description="对方必须已经注册过 weShare 账号。"
      icon="users"
      confirm-text="添加"
      :loading="inviteDialog.busy"
      :confirm-disabled="inviteInvalid || inviteDialog.busy"
      @confirm="submitInvite"
    >
      <div class="space-y-3">
        <AppField label="邮箱" html-for="invite-email" :error="inviteDialog.email && inviteInvalid ? '邮箱格式不正确' : ''">
          <AppInput
            id="invite-email"
            v-model="inviteDialog.email"
            type="email"
            placeholder="name@company.com"
            @keyup.enter="submitInvite"
          />
        </AppField>
        <AppField label="角色" html-for="invite-role">
          <select id="invite-role" v-model="inviteDialog.role" class="field">
            <option value="admin">管理员</option>
            <option value="member">成员</option>
            <option value="viewer">只读</option>
          </select>
        </AppField>
      </div>
    </AppDialog>

    <!-- 移除成员 -->
    <AppDialog
      v-model:open="removeDialog.open"
      title="移出空间"
      tone="danger"
      icon="alert"
      confirm-text="移出"
      :loading="removeDialog.busy"
      @confirm="submitRemove"
    >
      <template #description>
        {{ removeDialog.member?.displayName }} 将立即失去对该空间所有内容的访问。其创建的文档仍留在空间里。
      </template>
    </AppDialog>
  </AppShell>
</template>
