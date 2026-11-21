import { createApp } from 'vue'
import './style.css'
import App from './App.vue'

console.info(`MyShop Web ${import.meta.env.VITE_APP_BUILD_INFO}`)
createApp(App).mount('#app')
