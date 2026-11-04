<script setup lang="ts">
/**
 * 空间设置页（T3.3）。
 *
 * 三块：基本信息（仅 owner 可改）、成员管理（owner/admin）、页面级权限。
 *
 * 页面级权限只决定**是否渲染控件**——服务端每次请求仍会复核
 * （架构文档 §8.4：前端隐藏按钮后端必须复查）。所以这里的
 * `canManageMembers` 判断错也不会造成越权，只会造成"点了报 403"。
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ApiError } from '@/api/client.js'
import { api } from '@/api/client.js'
import type { WorkspaceMemberView, WorkspaceView } from '@weshare/shared'
import { useSessionStore } from '@/stores/session.js'

const route = useRoute()
const session = useSessionStore()

const workspaceId = computed(() => String(route.params.workspaceId ?? ''))

const workspace = ref<WorkspaceView | null>(null)
const members = ref<WorkspaceMemberView[]>([])
const loading = ref(false)
const errorMessage = ref('')
const notice = ref('')

/** 我的角色（决定控件显隐）。 */
const myRole = computed(() => workspace.value?.role ?? null)
const canManageMembers = computed(() => myRole.value === 'owner' || myRole.value === 'admin')
const isOwner = computed(() => myRole.value === 'owner')

const nameDraft = ref('')
const defaultRoleDraft = ref<'view' | 'comment' | 'edit'>('edit')

const newMemberEmail = ref('')
const newMemberRole = ref<'admin' | 'member' | 'viewer'>('member')

function fail(err: unknown, fallback: string): void {
  errorMessage.value = err instanceof ApiError ? err.message : fallback
}

