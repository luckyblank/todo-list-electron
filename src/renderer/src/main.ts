import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './app/App.vue'
import MiniApp from './app/MiniApp.vue'
import './shared/theme/base.css'

createApp(window.location.hash === '#mini' ? MiniApp : App).use(createPinia()).mount('#app')
