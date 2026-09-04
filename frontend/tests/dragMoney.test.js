// 차트에서 선·마커를 끌 때 **어느 가격으로 가는가**
//
// ⚠ 이 파일은 `dragStateMachine.js`의 **돈이 걸린 부분만** 본다.
//   손절선을 끌면 실제 주문 가격이 바뀐다 — 여기가 틀리면 65,000에 놓았는데
//   64,200에 걸린다. 추세선·채널처럼 그림만 바뀌는 것은 다루지 않는다.
//
// 이 파일이 보는 것:
//   · 마우스 y좌표가 **정확히 그 가격**으로 바뀌는가
//   · 화면 위아래 밖으로 끌어도 가격이 **화면 안에 머무는가**
//   · 마커 세 종류(추가 진입·분할 TP·분할 SL)가 **똑같이** 움직이는가
//     (주석: 예전엔 11줄짜리 복사본이 세 벌이었다)
//   · 놓았을 때 **어느 함수에 어떤 값이** 전달되는가
//   · 플랜 박스의 익절·손절이 **진입가를 넘어가지 못하는가**

import test from "node:test";
import assert from "node:assert/strict";
import { DRAG_HANDLERS } from "../src/chart/dragStateMachine.js";

const IH = 400;   // 차트 높이(px)

/** 화면 위(y=0)가 hi, 아래(y=IH)가 lo인 선형 축 */
const yScaleFor = (lo, hi) => {
  const f = (p) => ((hi - p) / (hi - lo)) * IH;
  f.invert = (y) => hi - (y / IH) * (hi - lo);
  return f;
};

/** setters 호출을 전부 기록하는 대역 */
function makeSetters(extra = {}) {
  const calls = [];
  const rec = (name) => (...args) => calls.push({ name, args });
  return {
    calls,
    setCursor: rec("setCursor"),
    setDragTpsl: rec("setDragTpsl"),
    saveTpsl: rec("saveTpsl"),
    setDragScaleIn: rec("setDragScaleIn"),
    setDragSplitTp: rec("setDragSplitTp"),
    setDragPartialSl: rec("setDragPartialSl"),
    moveScaleIn: rec("moveScaleIn"),
    moveSplitTp: rec("moveSplitTp"),
    movePartialSl: rec("movePartialSl"),
    setDrawing: rec("setDrawing"),
    replacePendingOrder: rec("replacePendingOrder"),
    updatePendingTpsl: rec("updatePendingTpsl"),
    ...extra,
  };
}
const argsOf = (s, name) => s.calls.filter(c => c.name === name).map(c => c.args);
const lastOf = (s, name) => argsOf(s, name).at(-1);

// ── 포지션 손절·익절선 끌기 ────────────────────────────────────────────────
test("손절선을 끌면 **그 y좌표의 가격**이 그대로 잡힌다", () => {
  const scales = { yScale: yScaleFor(60000, 80000) };   // 위 80,000 / 아래 60,000
  const s = makeSetters();
  // 화면 한가운데(y=200) → 70,000
  DRAG_HANDLERS.pos_sl.onMove({ pos: { y: 200 }, scales, IH, setters: s, drag: { side: "LONG" } });
  const [d] = lastOf(s, "setDragTpsl");
  assert.equal(d.price, 70000);
  assert.equal(d.type, "sl");
  assert.equal(d.side, "LONG", "어느 쪽 포지션인지가 안 실렸다");
});

test("화면 **밖으로** 끌어도 가격이 화면 안에 머문다", () => {
  // ⚠ 안 막으면 위로 끌수록 가격이 무한정 올라간다 — 손절이 말도 안 되는 자리에 걸린다
  const scales = { yScale: yScaleFor(60000, 80000) };
  for (const [y, want, where] of [[-500, 80000, "위쪽 밖"], [IH + 500, 60000, "아래쪽 밖"]]) {
    const s = makeSetters();
    DRAG_HANDLERS.pos_sl.onMove({ pos: { y }, scales, IH, setters: s, drag: { side: "LONG" } });
    assert.equal(lastOf(s, "setDragTpsl")[0].price, want, `${where}으로 끌었을 때`);
  }
});

test("놓으면 손절만 저장한다 (익절 자리에 null을 넣는다)", () => {
  // ⚠ 익절 자리에 값을 넣으면 손절선을 끌었을 뿐인데 익절까지 다시 걸린다
  const s = makeSetters();
  DRAG_HANDLERS.pos_sl.onUp({ setters: s, state: { dragTpsl: { price: 65000, side: "LONG" } } });
  assert.deepEqual(lastOf(s, "saveTpsl"), [null, 65000, "LONG"]);
});

