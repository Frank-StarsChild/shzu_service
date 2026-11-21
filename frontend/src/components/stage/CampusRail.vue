<script setup lang="ts">
// STAGE W3：左侧一列校区题签（第 4.2 节）。只读 store、调动作；
// 第一项「全校」，后面是 packs.json 的六个校区。
import { computed, onMounted } from "vue";
import { useStageStore } from "@/stores/stage";

const store = useStageStore();
onMounted(() => {
  void store.loadCampuses();
});

/** 显示名：超过三个字且以「校区」结尾的去掉末尾（将军山校区 → 将军山） */
function shortName(name: string): string {
  return name.length > 3 && name.endsWith("校区") ? name.slice(0, -2) : name;
}

type RailItem = {
  id: string;
  name: string;
  sub: string;
  far: boolean;
  active: boolean;
};

const items = computed<RailItem[]>(() => {
  const list: RailItem[] = [
    {
      id: "ALL",
      name: "全校",
      sub: "六校区",
      far: false,
      active: store.mode === "home" && store.packId === "all",
    },
  ];
  for (const c of store.campuses) {
    list.push({
      id: c.id,
      name: shortName(c.name),
      sub: String(c.buildings),
      far: c.pack !== store.packId,
      active:
        (store.mode === "campus" && store.zoneId === c.id)
        || (store.mode === "home" && c.pack === store.packId && store.packId !== "all"),
    });
  }
  return list;
});

function onClick(id: string) {
  if (id === "ALL") {
    if (store.packId !== "all") void store.switchPack("all");
    else store.goHome();
    return;
  }
  void store.pickCampus(id);
}
</script>

<template>
  <nav class="stage-rail" data-testid="stage-rail" aria-label="校区">
    <button
      v-for="it in items"
      :key="it.id"
      type="button"
      class="stage-rail-item"
      :class="{ 'is-active': it.active, 'is-far': it.far }"
      :data-testid="`stage-rail-${it.id}`"
      @click="onClick(it.id)"
    >
      <span class="stage-rail-name">{{ it.name }}</span>
      <span class="stage-rail-sub">{{ it.sub }}</span>
    </button>
  </nav>
</template>

<style scoped>
/* 只在 .stage 之下生效（STAGE 规则 5）；题签：顶边 2px 金线、其余 1px 淡金线、
   底色近黑；选中边线变朱红；不在当前包的校区用虚线边框。 */
.stage .stage-rail {
  position: fixed;
  left: 26px;
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  flex-direction: column;
  gap: 8px;
  z-index: 4;
}
.stage .stage-rail-item {
  width: 40px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 7px;
  padding: 13px 0 9px;
  background: var(--st-glass);
  border: 1px solid var(--st-gold3);
  border-top: 2px solid var(--st-gold);
  cursor: pointer;
}
.stage .stage-rail-item:focus-visible {
  outline: 1px solid var(--st-gold2);
  outline-offset: 2px;
}
.stage .stage-rail-item.is-active {
  border-color: var(--st-red);
  border-top-color: var(--st-red);
}
.stage .stage-rail-item.is-far {
  border-style: dashed;
  border-top-style: dashed;
}
.stage .stage-rail-name {
  writing-mode: vertical-rl;
  font-family: var(--st-song);
  font-weight: 600;
  font-size: 15px;
  letter-spacing: 0.3em;
  color: var(--st-moon);
}
.stage .stage-rail-sub {
  font-family: var(--st-hei);
  font-size: 9.5px;
  letter-spacing: 0.16em;
  color: var(--st-gold2);
}
</style>
