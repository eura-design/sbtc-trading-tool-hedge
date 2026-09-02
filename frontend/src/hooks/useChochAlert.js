import { useEffect, useRef } from "react";
import { BN_PUBLIC, BN_WS, INTERVALS } from "../constants";
import { computeStructureZigzag, getZzChochSignal, dropZzSlot } from "../chart/structureZigzag";
import { autoPivotsAfter, structAutoOn } from "../chart/structAutoPivots";
import { deriveStructure } from "../chart/deriveStructure";

// CHoCH 발생 알림 — 자동 ZZ + 수동 구조, **타임프레임별 독립 감시** (2026-09-02)
//
// ── 무엇이 바뀌었나 ────────────────────────────────────────────────────────
// 그전에는 **보고 있는 차트의 CHoCH만** 알렸다. 계산이 화면 렌더 경로에만 있어서
// (자동 ZZ는 candleRenderer, 수동 구조는 Structures.jsx) 5분 차트를 보는 동안에는
// 1시간에서 CHoCH가 나도 알 방법이 없었다.
//
// 지금은 RSI 알림(useAlertMonitor)과 같은 방식이다 — **선택한 TF마다 캔들을 따로 받아
// 백그라운드로 굴린다.** 화면이 어느 TF든 상관없이 울린다. 그래서 이 훅은 화면 상태를
// 전혀 읽지 않는다 (liveClose 구독도 없앴다 — WebSocket 메시지가 곧 틱이다).
//
// ── 왜 화면 계산을 그대로 쓰지 못하나 ───────────────────────────────────────
// 자동 ZZ의 누적 상태(forward-only)는 원래 화면 하나뿐이었다. TF마다 굴리려고
// **슬롯**을 만들었다 (structureZigzag.js). 여기서 쓰는 키는 `tf:5m` 꼴이고,
// 화면이 쓰는 `chart` 슬롯과는 서로를 모른다.
// 수동 구조는 원래 순수 함수(autoPivotsAfter + deriveStructure)라 캔들만 갈아 끼우면 된다.
//
// ⚠ **화면 쪽에서는 더 이상 알리지 않는다.** 두 곳에서 알리면 지금 보고 있는 TF만
//   알림이 두 번 뜬다. 그래서 structRenderState의 LiveChochs도 같이 없앴다 —
//   되살리려거든 이 훅에서 그 TF를 빼는 것부터 할 것.
//
// ── 오알림을 막는 세 장치 ───────────────────────────────────────────────────
// [1] 첫 관측은 **무조건 조용히 기준선만 잡는다.** 감시를 시작하면 과거 전 구간의
//     CHoCH가 한꺼번에 계산되므로, 이게 없으면 켜자마자 알림이 쏟아진다.
//     TF를 새로 고르거나, 껐다 켜거나, 새로고침해도 마찬가지다.
// [2] 자동 ZZ는 **세대(gen) 비교.** 파라미터를 만지거나 캔들 버퍼를 줄이면 누적 상태를
//     버리고 과거를 다시 훑는데, 그때 마지막 CHoCH의 seq가 바뀐다 → gen이 변했으면
//     "새 발생"이 아니라 재계산이므로 소리 없이 기준선만 갱신한다.
// [3] **필터는 소리만 막고 기준선은 계속 갱신한다.** TF를 알림 목록에서 뺐다가 다시
//     넣거나 구조의 🔔을 껐다 켤 때, 그동안 쌓인 CHoCH가 한꺼번에 쏟아지지 않게.
//
// 수동 구조는 **자동 이어그리기(autoZz)를 켠 구조에서만** 울린다 — 확정 CHoCH는 꼭짓점을
// 옮길 때마다 통째로 재계산돼 알림이 터지므로, 알릴 가치가 있는 "지금 발생"은 자동 구간의
// 것뿐이다. 키는 `구조id|방향|레벨가격`이라 같은 마크가 확정분으로 바뀌어도 다시 울리지 않는다.
// ⚠ 꼭짓점을 드래그하면 레벨 가격이 바뀌어 **키가 달라지므로 한 번 울릴 수 있다.**
//   막으려면 "방금 드래그했으면 잠시 무음" 같은 장치가 필요한데 아직 없다 —
//   알림 켠 구조를 편집할 때만 생기는 일이라 두기로 했다