test("익절선은 반대다 — 익절만 저장한다", () => {
  const s = makeSetters();
  DRAG_HANDLERS.pos_tp.onUp({ setters: s, state: { dragTpsl: { price: 85000, side: "SHORT" } } });
  assert.deepEqual(lastOf(s, "saveTpsl"), [85000, null, "SHORT"]);
});

test("끌던 값이 없으면 아무것도 저장하지 않는다", () => {
  for (const kind of ["pos_sl", "pos_tp"]) {
    const s = makeSetters();
    DRAG_HANDLERS[kind].onUp({ setters: s, state: {} });
    assert.equal(argsOf(s, "saveTpsl").length, 0, `${kind}이 빈 값을 저장했다`);
  }
});

// ── 마커 셋이 똑같이 움직이는가 ────────────────────────────────────────────
const MARKERS = [
  ["scale_in",   "setDragScaleIn",   "moveScaleIn",   "dragScaleIn"],
  ["split_tp",   "setDragSplitTp",   "moveSplitTp",   "dragSplitTp"],
  ["partial_sl", "setDragPartialSl", "movePartialSl", "dragPartialSl"],
];

test("추가 진입·분할 TP·분할 SL 마커가 **똑같이** 움직인다", () => {
  // ⚠ 예전엔 11줄짜리 복사본이 세 벌이었다. 나뉘어 있으면 한쪽만 고쳐서
  //   같은 조작인데 마커 종류에 따라 다르게 움직이는 상태가 조용히 생긴다
  const scales = { yScale: yScaleFor(60000, 80000) };
  const prices = [];
  for (const [kind, setDrag] of MARKERS) {
    const s = makeSetters();
    DRAG_HANDLERS[kind].onMove({ pos: { y: 120 }, scales, IH, setters: s,
                                 drag: { orderId: "A1" } });
    const [d] = lastOf(s, setDrag);
    assert.equal(d.orderId, "A1", `${kind}이 주문번호를 안 실었다`);
    prices.push(d.price);
  }
  assert.equal(new Set(prices).size, 1, `셋이 다른 가격을 냈다: ${prices}`);
});

test("마커 셋 다 화면 밖에서 멈춘다", () => {
  const scales = { yScale: yScaleFor(60000, 80000) };
  for (const [kind, setDrag] of MARKERS) {
    const s = makeSetters();
    DRAG_HANDLERS[kind].onMove({ pos: { y: -999 }, scales, IH, setters: s, drag: { orderId: "A" } });
    assert.equal(lastOf(s, setDrag)[0].price, 80000, `${kind}이 화면 밖으로 나갔다`);
  }
});

test("마커를 놓으면 **주문번호와 가격**을 그 종류의 이동 함수에 넘긴다", () => {
  for (const [kind, setDrag, commit, stateKey] of MARKERS) {
    const s = makeSetters();
    DRAG_HANDLERS[kind].onUp({ setters: s, state: { [stateKey]: { orderId: "X9", price: 71234 } } });
    assert.deepEqual(lastOf(s, commit), ["X9", 71234], `${kind}이 다른 값을 넘겼다`);
    // 끌던 상태는 비운다 — 안 비우면 다음 드래그가 옛 값으로 시작한다
    assert.deepEqual(lastOf(s, setDrag), [null], `${kind}이 끌던 상태를 안 비웠다`);
  }
});

test("마커를 끌지 않았으면 이동 함수를 부르지 않는다", () => {
  for (const [kind, , commit] of MARKERS) {
    const s = makeSetters();
    DRAG_HANDLERS[kind].onUp({ setters: s, state: {} });
    assert.equal(argsOf(s, commit).length, 0, `${kind}이 빈 값으로 주문을 옮겼다`);
  }
});

// ── 플랜 박스: 익절·손절이 진입가를 넘지 못한다 ────────────────────────────
const boxState = (isLong, entry = 70000) => ({
  drawings: { [isLong ? "long" : "short"]: { entry, tp: entry * 1.1, sl: entry * 0.9 } },
});

