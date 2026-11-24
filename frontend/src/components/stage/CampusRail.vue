<script setup lang="ts">
// STAGE W3：左侧一列校区题签（第 4.2 节）。只读 store、调动作；
// 第一项「全校」（packs.json 的 default），后面是 campuses 的六项。
// 判断只看三样：default、当前包的 zones、campuses[].pack（不按包名写分支）。
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
  /** 选中校区的 pack ≠ 当前包（campus 态下右侧显示「近看」） */
  showEnter: boolean;
};

const items = computed<RailItem[]>(() => {
  const isDefault = store.packId === store.default;
  const list: RailItem[] = [
    {
      id: "ALL",
      name: "全校",
      sub: "六校区",
      far: false,
      active: store.mode === "home" && isDefault,
      showEnter: false,
    },
  ];
  for (const c of store.campuses) {
    const selected = store.mode === "campus" && store.zoneId === c.id;
    list.push({
      id: c.id,
      name: shortName(c.name),
      sub: String(c.buildings),
      // 当前包的 zones 里没有的校区：虚线边框（不在眼前这块沙盘上）
      far: !store.campusOnPack(c.id),
      active:
        selected
        || (store.mode === "home" && !isDefault && c.pack === store.packId),
      showEnter: selected && c.pack !== store.packId,
    });
  }
  return list;
});

function onClick(id: string) {
  if (id === "ALL") {
    // 点「全校」：当前包不是默认包就换回去；否则回首页
    if (store.packId !== store.default) store.switchPack(store.default);
    else store.goHome();
    return;
  }
  void store.pickCampus(id);
}
</script>

<template>
  <nav class="stage-rail" data-testid="stage-rail" aria-label="校区">
    <div v-for="it in items" :key="it.id" class="stage-rail-wrap">
      <button
        type="button"
        class="stage-rail-item"
        :class="{ 'is-active': it.active, 'is-far': it.far }"
        :data-testid="`stage-rail-${it.id}`"
        @click="onClick(it.id)"
      >
        <span class="stage-rail-name">{{ it.name }}</span>
        <span class="stage-rail-sub">{{ it.sub }}</span>
      </button>
      <!-- 「近看」：campus 态且选中校区有自己的另一块沙盘时，出现在选中项右侧 -->
      <button
        v-if="it.showEnter"
        type="button"
        class="stage-rail-enter"
        data-testid="stage-rail-enter"
        @click.stop="store.enterCampus()"
      >近看</button>
    </div>
  </nav>
</template>

<style scoped>
/* 只在 .stage 之下生效（STAGE 规则 5）；题签：顶边 2px 金线、其余 1px 淡金线、
   底色近黑；选中边线变朱红；不在当前包的校区用虚线边框。 */
.stage .stage-rail {
  --rail-bottom: calc(var(--st-dock-bottom) + var(--st-compass-size) + 12px);
  position: fixed;
  left: var(--st-bot-edge);
  top: var(--st-rail-top);
  bottom: var(--rail-bottom);
  width: 84px;
  max-height: calc(100dvh - var(--st-rail-top) - var(--rail-bottom));
  height: max-content;
  margin-block: auto;
  padding: 3px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  align-items: flex-start;
  overflow: auto;
  scrollbar-width: none;
  pointer-events: none;
  z-index: 4;
}
.stage .stage-rail-wrap {
  position: relative;
  pointer-events: auto;
  flex: none;
}
.stage .stage-rail-item {
  width: 40px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 6px 0;
  background: var(--st-ov-bg);
  border: 1px solid var(--st-ov-gold-faint);
  border-top: 2px solid var(--st-ov-gold);
  box-shadow: var(--st-ov-shadow);
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
  line-height: 1.1;
  letter-spacing: 0.16em;
  color: var(--st-ov-fg);
}
.stage .stage-rail-sub {
  font-family: var(--st-hei);
  font-size: 9.5px;
  line-height: 1.2;
  letter-spacing: 0.16em;
  color: var(--st-ov-gold);
}
/* 「近看」小题签：选中项右侧，竖排、金边金字（第 4.2 节） */
.stage .stage-rail-enter {
  position: absolute;
  left: calc(100% + 8px);
  top: 50%;
  transform: translateY(-50%);
  padding: 12px 0 8px;
  background: var(--st-ov-bg);
  border: 1px solid var(--st-ov-gold-soft);
  box-shadow: var(--st-ov-shadow);
  cursor: pointer;
}
.stage .stage-rail-enter:focus-visible {
  outline: 1px solid var(--st-gold2);
  outline-offset: 2px;
}
.stage .stage-rail-enter {
  writing-mode: vertical-rl;
  font-family: var(--st-song);
  font-weight: 600;
  font-size: 13px;
  letter-spacing: 0.28em;
  color: var(--st-ov-gold);
}
@media (max-height: 850px) {
  .stage .stage-rail { gap: 4px; }
  .stage .stage-rail-item { gap: 2px; padding-block: 4px; }
  .stage .stage-rail-name { font-size: 13px; letter-spacing: 0.04em; }
}
@media (max-width: 900px) {
  .stage .stage-rail {
    left: 12px;
    right: 12px;
    bottom: auto;
    width: auto;
    height: var(--st-mobile-rail-height);
    max-height: none;
    margin: 0;
    flex-direction: row;
    pointer-events: auto;
  }
  .stage .stage-rail-wrap { display: flex; gap: 4px; }
  .stage .stage-rail-item {
    width: auto;
    padding: 4px 6px;
    justify-content: center;
  }
  .stage .stage-rail-name { writing-mode: horizontal-tb; font-size: 12px; letter-spacing: 0; }
  .stage .stage-rail-sub { display: none; }
  .stage .stage-rail-enter {
    position: static;
    transform: none;
    padding: 4px 6px;
    writing-mode: horizontal-tb;
    font-size: 12px;
    letter-spacing: 0;
  }
}
</style>
