import { createRouter, createWebHistory } from "vue-router";

const routes = [
  // STAGE W6：/ 由 EntryView 按设备/视口/偏好决定渲染舞台还是普通版；
  // /classic 是普通版首页的固定地址（顶栏「校园」回到舞台，舞台「普通版」来这里）。
  { path: "/", name: "home", component: () => import("@/views/EntryView.vue"), meta: { index: "01", title: "服务入口" } },
  { path: "/classic", name: "classic", component: () => import("@/views/HomeView.vue"), meta: { index: "01", title: "服务入口" } },
  { path: "/chat", name: "chat", component: () => import("@/views/ChatView.vue"), meta: { index: "02", title: "校园对话" } },
  { path: "/services", name: "services", component: () => import("@/views/ServicesView.vue"), meta: { index: "03", title: "服务目录" } },
  { path: "/workflows/:flowId", name: "workflow", component: () => import("@/views/WorkflowView.vue"), meta: { index: "04", title: "办事向导" } },
  { path: "/sources/:evidenceId", name: "source", component: () => import("@/views/SourceView.vue"), meta: { index: "05", title: "证据详情" } },
  { path: "/unavailable", name: "unavailable", component: () => import("@/views/UnavailableView.vue"), meta: { index: "—", title: "服务状态" } },
  { path: "/stage", name: "stage", component: () => import("@/views/StageView.vue"), meta: { index: "—", title: "校园", stage: true } },
  { path: "/:pathMatch(.*)*", redirect: "/" },
];

export const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior() {
    return { top: 0 };
  },
});

router.afterEach((to) => {
  document.title = `${to.meta.title ?? ""} · 石大智多星`;
});