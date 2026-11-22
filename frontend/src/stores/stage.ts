// STAGE W3（第 6.3 节）：舞台状态的唯一来源。组件只读状态、调动作；
// 镜头、片区高亮、换包由 StageCanvas 监听这里去做。
// 动作集：goHome / pickCampus / enterCampus / switchPack / setMeta / setTour / showAnswer / showBuilding
// （enterPlace 是 W10 的，到时候再往这个文件里加）。
//
// packs.json v3 的三条判断规则（STAGE 5.2，全部只看 zones / campuses[].pack / default，
// 不按包名写分支）：
//   - 一个校区在不在当前沙盘上：看当前包的 zones 里有没有它的 id；
//   - 一个校区自己的沙盘：campuses[].pack；
//   - 默认沙盘：default 字段。

import { defineStore } from "pinia";
import { watch } from "vue";
import { loadPackIndex, loadPlaces, type CampusZoneRef, type Pack, type Places } from "@/stage/packs";
import type { CampusMeta } from "@/campus3d/meta";
import type { Emblems } from "@/stage/emblems";

export type StageMode = "home" | "campus" | "answer" | "tour";

export type StagePlace = { buildingId: string; name: string } | null;
export type StageOtherPack = { packId: string; buildingId: string } | null;

export const useStageStore = defineStore("stage", {
  state: () => ({
    /** 当前沙盘（packs.json 里包的 id；初始即 packs.json 的 default） */
    packId: "all",
    mode: "home" as StageMode,
    zoneId: null as string | null,
    place: null as StagePlace,
    otherPack: null as StageOtherPack,
    /** 当前选中的服务板块（W9 才用） */
    board: null as string | null,
    /** W11：回答面板是否展开。只改显示状态：会话、request_id、生成进度、
     *  已展开引用与滚动位置都在收起时保留；用户新发问题时重新展开。 */
    answerOpen: true,
    /** W11：界面请求重置视角的序号（StageCanvas 监听后把镜头飞回当前状态的推荐机位） */
    resetViewSeq: 0,
    /** W8：进观景前的模式（退出时恢复） */
    tourPrev: null as StageMode | null,
    /** packs.json 的包表与 default（loadCampuses 后可用；加载前 default 取默认包名） */
    packs: [] as Pack[],
    default: "all",
    /** packs.json 的校区表（loadCampuses 后可用；pickCampus 会先自动加载） */
    campuses: [] as CampusZoneRef[],
    campusesLoaded: false,
    /** places.json（W5；showAnswer 会先自动加载） */
    places: null as Places | null,
    placesLoaded: false,
    /** ALIVE A1：24 学院院徽清单；加载失败保持 null，后面的卡看到 null 一律不画院徽 */
    emblems: null as Emblems | null,
    /** 当前选中的学院（显示本色的那一个）；goHome/pickCampus/switchPack 清成 null */
    collegeNo: null as number | null,
    /** 当前包的元数据：换包的那一刻（switchPack）清成 null，新的取回后由 StageCanvas 放进来 */
    meta: null as CampusMeta | null,
    /** 场景是否就绪（StageCanvas 同步进来；换包/加载中/出错为 false）。
     *  W10 的 enterPlace 与 W5 的 otherPack 钮等它变 true 再落楼。 */
    sceneReady: false,
    /** 每次 applyPlace（showAnswer/showBuilding）加一；换包后等待落楼时用它判断「作废」 */
    placeSeq: 0,
  }),
  getters: {
    /** 当前包（packs 表里 id === packId 的那项；未加载时为 null） */
    currentPack(state): Pack | null {
      return state.packs.find((p) => p.id === state.packId) ?? null;
    },
    /** 校区在当前沙盘上吗：当前包的 zones 里有没有它的 id */
    campusOnPack(state) {
      return (campusId: string): boolean => {
        const zones = state.packs.find((p) => p.id === state.packId)?.zones ?? [];
        return zones.includes(campusId);
      };
    },
    /** W10：这栋楼可以「近看」吗，可以的话是哪一块沙盘。规则从上到下：
     *  1. place 或 meta 为空 → null；
     *  2. 当前包不是默认包（已经在近看的沙盘里）→ null；
     *  3. 取楼的片区号，在 packs 里找一个不是默认包、zones 含这个片区号的包。
     *  不按楼号前缀猜、不查 campuses：附属医院（FY）和护士学校（HX）不是校区，
     *  但它们的楼在 nq 这块沙盘上，按 zones 才找得到。 */
    nearPack(state): string | null {
      if (state.place === null || state.meta === null) return null;
      if (state.packId !== state.default) return null;
      const zone = state.meta.buildings[state.place.buildingId]?.zone;
      if (!zone) return null;
      const pack = state.packs.find(
        (p) => p.id !== state.default && p.zones.includes(zone)
      );
      return pack?.id ?? null;
    },
  },
  actions: {
    /** 拉一次 packs.json（包表 + default + 校区表；同一 store 实例内只拉一次） */
    async loadCampuses() {
      if (this.campusesLoaded) return;
      const idx = await loadPackIndex();
      this.packs = idx.packs;
      this.default = idx.default;
      this.campuses = idx.campuses;
      this.campusesLoaded = true;
    },
    /** 拉一次 places.json（W5） */
    async loadPlacesData() {
      if (this.placesLoaded) return;
      this.places = await loadPlaces();
      this.placesLoaded = true;
    },
    /** StageCanvas 把当前包元数据取回后放进 store */
    setMeta(meta: CampusMeta | null) {
      this.meta = meta;
    },
    /** StageCanvas 同步场景就绪状态（ready 为 true；换包/加载中/出错为 false） */
    setSceneReady(on: boolean) {
      this.sceneReady = on;
    },
    /** W11：收起/展开右侧回答面板（不动校区、定位、对话与生成状态） */
    setAnswerOpen(open: boolean) {
      this.answerOpen = open;
    },
    /** W11：「重置视角」——只改镜头，不动校区选择、高亮与对话 */
    requestResetView() {
      this.resetViewSeq += 1;
    },
    goHome() {
      this.mode = "home";
      this.zoneId = null;
      this.place = null;
      this.otherPack = null;
      this.board = null; // W9
      this.collegeNo = null; // ALIVE 8.3
    },
    /** 换沙盘：packId 改掉、meta 清 null，其余同 goHome()。
     *  传进来的就是当前 packId 时只做 goHome()。 */
    switchPack(packId: string) {
      if (packId === this.packId) {
        this.goHome();
        return;
      }
      this.packId = packId;
      this.meta = null;
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
    /** 点一个校区，从上到下命中第一条（W3 卡第 2 条）：
     *  1. campus 态再点同一校区：取消（goHome）
     *  2. 当前包的 zones 里有这个校区：进 campus 态
     *  3. 否则：换到这个校区自己的包（switchPack；换完停在 home，不直接进 campus） */
    async pickCampus(campusId: string) {
      await this.loadCampuses();
      const c = this.campuses.find((x) => x.id === campusId);
      if (!c) return;
      if (this.mode === "campus" && this.zoneId === campusId) {
        this.goHome();
        return;
      }
      if (this.campusOnPack(campusId)) {
        this.mode = "campus";
        this.zoneId = campusId;
        this.place = null;
        this.otherPack = null;
        this.board = null; // W9
        this.collegeNo = null; // ALIVE 8.3
        return;
      }
      this.switchPack(c.pack);
    },
    /** 「近看」：只在 campus 态有效——换成选中校区自己的包（switchPack；换完停在 home） */
    async enterCampus() {
      if (this.mode !== "campus") return;
      await this.loadCampuses();
      const c = this.campuses.find((x) => x.id === this.zoneId);
      if (!c) return;
      this.switchPack(c.pack);
    },
    /** W5：回答落到哪栋楼（buildingId 为 null 时只复位）。
     *  W9：新发问题时把 board 一并清掉（面板从板块面板换回回答面板）。
     *  楼在当前沙盘 → answer 态；在另一个沙盘 → otherPack（面板显示换包钮，不自动切）；
     *  packOf 里没有的楼（只有测试入口会传）当作当前沙盘。 */
    async showAnswer(buildingId: string | null) {
      this.board = null; // W9
      await this.applyPlace(buildingId);
    },
    /** W9：效果同 showAnswer，但不关联回答、也不清 board（学院/板块面板的入口用）。 */
    async showBuilding(buildingId: string) {
      await this.applyPlace(buildingId);
    },
    /** ALIVE A1：选中一个学院——设 collegeNo，并把镜头落到它的第一栋在当前沙盘上的楼。 */
    async showCollege(no: number) {
      this.collegeNo = no;
      const college = this.emblems?.colleges.find((c) => c.no === no);
      if (!college) return;
      const bid = college.buildingIds.find((id) => !!this.meta?.buildings[id]);
      if (bid) await this.showBuilding(bid);
    },
    /** W10：在回答里「近看」——换成这栋楼所在校区自己的沙盘，等它准备好再落回这栋楼。
     *  nearPack 为 null 时什么都不做。 */
    async enterPlace() {
      const near = this.nearPack;
      if (near === null) return;
      const bid = this.place?.buildingId;
      if (!bid) return;
      const seq = this.placeSeq;
      this.switchPack(near);
      await this.waitPackThenShow(near, bid, seq);
    },
    /** W5/W10 共用：换沙盘后等场景就绪，再落到那栋楼上。
     *  等待条件是「目标包的元数据已放进来 且 场景 就绪 且 还在这个包上」——
     *  switchPack 会同步把 meta 清成 null，所以旧场景残留的 ready 不可能抢跑成「新沙盘就绪」
     *  （卡常见错误第 1 条：showAnswer 调早了会被 meta 为 null 复位掉）。
     *  等待期间用户又问了新的问题（placeSeq 变了）或又换了沙盘（packId 变了）：
     *  记下的楼号作废，不再 showAnswer。 */
    async waitPackThenShow(packId: string, buildingId: string, seq?: number) {
      const mark = seq ?? this.placeSeq;
      // 注意：immediate 回调会同步执行，stop 必须先声明（let）再赋值——
      // 写成 const 会在回调里踩到暂时性死区（真机 8300 实测发现过 ReferenceError）。
      let stop: (() => void) | null = null;
      await new Promise<void>((resolve) => {
        const ok = () =>
          this.sceneReady
          && this.packId === packId
          && this.meta !== null
          && this.meta.pack?.id === packId;
        stop = watch(
          ok,
          (ready) => {
            if (!ready) return;
            const off = stop;
            stop = null;
            off?.();
            resolve();
          },
          { immediate: true }
        );
      });
      if (this.packId !== packId || this.placeSeq !== mark) return;
      await this.showAnswer(buildingId);
    },
    /** showAnswer / showBuilding 共用的落楼逻辑（W5 卡第 3 条）。
     *  「在不在当前沙盘上」只看 meta.buildings，不拿 packOf 和 packId 比：
     *  在中区自己的沙盘里，中区的楼 packOf 写的是 all，但它就在眼前。 */
    async applyPlace(buildingId: string | null) {
      this.placeSeq += 1;
      // buildingId 为空；或 meta 为 null（正在换沙盘）：复位，answer 态则回 home
      if (buildingId === null || buildingId === "" || this.meta === null) {
        this.place = null;
        this.otherPack = null;
        if (this.mode === "answer") this.mode = "home";
        return;
      }
      // 楼就在当前沙盘上 → answer 态
      const b = this.meta.buildings[buildingId];
      if (b) {
        const name = b.name || buildingId;
        this.mode = "answer";
        this.zoneId = null;
        this.otherPack = null;
        this.place = { buildingId, name };
        return;
      }
      // 不在：换包线索；packOf 里也没有这个楼号时按复位处理
      await this.loadPlacesData();
      const packOf = this.places?.packOf[buildingId];
      if (packOf === undefined) {
        this.place = null;
        this.otherPack = null;
        if (this.mode === "answer") this.mode = "home";
        return;
      }
      this.otherPack = { packId: packOf, buildingId };
      this.place = null;
      if (this.mode === "answer") this.mode = "home";
    },
  },
});
