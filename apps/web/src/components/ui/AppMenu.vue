<script setup lang="ts">
/**
 * 下拉菜单。
 *
 * reka-ui 的 DropdownMenu 负责键盘导航、type-ahead、焦点归还。
 * 这里统一了外观与"危险项"的表达方式（separator 之后的红字）。
 */
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuRoot,
  DropdownMenuTrigger,
} from 'reka-ui'
import AppIcon from '../icons/AppIcon.vue'
import type { IconName } from '../icons/index.js'

export interface MenuItem {
  key: string
  label: string
  icon?: IconName
  danger?: boolean
  disabled?: boolean
  /** 在该项之前画一条分隔线。 */
  separated?: boolean
}

defineProps<{ items: MenuItem[] }>()
const emit = defineEmits<{ select: [key: string] }>()
</script>

<template>
  <DropdownMenuRoot>
    <DropdownMenuTrigger as-child>
      <slot name="trigger" />
    </DropdownMenuTrigger>
    <DropdownMenuPortal>
      <DropdownMenuContent
        :side-offset="4"
        align="end"
        class="z-50 min-w-[152px] rounded-md border border-line bg-surface p-1 shadow-pop outline-none"
      >
        <template v-for="item in items" :key="item.key">
          <div v-if="item.separated" class="my-1 h-px bg-line" />
          <DropdownMenuItem
            :disabled="item.disabled"
            :class="[
              'flex cursor-pointer select-none items-center gap-2 rounded px-2 py-[5px] text-[12.5px] outline-none',
              'data-[highlighted]:bg-subtle data-[disabled]:cursor-not-allowed data-[disabled]:opacity-40',
              item.danger ? 'text-danger data-[highlighted]:bg-danger-soft' : 'text-ink',
            ]"
            @select="emit('select', item.key)"
          >
            <AppIcon v-if="item.icon" :name="item.icon" :size="13" class="shrink-0" />
            <span class="truncate">{{ item.label }}</span>
          </DropdownMenuItem>
        </template>
      </DropdownMenuContent>
    </DropdownMenuPortal>
  </DropdownMenuRoot>
</template>