const TF_LABEL = Object.fromEntries(INTERVALS.map(i => [i.value, i.label]));
const EMPTY = [];

const fmt = p => "$" + p.toLocaleString("ko-KR", { maximumFractionDigits: 1 });
const dirLabel = dir => (dir === "bull" ? "상승 전환" : "하락 전환");

// 감시용 캔들 — 화면(1500봉)보다 짧아도 된다. 알리는 건 **기준선 이후 새로 생긴 것**뿐이라
// 과거를 얼마나 깊게 아는지는 상관이 없고, 짧을수록 매 틱 도는 ATR 계산이 싸다.
const LOAD = 500;
// 봉이 쌓이면 잘라낸다. ⚠ 자르면 candles[0]이 바뀌어 자동 ZZ가 **전 구간을 다시 훑는다**
//   (= 세대 증가 → 조용히 기준선만 재설정, [2]). 소리 없이 넘어가지만 그 틱의 새 CHoCH는
//   놓치므로 자주 일어나면 안 된다 — 5분봉 기준 열흘에 한 번꼴이라 이 값으로 둔다.
//   ⚠ 봉마다 shift()로 창을 미는 방식으로 바꾸지 말 것. 그러면 **봉마다** 전 구간 재계산이 돈다
const TRIM_AT = 3000, TRIM_TO = 2000;

const zzSlot = tf => `tf:${tf}`;

// 알릴 수 있는 구조 = 🔔(alertChoch) ON **이면서** 자동 이어그리기(autoZz) ON.
// 둘 중 하나라도 없으면 그 구조에서는 어떤 CHoCH도 울리지 않는다 — 감시를 열 이유도,
// 매 틱 파생을 돌 이유도 없다. **판정은 여기 하나뿐이다** (감시 개시와 알림이 갈리면
// "켰는데 안 울린다"와 "안 켰는데 소켓이 열린다"가 둘 다 생긴다)
const canAlert = s => s?.alertChoch === true && structAutoOn(s);

// ── 자동 ZZ ─────────────────────────────────────────────────────────────────
function evalZz(tf, st, ctx) {
  if (!ctx.zzTfsRef.current.includes(tf)) {
    // 감시 대상이 아니면 굴리지 않는다. 기준선을 비워 두면 다시 고를 때 [1]로 떨어진다
    st.zz = { gen: null, seq: null };
    return;
  }
  computeStructureZigzag(st.candles, ctx.zzParamsRef.current, zzSlot(tf));

  const { gen, last } = getZzChochSignal(zzSlot(tf));
  const prev = st.zz;
  const seq  = last?.seq ?? null;

  if (prev.gen !== gen || prev.seq === null) {
    st.zz = { gen, seq };            // [1] 첫 관측 / [2] 재계산 — 조용히 기준선만
  } else if (seq !== null && seq > prev.seq) {
    st.zz = { gen, seq };
    ctx.onAlertRef.current(`${TF_LABEL[tf]} ZZ CHoCH ${dirLabel(last.dir)}  ${fmt(last.price)}`);
  }
}

