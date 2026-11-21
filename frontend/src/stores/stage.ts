// STAGE W3（第 6.3 节）：舞台状态的唯一来源。组件只读状态、调动作；
// 镜头、片区高亮、换包由 StageCanvas 监听这里去做。
// 本张卡实现 goHome / pickCampus / switchPack 三个动作；showAnswer、setTour、
// showBuilding 是后面几张卡的，到时候再往这个文件里加。

import { defineStore } from "pinia";
import { loadPackIndex, loadPlaces, type CampusZoneRef, type Places } from "@/stage/packs";
import type { CampusMeta } from "@/campus3d/meta";

export type StageMode = "home" | "campus" | "answer" | "tour";

export type StagePlace = { buildingId: string; name: string } | null;
export type StageOtherPack = { packId: string; buildingId: string } | null;

export const useStageStore = defineStore("stage", {
  state: () => ({
    /** 当前沙盘（packs.json 里包的 id；初始值即 default 包） */
    packId: "all",
    mode: "home" as StageMode,
    zoneId: null as string | null,
    place: null as StagePlace,
    otherPack: null as StageOtherPack,
    /** 当前选中的服务板块（W9 才用） */
    board: null as string | null,
    /** W8：进观景前的模式（退出时恢复） */
    tourPrev: null as StageMode | null,
    /** packs.json 的校区表（loadCampuses 后可用；pickCampus 会先自动加载） */
    campuses: [] as CampusZoneRef[],
    campusesLoaded: false,
    /** places.json（W5；showAnswer 会先自动加载） */
    places: null as Places | null,
    placesLoaded: false,
    /** 当前包的元数据（StageCanvas 同步进来；showAnswer 取楼名用） */
    packMeta: null as CampusMeta | null,
  }),
  actions: {
    /** 拉一次 packs.json（同一 store 实例内只拉一次） */
    async loadCampuses() {
      if (this.campusesLoaded) return;
      const idx = await loadPackIndex();
      this.campuses = idx.campuses;
      this.campusesLoaded = true;
    },
    /** 拉一次 places.json（W5） */
    async loadPlacesData() {
      if (this.placesLoaded) return;
      this.places = await loadPlaces();
      this.placesLoaded = true;
    },
    /** StageCanvas 把当前包元数据同步进来（W5：showAnswer 取楼名） */
    setPackMeta(meta: CampusMeta | null) {
      this.packMeta = meta;
    },
    goHome() {
      this.mode = "home";
      this.zoneId = null;
      this.place = null;
      this.otherPack = null;
      this.board = null; // W9
    },
    /** 换沙盘：packId 改掉，其余同 goHome()（换包那一下先回首页） */
    async switchPack(packId: string) {
      this.packId = packId;
      this.goHome();
    },
    /** W8：观景。开：记下原来的 mode，置为 tour；关：恢复。
     *  镜头的进入/退出由 StageCanvas 调 scene.setTour 处理。 */
    setTour(on: boolean) {
      if (on) {
        if (this.mode === "tour") return;
        this.tourPrev = this.mode;
        this.mode = "tour";
      } else {
        if (this.mode !== "tour") return;
        this.mode = this.tourPrev ?? "home";
        this.tourPrev = null;
      }
    },
    /** 点一个校区：同包进入 campus 态；异包先换成它的包（place/otherPack 一并清掉） */
    async pickCampus(campusId: string) {
      await this.loadCampuses();
      const c = this.campuses.find((x) => x.id === campusId);
      if (!c) return;
      if (c.pack === this.packId) {
        this.mode = "campus";
        this.zoneId = campusId;
        this.place = null;
        this.otherPack = null;
        this.board = null; // W9
      } else {
        await this.switchPack(c.pack);
      }
    },
    /** W5：回答落到哪栋楼（buildingId 为 null 时只复位）。
     *  W9：新发问题时把 board 一并清掉（面板从板块面板换回回答面板）。
     *  楼在当前沙盘 → answer 态；在另一个沙盘 → otherPack（面板显示换包钮，不自动切）；
     *  packOf 里没有的楼（只有测试入口会传）当作当前沙盘。
     */
    async showAnswer(buildingId: string | null) {
      this.board = null; // W9
      await this.applyPlace(buildingId);
    },
    /** W9：效果同 showAnswer，但不关联回答、也不清 board（学院/板块面板的入口用）。 */
    async showBuilding(buildingId: string) {
      await this.applyPlace(buildingId);
    },
    /** showAnswer / showBuilding 共用的落楼逻辑 */
    async applyPlace(buildingId: string | null) {
      if (buildingId === null || buildingId === "") {
        this.place = null;
        this.otherPack = null;
        if (this.mode === "answer") this.mode = "home";
        return;
      }
      await this.loadPlacesData();
      const packOf = this.places?.packOf[buildingId] ?? this.packId;
      if (packOf === this.packId) {
        const name = this.packMeta?.buildings[buildingId]?.name ?? buildingId;
        this.mode = "answer";
        this.zoneId = null;
        this.otherPack = null;
        this.place = { buildingId, name };
      } else {
        this.otherPack = { packId: packOf, buildingId };
        this.place = null;
        if (this.mode === "answer") this.mode = "home";
      }
    },
  },
});
