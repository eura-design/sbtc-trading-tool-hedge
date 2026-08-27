// Module-level timer: drawing localStorage 동기화 debounce
import { lsGet, lsRemove, lsSet } from "../utils/storage";

let _drawingTimer = null;

// ── 플랜 박스도 모드별로 나눈다 ──────────────────────────────────────────
// 다른 도형(추세선·구조 등)은 replay/drawingKeys.js가 나누는데, 진입/TP/SL 박스는
// 스토어에 있어서 빠져 있었다. 그대로 두면 **실거래 박스가 지워진다**:
// 리플레이에 들어가면 App의 drawing↔pending 동기화가 페이퍼 position(pending 없음)을
// 보고 `setDrawing(null)`을 실행한다. 반대로 연습 중 그린 박스가 실거래로 새기도 한다.
const LIVE_KEY = "drawing";
const REPLAY_KEY = "replay_drawing";
let _drawingKey = LIVE_KEY;

// ── ⚠ 플랜 박스는 **롱·숏 각각 하나씩, 최대 두 개**다 (2026-08-19 사용자 요청) ──
//
// 예전에는 `drawing` 객체 **하나**였다. 막는 코드가 있었던 게 아니라 담을 자리가
// 하나뿐이라, 두 번째 박스를 그리면 첫 번째가 조용히 덮여 사라졌다.
// 이건 의도한 제약이 아니라 **원웨이 모드 시절의 잔재**다 — 헷지모드 전환 커밋이
// position·tpsl을 `{ long, short }`로 이중화하면서 여기만 손대지 않았다.
//
// ⚠ 사이드가 **슬롯의 열쇠**다. 박스에도 `isLong`이 들어 있지만, 저장되는 자리는
//   언제나 `drawings[isLong ? "long" : "short"]`여야 한다. 둘이 어긋나면
//   "롱 슬롯에 숏 박스"가 생겨 사이드바·주문 경로가 서로 다른 사이드를 가리킨다.
export const EMPTY_DRAWINGS = { long: null, short: null };
export const boxKey = (isLong) => (isLong ? "long" : "short");

/** 저장 키를 바꾸고 그 키의 내용을 돌려준다. 전환 전 보류 중인 저장은 먼저 흘려보낸다 */
export function swapDrawingStorage(replayOn, current) {
  // ⚠ debounce 타이머가 남아 있으면 **이전 모드의 박스가 새 키에 덮인다**
  clearTimeout(_drawingTimer);
  writeDrawings(_drawingKey, current);

  _drawingKey = replayOn ? REPLAY_KEY : LIVE_KEY;
  return loadDrawings();
}

function writeDrawings(key, map) {
  if (map?.long || map?.short) lsSet(key, JSON.stringify(map));
  else                         lsRemove(key);
}

/** 저장된 박스 하나를 씻어 낸다 (구버전 좌표 정리). 못 쓰면 null */
function normBox(b) {
  if (!b) return null;
  // tStart/tEnd는 숫자 타임스탬프로 유지
  if (typeof b.tStart === "string") b.tStart = +new Date(b.tStart);
  if (typeof b.tEnd   === "string") b.tEnd   = +new Date(b.tEnd);
  // 구버전 iStart/iEnd만 있는 박스는 무효화
  if (!b.tStart && b.iStart !== undefined) return null;
  return b;
}

function loadDrawings() {
  try {
    const saved = JSON.parse(lsGet(_drawingKey) || "null");
    if (!saved) return { ...EMPTY_DRAWINGS };
    // ⚠ **박스 하나만 저장하던 구버전을 계속 읽는다.** `isLong`이 있으면 박스 자체다
    //   (새 형식은 long/short를 담은 봉투라 그 키가 없다). 안 읽어 주면 업데이트
    //   직후 첫 실행 한 번에 그려 둔 플랜이 통째로 사라진다 —
    //   replay/session.js가 구버전 세션을 계속 읽는 것과 같은 이유다
    if ("isLong" in saved) {
      const b = normBox(saved);
      return b ? { ...EMPTY_DRAWINGS, [boxKey(b.isLong)]: b } : { ...EMPTY_DRAWINGS };
    }
    return { long: normBox(saved.long), short: normBox(saved.short) };
  } catch { return { ...EMPTY_DRAWINGS }; }
}