// ── 수동 구조 ───────────────────────────────────────────────────────────────
function evalStruct(tf, st, ctx) {
  if (!ctx.structTfsRef.current.includes(tf)) { st.struct = null; return; }

  const list = ctx.structuresRef.current ?? [];
  // 알릴 수 있는 구조가 하나도 없으면 파생을 돌지 않는다 (기본이 OFF라 이게 보통이다).
  // 기준선을 비워 두면 나중에 🔔을 켤 때 [1]로 떨어져 조용히 다시 잡힌다
  if (!list.some(canAlert)) { st.struct = null; return; }

  // ⚠ 그 안에서는 **🔔을 켠 구조만 골라 계산하면 안 된다** — 🔔을 켜는 순간 그 구조에
  //   **이미 있던** CHoCH가 처음 보는 것이 되어 한꺼번에 울린다. 자동 이어그리기를 켠
  //   구조는 전부 계산해 기준선에 담고, 🔔은 **알릴 때만** 본다 ([3]과 같은 이유)
  const cand = list.filter(s => s.points?.length >= 2 && structAutoOn(s));
  if (!cand.length) { st.struct = null; return; }

  // 자동 이어그리기 구간에서 나온 CHoCH만 = 가로선 끝이 사용자 마지막 점보다 뒤인 것
  // (Structures.jsx의 live 판정과 같은 규칙 — 한쪽만 바꾸면 화면과 알림이 갈린다)
  const live = [];
  for (const s of cand) {
    const auto = autoPivotsAfter(s.points, st.candles, s.autoParams);
    if (!auto.length) continue;
    const userLastT = s.points[s.points.length - 1].t;
    for (const ev of deriveStructure([...s.points, ...auto]).chochs) {
      if (ev.toT > userLastT) live.push({ st: s, dir: ev.dir, price: ev.price });
    }
  }

  const keyOf = e => `${e.st.id}|${e.dir}|${e.price}`;
  const seen  = st.struct;
  st.struct   = new Set(live.map(keyOf));
  if (!seen) return;                       // [1] 첫 관측이면 기준선만 잡고 끝

  for (const e of live) {
    if (seen.has(keyOf(e))) continue;
    // 알림은 구조별 플래그로 켠다 — **기본 OFF**(2026-08-13 사용자 요청).
    // 켜져 있으면 그 구조가 호박색 점선으로 보이므로, 기본이 ON이면 모든 구조가
    // 알림 스타일이 되어 색이 정보를 못 준다 (Structures.jsx [R10])
    if (!canAlert(e.st)) continue;
    ctx.onAlertRef.current(`${TF_LABEL[tf]} 구조 CHoCH ${dirLabel(e.dir)}  ${fmt(e.price)}`);
  }
}

// ── TF 하나짜리 감시 (REST 1회 + kline WebSocket) ───────────────────────────
// useAlertMonitor의 startTFMonitor와 같은 모양이다. 합치지 않은 이유는 저쪽이 RSI 상태를
// 들고 300봉만 쓰고, 이쪽은 봉 배열의 **참조가 유지돼야** 하기 때문이다 —
// 자동 ZZ는 배열이 바뀌면 누적 상태를 버린다 (structureZigzag의 `_st.arr !== candles`).
function startFeed(tf, st, ctx) {
  let closed = false;

  fetch(`${BN_PUBLIC}/fapi/v1/klines?symbol=BTCUSDT&interval=${tf}&limit=${LOAD}`)
    .then(r => r.json())
    .then(d => {
      if (closed) return;
      // 제자리에서 채운다 — **새 배열로 갈아치우지 않는다** (위 주석)
      st.candles.length = 0;
      for (const k of d) st.candles.push({ t: new Date(k[0]), o: +k[1], h: +k[2], l: +k[3], c: +k[4] });
      evalZz(tf, st, ctx);
      evalStruct(tf, st, ctx);
    })
    .catch(e => console.error("[ChochAlert] REST 실패", tf, e));

  const connectWS = () => {
    if (closed) return;
    const ws = new WebSocket(`${BN_WS}/ws/btcusdt@kline_${tf}`);
    st.ws = ws;

    ws.onmessage = (evt) => {
      const k   = JSON.parse(evt.data).k;
      const arr = st.candles;
      if (!arr.length) return;                       // REST가 아직 안 왔다

      const candle = { t: new Date(k.t), o: +k.o, h: +k.h, l: +k.l, c: +k.c };
      if (candle.t.getTime() !== arr[arr.length - 1].t.getTime()) {
        arr.push(candle);
        if (arr.length > TRIM_AT) arr.splice(0, arr.length - TRIM_TO);   // 위 TRIM 주석
      } else {
        arr[arr.length - 1] = candle;
      }

      evalZz(tf, st, ctx);
      evalStruct(tf, st, ctx);
    };

    ws.onerror = e => console.error("[ChochAlert] WS 오류", tf, e);
    ws.onclose = () => { if (!closed) setTimeout(connectWS, 3000); };
  };
  connectWS();

  return () => {
    closed = true;
    if (st.ws) st.ws.close();
    dropZzSlot(zzSlot(tf));
  };
}

