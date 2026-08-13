// 레그 hover 라벨 진단 — 브라우저 콘솔에서 `__legDebug()`
//
// "이 레그는 비교(↑↓%)가 왜 안 뜨나"를 레그별로 표에 찍는다.
// 판정 로직을 여기서 복제하지 않고 **실제로 화면이 쓰는 함수**를 그대로 호출한다
// (findHoveredLeg의 prev 규칙 = 두 칸 앞, legPeakVolume, side 선택까지 동일).
// 복제하면 실제 동작과 어긋난 설명을 하게 된다 — structDebug.js와 같은 원칙.

import { tsToIdx } from "./scales";
import { findPrevSameDirLeg } from "./hitDetection";
import { normalizeStructurePoints } from "./deriveStructure";
import { legPeakVolume, fmtVol, volChangePct } from "./legVolume";
import { getStructLiveSegment } from "./structRenderState";
import { getZzSegments } from "./structureZigzag";

// 화면과 같은 규칙으로 한 레그를 판정한다 (useChartInteraction의 pick/side와 동일)
function judge(candles, i1, i2, prev, pct) {
  const isUp = (pct ?? 0) >= 0;
  const key  = isUp ? "up" : "dn";
  const cur  = legPeakVolume(candles, i1, i2);
  const prv  = prev ? legPeakVolume(candles, prev.i1, prev.i2) : null;

  const row = {
    방향: isUp ? "상승" : "하락",
    "등락률": pct == null ? "—" : `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`,
    "봉범위": `${Math.round(i1)}→${Math.round(i2)}`,
    피크: cur?.[key] ? fmtVol(cur[key].peak) : "—",
    "직전범위": prev ? `${Math.round(prev.i1)}→${Math.round(prev.i2)}` : "—",
    "직전피크": prv?.[key] ? fmtVol(prv[key].peak) : "—",
  };

  const dir = isUp ? "양봉" : "음봉";
  if (cur == null)        row.판정 = "레그 봉 범위 없음 (1봉 이하이거나 캔들 범위 밖) → 줄 전체 숨김";
  else if (!cur[key])     row.판정 = `이 레그에 ${dir}이 하나도 없음 → 줄 전체 숨김`;
  else if (prev == null)  row.판정 = "직전 동일방향 레그가 아예 없음 (다른 구조까지 찾아봐도) → 비교만 숨김";
  else if (prv == null)   row.판정 = "직전 레그 봉 범위 없음 → 비교만 숨김";
  else if (!prv[key])     row.판정 = `직전 레그에 ${dir}이 하나도 없음 → 비교만 숨김`;
  else {
    const d = volChangePct(cur[key].peak, prv[key].peak);
    row.판정 = d == null ? "직전 피크가 0 → 비교만 숨김"
                        : `정상 ${d >= 0 ? "↑" : "↓"}${Math.abs(d).toFixed(0)}%`;
  }
  return row;
}

/**
 * @param structures 화면에 보이는 수동 구조 배열
 * @param candles    candlesRef.current (진행 중 봉 반영)
 */
export function legDebug(structures, candles) {
  if (!candles?.length) { console.log("%c캔들이 아직 없습니다", "color:#f6465d"); return ""; }
  const lines = [];

  for (const st of structures ?? []) {
    const pts = normalizeStructurePoints(st.points ?? []);
    if (pts.length < 2) continue;
    const rows = [];
    for (let k = 1; k < pts.length; k++) {
      const p1 = pts[k - 1].p, p2 = pts[k].p;
      // findHoveredLeg와 같은 규칙 — 두 칸 앞(k-2), 없으면 다른 구조에서 찾는다 ([LV7])
      const prev = k >= 3
        ? { i1: tsToIdx(pts[k - 3].t, candles), i2: tsToIdx(pts[k - 2].t, candles) }
        : findPrevSameDirLeg(structures, pts[k - 1].t, p2 > p1, candles);
      rows.push({
        "#": k,
        ...judge(candles, tsToIdx(pts[k - 1].t, candles), tsToIdx(pts[k].t, candles),
                 prev, ((p2 - p1) / p1) * 100),
      });
    }
    const bad = rows.filter(r => !r.판정.startsWith("정상"));
    const head = `구조 ${st.id} — 레그 ${rows.length}개, 비교 안 뜨는 레그 ${bad.length}개`;
    console.log(`%c${head}`, "color:#f0b90b;font-weight:700");
    console.table(rows);
    lines.push(head);
    for (const r of bad) lines.push(`  #${r["#"]} ${r.방향} ${r.등락률}  ${r.봉범위}  → ${r.판정}`);
  }

  // 진행 중 레그(점선) — 구조를 통틀어 하나뿐
  const live = getStructLiveSegment();
  if (live) {
    const r = judge(
      candles, tsToIdx(live.t1, candles), tsToIdx(live.t2, candles),
      live.prev
        ? { i1: tsToIdx(live.prev.t1, candles), i2: tsToIdx(live.prev.t2, candles) }
        : findPrevSameDirLeg(structures, live.t1, live.p2 > live.p1, candles),
      ((live.p2 - live.p1) / live.p1) * 100,
    );
    console.log("%c진행 중 레그(점선)", "color:#f0b90b;font-weight:700");
    console.table([r]);
    lines.push(`진행 중 레그 ${r.방향} ${r.등락률}  ${r.봉범위}  → ${r.판정}`);
  } else {
    lines.push("진행 중 레그 없음 (getStructLiveSegment() = null)");
  }

  lines.push(`자동 ZZ 세그먼트 ${getZzSegments().length}개 / 캔들 ${candles.length}봉`);

  const out = lines.join("\n");
  console.log("%c↓ 아래 텍스트를 복사해서 붙여넣으세요", "color:#0ecb81");
  console.log(out);
  return out;
}

export function installLegDebug(getCtx) {
  if (typeof window === "undefined") return;
  window.__legDebug = () => {
    const { structures, candles } = getCtx();
    return legDebug(structures, candles);
  };
}
