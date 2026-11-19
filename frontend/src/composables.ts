import { ref, onMounted } from "vue";
import { useRouter } from "vue-router";

const ready = ref<any>(null);
let loadingStarted = false;

export function useKbMeta() {
  if (!ready.value && !loadingStarted) {
    loadingStarted = true;
    import("@/api/client").then(({ api }) => api.ready()).then((r) => { ready.value = r; }).catch(() => {});
  }
  return { ready };
}

export function useGo() {
  const router = useRouter();
  return {
    ask: (q: string) => router.push({ path: "/chat", query: { q } }),
    openWorkflow: (id: string) => router.push(`/workflows/${id}`),
    openEvidence: (id: string) => router.push(`/sources/${encodeURIComponent(id)}`),
  };
}

export function useNow() {
  const now = ref(new Date());
  onMounted(() => { now.value = new Date(); });
  return now;
}