function scheduleDrawingSave(map) {
  clearTimeout(_drawingTimer);
  const key = _drawingKey;   // 저장 시점이 아니라 **호출 시점**의 키로 쓴다
  _drawingTimer = setTimeout(() => writeDrawings(key, map), 200);
}

export const createUiSlice = (set, get) => ({
  // ── 드로잉 (localStorage 동기화) ─────────────────────────────────────────
  // `{ long, short }` — 사이드당 최대 하나 (위 EMPTY_DRAWINGS 주석)
  drawings: loadDrawings(),

  // ── 모드 / UI 상태 ────────────────────────────────────────────────────────
  drawMode:      false,
  orderStatus:   null,
  // ⚠ **목록이다. 문자열 하나로 되돌리지 말 것** (2026-08-15, 실계좌 재현).
  //   예전엔 `criticalAlert` 문자열 하나였는데, 한 reconcile 사이클에서 LONG·SHORT
  //   경보가 **61ms 간격으로** 연달아 오면(trade_log 실측: 08:10:01.307 LONG /
  //   .368 SHORT) 뒤엣것이 앞엣것을 덮어써서 **LONG 경보가 통째로 사라졌다**.
  //   증상: "SHORT는 SL 없으면 뜨는데 LONG은 안 뜬다" (사용자 신고).
  //   같은 문구는 중복으로 쌓지 않는다 — 백엔드에도 사이드당 래치가 있지만 이중으로 막는다
  criticalAlerts: [],
  tpslSaving:    false,
  // ⚠ **불리언이 아니라 사이드다** (`"long"` | `"short"` | null, 2026-08-19).
  //   플랜 박스가 둘이 되면서 "선택됨"만으로는 Delete가 어느 박스를 지울지 정할 수 없다.
  //   truthy 검사는 그대로 동작하므로 읽는 쪽 대부분은 고칠 게 없다
  selectedBox:   null,
  opacityPopup:  null,

  // 진입 라벨 × 를 한 번 눌러 "정말 청산?" 상태인 사이드 ("LONG" | "SHORT" | null).
  // ⚠ 청산은 되돌릴 수 없다 — 차트의 작은 버튼 한 번으로 시장가 청산이 나가면 안 된다.
  //   사이드바 PositionCard도 슬라이더 → 확인 → ✓ 로 여러 단계를 거친다. 여기선 두 번 누르기.
  //   (TP/SL/추가/분할의 × 는 주문 취소일 뿐이라 한 번에 지운다 — 다시 걸면 그만이다)
  closeConfirm:  null,

  // ── 차트에서 주문 가격 지정 (2026-08-27 사용자 요청) ─────────────────────
  //
  // 사이드바 카드의 `차트에서 지정`을 켜면 여기 담긴다. 차트는 이것만 보고
  // **클릭 = 1개 / 세로 드래그 = count개 균등**으로 주문을 낸다.
  //
  // ⚠ **어느 종류인지는 "열려 있는 아코디언"이 정한다.** 방향만으로는 못 가른다 —
  //   롱에서 현재가 **아래**는 추가 진입(지정가 매수)일 수도, 분할 SL(트리거 매도)일
  //   수도 있어 클릭 위치가 답을 주지 않는다. 포지션 카드는 이미 넷 중 하나만
  //   열리므로(PositionCard.openSection) 그 하나가 곧 종류다
  //
  // ⚠ **현재가·진입가를 여기 담지 말 것.** 방향 판정에 쓰고 싶어지지만 그 값은
  //   틱마다 바뀌어서, 담는 순간 이 객체가 매 틱 새로 만들어지고 차트 오버레이가
  //   따라서 매 틱 리렌더된다. 방향 검증은 주문을 내는 `placeSplitOrders`가
  //   그때그때 살아 있는 값으로 한다 (`+TP`/`+SL`이 검증을 안 하는 것과 같은 자리)
  //
  //   { kind:"scale_in"|"split_tp"|"partial_sl", side:"LONG"|"SHORT", count, qty }
  orderPick: null,
  // 세로 드래그 중 미리보기 — { p1, p2 }. 손을 떼면 비운다.
  // ⚠ 클릭(1개)에는 미리보기가 없다 — 마우스 이동마다 상태를 갱신하면 오버레이
  //   전체가 매번 리렌더된다. 그 자리 가격은 크로스헤어 가격축 태그가 이미 말해 준다
  pickDraft: null,

  // ── 드래그 상태 ──────────────────────────────────────────────────────────
  dragTpsl:    null,
  dragScaleIn: null,
  dragSplitTp: null,
  dragPartialSl: null,

  /**
   * 한 **사이드의** 플랜 박스를 갈아끼운다.
   * @param isLong  true = 롱 슬롯 / false = 숏 슬롯
   * @param v       박스 · null · 갱신 함수(그 슬롯의 현재 값을 받는다)
   *
   * ⚠ 반대쪽 슬롯은 **절대 건드리지 않는다.** 이 함수가 통째로 교체하면
   *   롱 박스를 옮기는 드래그 한 번에 숏 플랜이 사라진다.
   */
  setDrawing: (isLong, v) => {
    const key  = boxKey(isLong);
    const cur  = get().drawings;
    const next = typeof v === "function" ? v(cur[key]) : v;
    if (next === cur[key]) return;              // 값이 그대로면 리렌더도 저장도 없다
    const map = { ...cur, [key]: next ?? null };
    set({ drawings: map });
    scheduleDrawingSave(map);
  },

  /** 양쪽을 한 번에 비운다 — 리플레이 구간을 옮길 때 연습 플랜을 지우는 경로 */
  clearDrawings: () => {
    const cur = get().drawings;
    if (!cur.long && !cur.short) return;
    const map = { ...EMPTY_DRAWINGS };
    set({ drawings: map });
    scheduleDrawingSave(map);
  },

  setDrawMode:      (v) => set({ drawMode: typeof v === "function" ? v(get().drawMode) : v }),
  setOrderStatus:   (v) => set({ orderStatus: v }),
  pushCriticalAlert:    (msg) => set(s => s.criticalAlerts.includes(msg)
                                    ? {} : { criticalAlerts: [...s.criticalAlerts, msg] }),
  dismissCriticalAlert: (msg) => set(s => ({ criticalAlerts: s.criticalAlerts.filter(m => m !== msg) })),
  clearCriticalAlerts:  ()    => set({ criticalAlerts: [] }),
  setTpslSaving:    (v) => set({ tpslSaving: v }),
  setSelectedBox:   (v) => set({ selectedBox: v }),
  setOpacityPopup:  (v) => set({ opacityPopup: v }),
  setCloseConfirm:  (v) => set({ closeConfirm: v }),

  // ⚠ 켤 때 **박스 그리기 모드를 끈다** — 둘 다 켜져 있으면 차트를 눌렀을 때
  //   무엇이 일어날지가 화면에 안 드러난다. 나머지 그리기 모드는 App의 상단 바
  //   토글이 서로를 끄는 방식이라 그쪽에서 함께 끈다
  setOrderPick: (v) => set(v ? { orderPick: v, pickDraft: null, drawMode: false }
                             : { orderPick: null, pickDraft: null }),
  setPickDraft: (v) => set({ pickDraft: v }),

  setDragTpsl:    (v) => set({ dragTpsl: v }),
  setDragScaleIn: (v) => set({ dragScaleIn: v }),
  setDragSplitTp: (v) => set({ dragSplitTp: v }),
  setDragPartialSl: (v) => set({ dragPartialSl: v }),
});