async function load(): Promise<void> {
  if (!workspaceId.value) return
  loading.value = true
  errorMessage.value = ''
  try {
    const [detail, memberList] = await Promise.all([
      api.get<{ workspace: WorkspaceView }>(`/workspaces/${workspaceId.value}`),
      api.get<{ members: WorkspaceMemberView[] }>(
        `/workspaces/${workspaceId.value}/members`,
      ),
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
watch(workspaceId, load)

async function saveBasic(): Promise<void> {
  if (!workspace.value) return
  notice.value = ''
  errorMessage.value = ''
  try {
    const res = await api.patch<{ workspace: WorkspaceView }>(
      `/workspaces/${workspaceId.value}`,
      { name: nameDraft.value.trim(), defaultRole: defaultRoleDraft.value },
    )
    workspace.value = res.workspace
    notice.value = '已保存'
    // 顶栏的空间名来自 session，刷新一下
    await session.fetchMe()
  } catch (err) {
    fail(err, '保存失败')
  }
}

async function addMember(): Promise<void> {
  notice.value = ''
  errorMessage.value = ''
  const email = newMemberEmail.value.trim()
  if (!email) return

  try {
    await api.post(`/workspaces/${workspaceId.value}/members`, {
      email,
      role: newMemberRole.value,
    })
    newMemberEmail.value = ''
    notice.value = '已添加'
    await load()
  } catch (err) {
    fail(err, '添加失败')
  }
}

async function changeRole(member: WorkspaceMemberView, role: string): Promise<void> {
  notice.value = ''
  errorMessage.value = ''
  try {
    await api.patch(`/workspaces/${workspaceId.value}/members/${member.userId}`, { role })
    await load()
  } catch (err) {
    fail(err, '修改角色失败')
  }
}

async function removeMember(member: WorkspaceMemberView): Promise<void> {
  if (!window.confirm(`把 ${member.displayName} 移出空间？`)) return
  notice.value = ''
  errorMessage.value = ''
  try {
    await api.delete(`/workspaces/${workspaceId.value}/members/${member.userId}`)
    await load()
  } catch (err) {
    fail(err, '移除失败')
  }
}

/** owner 与其他角色不可通过本页改（服务端也会拒绝）。 */
function roleEditable(member: WorkspaceMemberView): boolean {
  return canManageMembers.value && member.role !== 'owner'
}
</script>

<template>
  <div class="mx-auto max-w-3xl p-8">
    <nav class="mb-4 flex items-center gap-2 text-sm text-gray-500">
      <router-link
        :to="{ name: 'workspace', params: { workspaceId } }"
        class="hover:text-blue-600"
      >
        ← 返回空间
      </router-link>
    </nav>

    <h1 class="mb-6 text-xl font-semibold text-gray-900">空间设置</h1>

    <p
      v-if="errorMessage"
      role="alert"
      class="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
    >
      {{ errorMessage }}
    </p>
    <p
      v-if="notice"
      class="mb-4 rounded border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700"
    >
      {{ notice }}
    </p>

    <p v-if="loading" class="text-sm text-gray-400">加载中…</p>

    <template v-else-if="workspace">
      <!-- 基本信息 -->
      <section class="mb-8 rounded-lg border border-gray-200 bg-white p-5">
        <h2 class="mb-4 text-sm font-medium text-gray-700">基本信息</h2>

        <div class="space-y-4">
          <div>
            <label class="mb-1 block text-xs text-gray-500" for="ws-name">空间名称</label>
            <input
              id="ws-name"
              v-model="nameDraft"
              type="text"
              :disabled="!isOwner"
              class="w-full rounded border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-50"
            />
          </div>

          <div>
            <label class="mb-1 block text-xs text-gray-500" for="ws-default-role">
              新文档默认权限
            </label>
            <select
              id="ws-default-role"
              v-model="defaultRoleDraft"
              :disabled="!isOwner"
              class="rounded border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-50"
            >
              <option value="view">只读</option>
              <option value="comment">可评论</option>
              <option value="edit">可编辑</option>
            </select>
            <p class="mt-1 text-xs text-gray-400">
              影响空间内"空间可见"文档的默认权限。私密文档不受此影响。
            </p>
          </div>
        </div>

        <button
          v-if="isOwner"
          type="button"
          class="mt-4 rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700"
          @click="saveBasic"
        >
          保存
        </button>
        <p v-else class="mt-4 text-xs text-gray-400">仅空间所有者可修改空间设置。</p>
      </section>

      <!-- 成员管理 -->
      <section class="rounded-lg border border-gray-200 bg-white p-5">
        <h2 class="mb-4 text-sm font-medium text-gray-700">成员</h2>

        <div v-if="canManageMembers" class="mb-4 flex gap-2">
          <input
            v-model="newMemberEmail"
            type="email"
            placeholder="按邮箱添加成员"
            class="min-w-0 flex-1 rounded border border-gray-300 px-3 py-2 text-sm"
          />
          <select
            v-model="newMemberRole"
            class="rounded border border-gray-300 px-2 py-2 text-sm"
          >
            <option value="admin">管理员</option>
            <option value="member">成员</option>
            <option value="viewer">只读</option>
          </select>
          <button
            type="button"
            class="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700"
            @click="addMember"
          >
            添加
          </button>
        </div>

        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-gray-200 text-left text-xs text-gray-500">
              <th class="py-2 font-normal">成员</th>
              <th class="w-32 py-2 font-normal">角色</th>
              <th class="w-20 py-2 font-normal" />
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="m in members"
              :key="m.userId"
              class="border-b border-gray-100"
              :data-member-id="m.userId"
            >
              <td class="py-2">
                <div class="text-gray-900">{{ m.displayName }}</div>
                <div class="text-xs text-gray-400">{{ m.email }}</div>
              </td>
              <td class="py-2">
                <select
                  v-if="roleEditable(m)"
                  class="rounded border border-gray-300 px-2 py-1 text-xs"
                  :value="m.role"
                  @change="changeRole(m, ($event.target as HTMLSelectElement).value)"
                >
                  <option value="admin">管理员</option>
                  <option value="member">成员</option>
                  <option value="viewer">只读</option>
                </select>
                <span v-else class="text-xs text-gray-600">
                  {{ m.role === 'owner' ? '所有者' : m.role }}
                </span>
              </td>
              <td class="py-2 text-right">
                <button
                  v-if="roleEditable(m)"
                  type="button"
                  class="rounded px-1.5 py-0.5 text-xs text-red-500 hover:bg-red-50"
                  @click="removeMember(m)"
                >
                  移除
                </button>
              </td>
            </tr>
          </tbody>
        </table>

        <p v-if="!canManageMembers" class="mt-3 text-xs text-gray-400">
          仅空间所有者或管理员可管理成员。
        </p>
      </section>
    </template>
  </div>
</template>
