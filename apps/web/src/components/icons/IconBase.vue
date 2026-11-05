<script setup lang="ts">
/**
 * 图标基座。
 *
 * 为什么不用图标库：需要的图标不到二十个，引一个包换来的是
 * 另一套 stroke 宽度、另一套 viewBox、另一份 tree-shake 配置。
 * 内联 SVG 的代价只是这一份 path 表，换来的是"全站线条粗细一致"。
 *
 * 统一规格：24×24 viewBox、stroke 1.75、round 端点，颜色继承 currentColor。
 */
withDefaults(
  defineProps<{
    /** 24×24 坐标系下的 path 列表。 */
    paths: readonly string[]
    /** 填充式图标（如实心圆点）用 true。 */
    filled?: boolean
    size?: number
  }>(),
  { filled: false, size: 16 },
)
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    :fill="filled ? 'currentColor' : 'none'"
    :stroke="filled ? 'none' : 'currentColor'"
    stroke-width="1.75"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <path v-for="(d, i) in paths" :key="i" :d="d" />
  </svg>
</template>
