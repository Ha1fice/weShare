<script setup lang="ts">
/**
 * 编辑器工具栏。
 *
 * 用 `editor.isActive(...)` 反映真实状态——不是维护一份"我点了哪个按钮"的
 * 影子状态。影子状态会在用户用快捷键或在别处改格式后立刻说谎。
 *
 * 窄屏时分组折叠：先保证正文宽度，工具栏可以横向滚动。
 */
import { computed, ref } from 'vue'
import type { Editor } from '@tiptap/vue-3'
import { isSafeLinkHref } from '@weshare/doc-schema'
import {
  AppButton,
  AppDialog,
  AppField,
  AppInput,
} from '@/components/ui/index.js'
import AppIcon from '@/components/icons/AppIcon.vue'
import type { IconName } from '@/components/icons/index.js'

const props = defineProps<{ editor: Editor; editable: boolean }>()

interface Tool {
  key: string
  icon: IconName
  label: string
  shortcut?: string
  active: () => boolean
  run: () => void
  disabled?: () => boolean
}

const tools = computed<Tool[]>(() => {
  const e = props.editor
  const chain = () => e.chain().focus()
  return [
    {
      key: 'bold',
      icon: 'bold',
      label: '加粗',
      shortcut: 'Ctrl+B',
      active: () => e.isActive('bold'),
      run: () => chain().toggleBold().run(),
    },
    {
      key: 'italic',
      icon: 'italic',
      label: '斜体',
      shortcut: 'Ctrl+I',
      active: () => e.isActive('italic'),
      run: () => chain().toggleItalic().run(),
    },
    {
      key: 'underline',
      icon: 'underline',
      label: '下划线',
      shortcut: 'Ctrl+U',
      active: () => e.isActive('underline'),
      run: () => chain().toggleUnderline().run(),
    },
    {
      key: 'strike',
      icon: 'strike',
      label: '删除线',
      active: () => e.isActive('strike'),
      run: () => chain().toggleStrike().run(),
    },
    {
      key: 'code',
      icon: 'code',
      label: '行内代码',
      active: () => e.isActive('code'),
      run: () => chain().toggleCode().run(),
    },
    {
      key: 'h1',
      icon: 'heading',
      label: '标题 1',
      active: () => e.isActive('heading', { level: 1 }),
      run: () => chain().toggleHeading({ level: 1 }).run(),
    },
    {
      key: 'h2',
      icon: 'heading',
      label: '标题 2',
      active: () => e.isActive('heading', { level: 2 }),
      run: () => chain().toggleHeading({ level: 2 }).run(),
    },
    {
      key: 'bullet',
      icon: 'list',
      label: '无序列表',
      active: () => e.isActive('bulletList'),
      run: () => chain().toggleBulletList().run(),
    },
    {
      key: 'ordered',
      icon: 'list-ordered',
      label: '有序列表',
      active: () => e.isActive('orderedList'),
      run: () => chain().toggleOrderedList().run(),
    },
    {
      key: 'quote',
      icon: 'quote',
      label: '引用',
      active: () => e.isActive('blockquote'),
      run: () => chain().toggleBlockquote().run(),
    },
    {
      key: 'link',
      icon: 'link',
      label: '链接',
      active: () => e.isActive('link'),
      run: () => {
        const prev = (e.getAttributes('link').href as string | undefined) ?? ''
        // 不用 window.prompt：这里本就只有"输入一个 URL"这一个动作，
        // 但保持与全站一致——弹窗统一由 AppDialog 承担，见下方 linkDialog
        openLinkDialog(prev)
      },
    },
  ]
})

// ------------------------------------------------------------ 链接弹窗
const linkDialog = ref<{ open: boolean; href: string }>({ open: false, href: '' })

function openLinkDialog(current: string): void {
  linkDialog.value = { open: true, href: current }
}

const linkInvalid = computed(() => {
  const v = linkDialog.value.href.trim()
  if (!v) return false // 空 = 取消链接，允许
  return !isSafeLinkHref(v)
})

function applyLink(): void {
  const href = linkDialog.value.href.trim()
  if (href && !isSafeLinkHref(href)) return
  const chain = props.editor.chain().focus().extendMarkRange('link')
  if (!href) chain.unsetLink().run()
  else chain.setLink({ href }).run()
  linkDialog.value.open = false
}

const canUndo = computed(() => props.editor.can().undo())
const canRedo = computed(() => props.editor.can().redo())
</script>

<template>
  <div
    class="flex h-9 shrink-0 items-center gap-0.5 overflow-x-auto border-b border-line px-2 scroll-thin"
    role="toolbar"
    aria-label="格式工具栏"
  >
    <AppButton
      size="sm"
      variant="ghost"
      square
      icon="undo"
      aria-label="撤销"
      :disabled="!editable || !canUndo"
      @click="editor.chain().focus().undo().run()"
    />
    <AppButton
      size="sm"
      variant="ghost"
      square
      icon="redo"
      aria-label="重做"
      :disabled="!editable || !canRedo"
      @click="editor.chain().focus().redo().run()"
    />

    <span class="mx-1 h-4 w-px shrink-0 bg-line" aria-hidden="true" />

    <template v-for="(tool, i) in tools" :key="tool.key">
      <span
        v-if="i === 5 || i === 8 || i === 10"
        class="mx-1 h-4 w-px shrink-0 bg-line"
        aria-hidden="true"
      />
      <button
        type="button"
        :title="tool.shortcut ? `${tool.label}（${tool.shortcut}）` : tool.label"
        :aria-label="tool.label"
        :aria-pressed="tool.active()"
        :disabled="!editable"
        :class="[
          'flex h-6 w-6 shrink-0 items-center justify-center rounded transition-colors focus-ring',
          'disabled:cursor-not-allowed disabled:opacity-40',
          tool.active()
            ? 'bg-brand-50 text-brand-700'
            : 'text-muted hover:bg-subtle hover:text-ink',
        ]"
        @click="tool.run()"
      >
        <AppIcon :name="tool.icon" :size="14" />
      </button>
    </template>
  </div>

  <AppDialog
    v-model:open="linkDialog.open"
    title="插入链接"
    description="留空并确定可移除链接。只允许 http / https / mailto 与站内路径。"
    confirm-text="应用"
    :confirm-disabled="linkInvalid"
    @confirm="applyLink"
  >
    <AppField
      label="地址"
      html-for="link-href"
      :error="linkInvalid ? '协议不被允许（禁止 javascript: 与 data:）' : ''"
    >
      <AppInput
        id="link-href"
        v-model="linkDialog.href"
        placeholder="https://example.com"
        @keyup.enter="applyLink"
      />
    </AppField>
  </AppDialog>
</template>
