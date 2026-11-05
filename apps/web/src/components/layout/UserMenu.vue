<script setup lang="ts">
/**
 * 右上角用户菜单：显示名首字母做头像，菜单里放设置与登出。
 *
 * 头像不引图片上传——1.0 没有这个需求，用首字母 + 稳定色相足够区分人。
 */
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useSessionStore } from '@/stores/session.js'
import { AppMenu, type MenuItem } from '@/components/ui/index.js'

const session = useSessionStore()
const router = useRouter()

const initial = computed(() => (session.user?.displayName ?? '?').trim().slice(0, 1).toUpperCase())

/** 由名字算出稳定色相：同一个人每次登录颜色一致，不需要存字段。 */
const hue = computed(() => {
  const name = session.user?.displayName ?? ''
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360
  return h
})

async function onSelect(key: string): Promise<void> {
  if (key === 'profile') {
    await router.push({ name: 'account' })
    return
  }
  await session.logout()
  await router.push({ name: 'login' })
}

const items = computed<MenuItem[]>(() => [
  { key: 'profile', label: '账号设置', icon: 'settings' },
  { key: 'logout', label: '退出登录', icon: 'logout', danger: true, separated: true },
])
</script>

<template>
  <AppMenu :items="items" @select="onSelect">
    <template #trigger>
      <button
        type="button"
        class="rounded-full focus-ring"
        :title="session.user?.displayName"
        :aria-label="`账号菜单：${session.user?.displayName ?? ''}`"
      >
        <span
          class="flex h-7 w-7 items-center justify-center rounded-full text-[11.5px] font-semibold text-white select-none"
          :style="{ backgroundColor: `hsl(${hue} 42% 46%)` }"
        >
          {{ initial }}
        </span>
      </button>
    </template>
  </AppMenu>
</template>
