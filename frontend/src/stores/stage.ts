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
import { collegeForPlace, type Emblems, type Mention } from "@/stage/emblems";
import { IDLE_TRACE, type Trace } from "@/stage/trace";
import type { PlaceCandidate } from "@/stage/places";
import { useChatStore } from "@/stores/chat";

/** 最后一条有正文的回答段落（A3：同一栋楼有多个学院时，按回答里的学院名判定） */
function lastAnswerTexts(): string[] {
  const chat = useChatStore();
  for (let i = chat.turns.length - 1; i >= 0; i--) {
    const t = chat.turns[i];
    if (t.role !== "assistant") continue;
    const blocks = t.response?.answer?.blocks;
    if (blocks && blocks.length > 0) return blocks.map((b) => b.text).filter((s) => !!s);
  }
  return [];
}

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
    /** ALIVE A9：本次观景的转速（null = 用 meta.look.tour.degPerSec） */
    tourDegPerSec: null as number | null,
    /** ALIVE A9：这次观景是不是「空闲自动进入」（不显示退出钮、界面不隐去） */
    idleTour: false,
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
    /** 当前镜头停靠点（scene 每帧写入；比例尺取校准线的键，必须走响应式路径） */
    sceneStop: "home",
    /** ALIVE A5：智多星在想的回放状态（读题/翻查/核证/作答） */
    trace: { ...IDLE_TRACE } as Trace,
    /** ALIVE A4：二十四院罗盘是否展开、指着哪个学院 */
    dialOpen: false,
    dialHover: null as number | null,
    /** ALIVE A9：点灯序号（每次开场播完 / 测试入口加一；组件看到 >0 才点亮） */
    lightSeq: 0,
    /** ALIVE A8：打字预判命中的地点（只影响灯牌与虚线圈，不碰镜头与外壳） */
    mention: null as Mention | null,
    /** 每次 applyPlace（showAnswer/showBuilding）加一；换包后等待落楼时用它判断「作废」 */
    placeSeq: 0,
    /** 每次 beginTurn（新一轮提问）加一：换包等待落楼时用户开了新一问 → 作废 */
    turnSeq: 0,
    /** 本轮回答关联的目标楼（带 request_id）：右侧「办理地点」与红线只认它，
     *  不直接看 place——那可能是用户早就在看的楼。 */
    answerLink: null as { requestId: string; buildingId: string | null } | null,
    /** 本轮的手动定位候选（offer）：右侧显示「在沙盘查看」，点击才动镜头 */
    placeOffer: null as { requestId: string; candidates: PlaceCandidate[]; text: string | null } | null,
    /** 用户主动改变视角的序号（选校区/换沙盘/选楼/重置视角/落楼）：
     *  等待回答期间变过就放弃自动定位，改给手动入口 */
    viewSeq: 0,
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
    /** 镜头停靠点变化（只在真正变化时写，避免每帧触发响应式更新） */
    setSceneStop(stop: string) {
      if (stop && stop !== this.sceneStop) this.sceneStop = stop;
    },
    /** ALIVE A5：合并更新回放阶段（组件只读 trace） */
    setTrace(patch: Partial<Trace>) {
      this.trace = { ...this.trace, ...patch };
    },
    /** ALIVE A4：打开罗盘（观景中与院徽未载入时不响应） */
    openDial() {
      if (this.mode === "tour" || !this.emblems) return;
      this.dialOpen = true;
    },
    /** ALIVE A4：收起罗盘，同时清掉指着的院徽 */
    closeDial() {
      this.dialOpen = false;
      this.dialHover = null;
    },
    /** ALIVE A4：指着一个院徽（no 为 null 时清掉） */
    hoverDial(no: number | null) {
      this.dialHover = no;
    },
    /** ALIVE A9：点灯（开场播完那一刻；组件按距离由近到远依次亮起） */
    startLights() {
      this.lightSeq += 1;
    },
    /** ALIVE A8：设置/清空打字预判 */
    setMention(m: Mention | null) {
      this.mention = m;
    },
    /** W11：收起/展开右侧回答面板（不动校区、定位、对话与生成状态） */
    setAnswerOpen(open: boolean) {
      this.answerOpen = open;
    },
    /** W11：「重置视角」——只改镜头，不动校区选择、高亮与对话 */
    requestResetView() {
      this.viewSeq += 1;
      this.resetViewSeq += 1;
    },
    /** 新一轮开始：清本轮的办理地点关联与候选，不动 pack/mode/zone/已选楼与镜头 */
    beginTurn(requestId: string) {
      this.turnSeq += 1; // 「近看」等待落楼时据此判断用户是否已开始新的一问
      this.answerLink = { requestId, buildingId: null };
      this.placeOffer = null;
      this.board = null; // W9：板块面板换回回答面板
    },
    /** auto 定位成功后记下「本轮答案对应哪栋楼」 */
    setAnswerLink(requestId: string, buildingId: string | null) {
      this.answerLink = requestId ? { requestId, buildingId } : null;
    },
    /** offer：本轮可以手动定位的候选（不自动动镜头） */
    setPlaceOffer(offer: { requestId: string; candidates: PlaceCandidate[]; text: string | null } | null) {
      this.placeOffer = offer;
    },
    /** 点候选才动镜头；静态舞台/未就绪时只保留文字，不进入等不到 3D 就绪的状态 */
    async choosePlaceTarget(buildingId: string) {
      if (!this.sceneReady || this.meta === null) return false;
      if (this.answerLink) this.answerLink = { ...this.answerLink, buildingId };
      if (this.meta.buildings[buildingId]) {
        await this.showAnswer(buildingId);
        return true;
      }
      await this.loadPlacesData();
      const pack = this.places?.packOf[buildingId];
      if (!pack) return false;
      const seq = this.placeSeq;
      const turn = this.turnSeq;
      this.switchPack(pack);
      await this.waitPackThenShow(pack, buildingId, seq, turn);
      return true;
    },
    goHome() {
      this.closeDial(); // ALIVE A4
      this.idleTour = false;
      this.mention = null; // ALIVE A8
      this.viewSeq += 1;
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
      this.closeDial(); // ALIVE A4
      this.mention = null; // ALIVE A8
      if (packId === this.packId) {
        this.goHome();
        return;
      }
      this.packId = packId;
      this.meta = null;
      this.trace = { ...IDLE_TRACE };
      this.viewSeq += 1;
      this.goHome();
    },
    /** W8：观景。开：记下原来的 mode，置为 tour；关：恢复。
     *  镜头的进入/退出由 StageCanvas 调 scene.setTour 处理。 */
    setTour(on: boolean, degPerSec?: number) {
      if (on) {
        if (this.mode === "tour") return;
        this.closeDial(); // ALIVE A4
        this.tourPrev = this.mode;
        this.mode = "tour";
        this.tourDegPerSec = degPerSec ?? null;
      } else {
        if (this.mode !== "tour") return;
        this.mode = this.tourPrev ?? "home";
        this.tourPrev = null;
        this.tourDegPerSec = null;
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
        this.closeDial(); // ALIVE A4
        this.viewSeq += 1;
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
     *  ALIVE A3：落到楼上时按「楼 + 最后一条回答的正文」定 collegeNo（同楼多学院靠文字区分）；
     *  showCollege(no) 走 showBuilding，不经过这里，所以不会被覆盖。 */
    async showAnswer(buildingId: string | null) {
      this.board = null; // W9
      await this.applyPlace(buildingId);
      const bid = this.place?.buildingId;
      if (this.mode === "answer" && bid) {
        this.collegeNo = this.emblems
          ? collegeForPlace(this.emblems, bid, lastAnswerTexts())?.no ?? null
          : null;
      } else if (!bid) {
        // 复位（无楼 / 换到了另一个沙盘）：学院选择一起清掉
        this.collegeNo = null;
      }
    },
    /** W9：效果同 showAnswer，但不关联回答、也不清 board（学院/板块面板的入口用）。 */
    async showBuilding(buildingId: string) {
      await this.applyPlace(buildingId);
    },
    /** ALIVE A1：选中一个学院——设 collegeNo，并把镜头落到它的第一栋在当前沙盘上的楼。
     *  可选 buildingId：面板行已经选好楼时直接用它（同楼两所学院靠它区分）；
     *  只认这所学院在当前沙盘上的候选楼，别的楼号会被忽略。 */
    async showCollege(no: number, buildingId?: string) {
      this.collegeNo = no;
      const meta = this.meta;
      const college = this.emblems?.colleges.find((c) => c.no === no) ?? null;
      if (!college) {
        // 院徽清单没加载出来时，面板行已经选好了楼：仍按行定位（只少了院徽）
        if (buildingId && meta?.buildings[buildingId]) await this.showBuilding(buildingId);
        return;
      }
      if (buildingId && meta?.buildings[buildingId]) {
        const candidates = new Set<string>([
          ...(college.buildingIds ?? []),
          ...((meta.colleges ?? []).find((c) => c.no === no)?.buildingIds ?? []),
        ]);
        if (candidates.has(buildingId)) {
          await this.showBuilding(buildingId);
          return;
        }
      }
      const bid = college.buildingIds.find((id) => !!meta?.buildings[id]);
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
      const turn = this.turnSeq;
      this.switchPack(near);
      await this.waitPackThenShow(near, bid, seq, turn);
    },
    /** W5/W10 共用：换沙盘后等场景就绪，再落到那栋楼上。
     *  等待条件是「目标包的元数据已放进来 且 场景 就绪 且 还在这个包上」——
     *  switchPack 会同步把 meta 清成 null，所以旧场景残留的 ready 不可能抢跑成「新沙盘就绪」
     *  （卡常见错误第 1 条：showAnswer 调早了会被 meta 为 null 复位掉）。
     *  等待期间用户又问了新的问题（turnSeq 变了）、重新定位过（placeSeq 变了）
     *  或又换了沙盘（packId 变了）：记下的楼号作废，不再 showAnswer。 */
    async waitPackThenShow(packId: string, buildingId: string, seq?: number, turnMark?: number) {
      const mark = seq ?? this.placeSeq;
      const turn = turnMark ?? this.turnSeq;
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
      if (this.packId !== packId || this.placeSeq !== mark || this.turnSeq !== turn) return;
      await this.showAnswer(buildingId);
    },
    /** showAnswer / showBuilding 共用的落楼逻辑（W5 卡第 3 条）。
     *  「在不在当前沙盘上」只看 meta.buildings，不拿 packOf 和 packId 比：
     *  在中区自己的沙盘里，中区的楼 packOf 写的是 all，但它就在眼前。 */
    async applyPlace(buildingId: string | null) {
      this.placeSeq += 1;
      this.viewSeq += 1;
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
