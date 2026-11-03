import { createApp } from 'vue'
import { createPinia } from 'pinia'
import 'virtual:uno.css'
import App from './App.vue'
import { router } from './app/router'

createApp(App).use(createPinia()).use(router).mount('#app')
