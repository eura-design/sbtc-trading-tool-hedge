// 수동 구조 CHoCH 판정 진단 — 브라우저 콘솔에서 `__structDebug()`
//
// "여기는 CHoCH가 떠야 하는데 안 뜬다"를 확인할 때 쓴다. 꼭짓점 순서/값을 손으로
// 옮겨 적는 대신, 꼭짓점마다 **어떤 레벨을 보고 왜 안 찍혔는지**를 표로 보여준다.
//
// 판정 근거는 deriveStructure가 직접 기록한다(trace 인자) — 여기서 로직을 복제하면
// 실제 동작과 어긋난 설명을 하게 된다.

import { deriveStructure, normalizeStructurePoints } from "./deriveStructure";

const fmtT = t => new Date(t).toLocaleString("ko-KR", {
  month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
});

function readStructures() {
  try { return JSON.parse(localStorage.getItem("structures") || "[]"); }
  catch { return []; }
}

/**
 * @param id 특정 구조만 보고 싶을 때의 id (생략하면 전부)
 * @returns 붙여넣기 좋은 요약 문자열 (콘솔에는 표로도 출력)
 */
export function structDebug(id = null) {
  const list = readStructures().filter(s => id == null || s.id === id);
  if (!list.length) {
    console.log("%c저장된 수동 구조가 없습니다 (localStorage.structures)", "color:#f6465d");
    return "";
  }

  const lines = [];
  for (const st of list) {
    const pts = normalizeStructurePoints(st.points ?? []);
    const trace = [];
    const { chochs } = deriveStructure(pts, null, trace);   // 확정분만 — 라이브는 캔들이 필요

    const head = `구조 ${st.id} — 꼭짓점 ${pts.length}개, 확정 CHoCH ${chochs.length}개`
      + `${st.showChoch === false ? "  ⚠ CHoCH 표시 OFF" : ""}`;
    console.log(`%c${head}`, "color:#f0b90b;font-weight:700");
    console.log(pts.map(p => `${p.type}${p.p}`).join(" → "));
    console.table(trace);

    lines.push(head);
    lines.push("  " + pts.map(p => `${p.type} ${p.p} (${fmtT(p.t)})`).join("  →  "));
    for (const r of trace) {
      if (r.판정 === "CHoCH ✔") continue;
      lines.push(`  #${r["#"]} ${r.꼭짓점}  레벨=${r["감시 레벨"]}  직전추세=${r["직전 추세"]}  → ${r.판정}`);
    }
  }

  const out = lines.join("\n");
  console.log("%c↓ 아래 텍스트를 복사해서 붙여넣으세요", "color:#0ecb81");
  console.log(out);
  return out;
}

export function installStructDebug() {
  if (typeof window === "undefined") return;
  window.__structDebug = structDebug;
}
