// 레그 hover 라벨 진단 — 브라우저 콘솔에서 `__legDebug()`
//
// "이 레그는 비교(↑↓%)가 왜 안 뜨나"를 레그별로 표에 찍는다.
// 판정 로직을 여기서 복제하지 않고 **실제로 화면이 쓰는 함수**를 그대로 호출한다
// (findHoveredLeg의 prev 규칙 = 두 칸 앞, legPeakVolume, side 선택까지 동일).
// 복제하면 실제 동작과 어긋난 설명을 하게 된다 — structDebug.js와 같은 원칙.

import { tsToIdx } from "./scales";
import { normalizeStructurePoints } from "./deriveStructure";
import { legPeakVolume, fmtVol, volChangePct, LEG_VOL_METRICS } from "./legVolume";
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
    "같은방향봉": cur?.[key]?.n ?? "—",
    "직전범위": prev ? `${Math.round(prev.i1)}→${Math.round(prev.i2)}` : "—",
  };
  // 화면과 같은 세 지표를 나란히 — 어느 줄이 왜 안 뜨는지 보려면 값도 같이 보여야 한다
  for (const { key: m, label } of LEG_VOL_METRICS) {
    row[label]        = cur?.[key] ? fmtVol(cur[key][m]) : "—";
    row[`직전${label}`] = prv?.[key] ? fmtVol(prv[key][m]) : "—";
  }

  const dir = isUp ? "양봉" : "음봉";
  if (cur == null)        row.판정 = "레그 봉 범위 없음 (1봉 이하이거나 캔들 범위 밖) → 줄 전체 숨김";
  else if (!cur[key])     row.판정 = `이 레그에 ${dir}이 하나도 없음 → 줄 전체 숨김`;
  else if (prev == null)  row.판정 = "이 구조의 첫 상승/첫 하락 → 비교 대상 없음 (정상, 비교만 숨김)";
  else if (prv == null)   row.판정 = "직전 레그 봉 범위 없음 → 비교만 숨김";
  else if (!prv[key])     row.판정 = `직전 레그에 ${dir}이 하나도 없음 → 비교만 숨김`;
  else {
    // 세 지표의 증감을 한 칸에 — 부호가 갈리는 게 정상이다 (legVolume.js [LV8])
    const parts = LEG_VOL_METRICS.map(({ key: m, label }) => {
      const d = volChangePct(cur[key][m], prv[key][m]);
      return d == null ? `${label} —` : `${label} ${d >= 0 ? "↑" : "↓"}${Math.abs(d).toFixed(0)}%`;
    });
    row.판정 = prv[key].sum > 0 ? `정상  ${parts.join("  ")}` : "직전 레그 거래량이 0 → 비교만 숨김";
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
      // findHoveredLeg와 같은 규칙 — 두 칸 앞(k-2)뿐. 없으면(첫 상승/첫 하락) 비교 없음 [LV7]
      const prev = k >= 3
        ? { i1: tsToIdx(pts[k - 3].t, candles), i2: tsToIdx(pts[k - 2].t, candles) }
        : null;
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

  // ※ 여기 있던 `진행 중 레그(점선)` 항목은 2026-08-26에 그 기능과 함께 삭제됐다
  //   (Structures.jsx [R3]). 자동 이어그리기 구간의 레그는 아직 hover 대상이 아니라
  //   이 도구에도 안 나온다 — 붙이려면 hitDetection.findHoveredLeg부터 손봐야 한다.

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