test("롱 플랜 박스 — 익절은 진입가 **위**에만, 손절은 **아래**에만 놓인다", () => {
  const scales = { yScale: yScaleFor(60000, 80000) };
  const drag = { isLong: true };

  // 익절을 진입가(70,000) 아래로 끌면 무시한다
  const bad = makeSetters();
  DRAG_HANDLERS.tp.onMove({ pos: { y: 300 }, scales, IH, setters: bad, drag, state: boxState(true) });
  assert.equal(argsOf(bad, "setDrawing").length, 0, "익절이 진입가 아래로 갔다");

  // 위로 끌면 반영한다
  const ok = makeSetters();
  DRAG_HANDLERS.tp.onMove({ pos: { y: 100 }, scales, IH, setters: ok, drag, state: boxState(true) });
  assert.equal(argsOf(ok, "setDrawing").length, 1, "익절이 위로도 안 움직인다");

  // 손절은 반대
  const slBad = makeSetters();
  DRAG_HANDLERS.sl.onMove({ pos: { y: 100 }, scales, IH, setters: slBad, drag, state: boxState(true) });
  assert.equal(argsOf(slBad, "setDrawing").length, 0, "손절이 진입가 위로 갔다");
});

test("숏 플랜 박스 — 방향이 뒤집힌다", () => {
  const scales = { yScale: yScaleFor(60000, 80000) };
  const drag = { isLong: false };

  // 숏은 익절이 진입가 **아래**다
  const ok = makeSetters();
  DRAG_HANDLERS.tp.onMove({ pos: { y: 300 }, scales, IH, setters: ok, drag, state: boxState(false) });
  assert.equal(argsOf(ok, "setDrawing").length, 1, "숏 익절이 아래로 안 움직인다");

  const bad = makeSetters();
  DRAG_HANDLERS.tp.onMove({ pos: { y: 100 }, scales, IH, setters: bad, drag, state: boxState(false) });
  assert.equal(argsOf(bad, "setDrawing").length, 0, "숏 익절이 진입가 위로 갔다");
});

test("박스가 없으면 아무것도 하지 않는다", () => {
  const scales = { yScale: yScaleFor(60000, 80000) };
  for (const kind of ["tp", "sl"]) {
    const s = makeSetters();
    DRAG_HANDLERS[kind].onMove({ pos: { y: 200 }, scales, IH, setters: s,
                                 drag: { isLong: true }, state: { drawings: {} } });
    assert.equal(argsOf(s, "setDrawing").length, 0, `${kind}이 없는 박스를 고쳤다`);
  }
});

// ── 진입선을 끌면 익절·손절이 **같이** 따라온다 ────────────────────────────
test("진입선을 끌면 익절·손절이 같은 거리만큼 따라온다", () => {
  // ⚠ 안 따라오면 박스를 옮기는 것만으로 손익비가 달라진다
  const scales = { yScale: yScaleFor(60000, 80000), xScale: Object.assign(() => 0, { invert: () => 0 }) };
  const s = makeSetters({ isLog: false });
  DRAG_HANDLERS.entry.onMove({
    pos: { x: 0, y: 200 },                      // → 70,000
    drag: { isLong: true, startEntry: 69000, startTp: 75000, startSl: 66000,
            startX: 0, startTStart: 0, startTEnd: 0 },
    scales, candles: [{ t: 0 }, { t: 60000 }], IW: 800, IH, setters: s,
  });
  const [, updater] = lastOf(s, "setDrawing");
  const next = updater({ entry: 69000, tp: 75000, sl: 66000 });
  const dy = 70000 - 69000;
  assert.equal(next.entry, 70000);
  assert.equal(next.tp, 75000 + dy, "익절이 안 따라왔다");
  assert.equal(next.sl, 66000 + dy, "손절이 안 따라왔다");
});

test("진입선을 놓았을 때 **미체결 주문이 있을 때만** 다시 건다", () => {
  // ⚠ 주문이 없는데 부르면 없는 주문을 취소·재등록하려 든다
  const withOrder = makeSetters();
  DRAG_HANDLERS.entry.onUp({ setters: withOrder, drag: { isLong: true },
    state: { drawings: { long: { orderId: "P1" } } } });
  assert.equal(argsOf(withOrder, "replacePendingOrder").length, 1);

  const noOrder = makeSetters();
  DRAG_HANDLERS.entry.onUp({ setters: noOrder, drag: { isLong: true },
    state: { drawings: { long: {} } } });
  assert.equal(argsOf(noOrder, "replacePendingOrder").length, 0,
    "미체결 주문도 없는데 재등록을 불렀다");
});

test("익절만 옮겼으면 **주문을 다시 걸지 않고** TP/SL만 고친다", () => {
  // ⚠ 익절은 가격만 바꾸면 된다. 진입 주문을 다시 걸면 줄 서 있던 자리를 잃는다
  const s = makeSetters();
  DRAG_HANDLERS.tp.onUp({ setters: s, drag: { isLong: true },
    state: { drawings: { long: { orderId: "P1" } } } });
  assert.equal(argsOf(s, "updatePendingTpsl").length, 1);
  assert.equal(argsOf(s, "replacePendingOrder").length, 0, "진입 주문을 다시 걸었다");
});
