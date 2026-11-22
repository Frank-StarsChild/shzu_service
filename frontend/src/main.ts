import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import { router } from "./router";
import { useThemeStore } from "./stores/theme";
import "./styles/theme.css";
import "./styles/swiss.css";

const pinia = createPinia();
const app = createApp(App).use(pinia).use(router);

// 首屏挂载前恢复主题（index.html 的预置脚本已写好 data-theme，这里读取存储并接管
// 后续的系统外观监听）；apply() 幂等，不会引起二次闪变。
useThemeStore(pinia).init();

app.mount("#app");