/**
 * @param zzTfs       자동 ZZ CHoCH를 알릴 TF 목록 (지표 ON + alert_choch일 때만 채워 넘긴다)
 * @param structTfs   수동 구조 CHoCH를 알릴 TF 목록 (지표 ON일 때만 채워 넘긴다)
 * @param structures  수동 구조 목록 (구조별 alertChoch·autoZz·autoParams를 읽는다)
 * @param zzParams    자동 ZZ 파라미터 (indicatorParams.zz)
 * @param onAlert     알림 표시 콜백 (addToast)
 * @param enabled     false면 WebSocket을 아예 열지 않는다 — **리플레이 모드용**.
 *   과거를 재생하는 중에 현재 시각의 CHoCH가 울리면 그 자체가 미래 정보다
 *   (useAlertMonitor의 enabled와 같은 이유)
 */
export function useChochAlert({ zzTfs, structTfs, structures, zzParams, onAlert, enabled = true }) {
  // 감시 루프는 WebSocket 콜백 안에서 돌아 재구독이 없다 — 최신값은 전부 ref로 읽는다
  const zzTfsRef      = useRef(zzTfs);       zzTfsRef.current      = zzTfs;
  const structTfsRef  = useRef(structTfs);   structTfsRef.current  = structTfs;
  const structuresRef = useRef(structures);  structuresRef.current = structures;
  const zzParamsRef   = useRef(zzParams);    zzParamsRef.current   = zzParams;
  const onAlertRef    = useRef(onAlert);     onAlertRef.current    = onAlert;

  const feedsRef = useRef(new Map());        // tf → { candles, ws, zz, struct, stop }
  const ctxRef   = useRef(null);
  ctxRef.current = { zzTfsRef, structTfsRef, structuresRef, zzParamsRef, onAlertRef };

  // 열어야 할 TF = 두 목록의 합집합. **차이만 여닫는다** — 목록을 만질 때마다 전부 다시
  // 열면 멀쩡히 감시 중이던 TF까지 기준선이 초기화돼([1]) 그 사이 발생분을 놓친다.
  //
  // 수동 구조 쪽은 **알릴 수 있는 구조가 하나라도 있을 때만** 연다. 구조 CHoCH 알림은
  // 기본 OFF라 보통은 하나도 없고, 그때 소켓 7개를 여는 건 순전한 낭비다.
  // (자동 ZZ는 App이 alert_choch를 이미 봐서 꺼져 있으면 빈 목록을 넘긴다)
  const structWant = structures?.some(canAlert) ? structTfs : EMPTY;
  const want = enabled ? [...new Set([...zzTfs, ...structWant])].sort().join(",") : "";

  useEffect(() => {
    const wanted = new Set(want ? want.split(",") : []);
    const feeds  = feedsRef.current;

    for (const [tf, st] of feeds) {
      if (wanted.has(tf)) continue;
      st.stop();
      feeds.delete(tf);
    }
    for (const tf of wanted) {
      if (feeds.has(tf)) continue;
      const st = { candles: [], ws: null, zz: { gen: null, seq: null }, struct: null, stop: null };
      st.stop = startFeed(tf, st, ctxRef.current);
      feeds.set(tf, st);
    }
    // ⚠ 여기에 cleanup을 두지 말 것 — 목록이 바뀔 때마다 전부 닫혀 위 차이 계산이 무의미해진다.
    //   언마운트 정리는 아래 빈 배열 effect가 맡는다
  }, [want]);

  useEffect(() => () => {
    for (const st of feedsRef.current.values()) st.stop();
    feedsRef.current.clear();
  }, []);
}
