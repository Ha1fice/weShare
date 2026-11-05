<script setup lang="ts">
/**
 * 根组件。
 *
 * 只做两件事：渲染当前路由、挂全局 Toast。
 * 外壳（顶栏等）在页面层各自组装——因为登录页、首页、工作区
 * 需要的顶栏并不一样，硬塞进一个统一 Shell 会塞满 v-if。
 */
import { RouterView } from 'vue-router'
import AppToast from '@/components/ui/AppToast.vue'
</script>

<template>
  <div class="h-screen w-screen overflow-hidden bg-canvas font-sans text-ink antialiased">
    <RouterView />
    <AppToast />
  </div>
</template>
