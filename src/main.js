import { createApp } from 'vue'
import './style.css'
import App from './App.vue'

// 1. 引入 Element Plus 的样式 (虽然组件按需加载，但基础样式建议全局引入以免丢失)
import 'element-plus/dist/index.css'
import 'element-plus/theme-chalk/dark/css-vars.css'

// 2. 引入图标
import * as ElementPlusIconsVue from '@element-plus/icons-vue'

// 3. 引入 AutoAnimate
import { autoAnimatePlugin } from '@formkit/auto-animate/vue'

const app = createApp(App)

app.use(autoAnimatePlugin)

// 注册所有图标
for (const [key, component] of Object.entries(ElementPlusIconsVue)) {
  app.component(key, component)
}

app.mount('#app')