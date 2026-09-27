import { useState } from "react";
import { useTheme } from "../../ThemeContext";
import { calcRR } from "../../utils/format";
import { qtyLabel } from "../../utils/qty";
import { fmtPriceUsd } from "../../utils/price";
import { useStore } from "../../store";

export function PlanCard({ drawing, posCalc, leverage, riskPct, position, hasPending, onConfirm, onCancel,
                           minEntry }) {
  const { theme } = useTheme();
  // 수량 자릿수와 코인 이름은 심볼마다 다르다 (SOL 0.01 / DOGE 1).
  // ⚠ 훅은 아래 조기 반환보다 **앞**이어야 한다 (React 규칙)
  const { step: qStep, base: qBase, tick: qTick } = useStore(s => s.symbolFilters);
  const [orderType, setOrderType] = useState("LIMIT");
  // 수량을 정하는 방식 — 리스크 % / 거래소 최소 (2026-09-27 사용자 요청).
  // ⚠ **주문 종류와 따로 고른다** (시장가·지정가 어느 쪽과도 조합된다).
  //   수동 스케일 진입의 첫 조각을 넣는 용도다: 최소로 들어가 손절을 걸어 두면
  //   그 뒤 추가 진입이 체결돼도 전량 손절이 저절로 유지된다 (`closePosition` 방식이라).
  // ⚠ 저장하지 않는다 — `orderType`과 같다. 늘 `리스크 %`로 시작한다
  const [qtyMode, setQtyMode] = useState("risk");
  if (!drawing) return null;
  // 가격 자릿수는 호가 단위가 정한다 (DOGE는 0.00001이라 두 자리로는 뭉개진다).
  // ⚠ 아래 손익·리스크 금액은 **USDT라 두 자리가 맞다** — 섞지 말 것
  const fmtI  = p => fmtPriceUsd(p, qTick);
  const fmt   = p => fmtPriceUsd(p, qTick);
  const color = drawing.isLong ? "#0ecb81" : "#f6465d";
  const sameSidePos = drawing.isLong ? position?.long : position?.short;

  // 최소 수량은 **주문 종류마다 기준 가격이 다르다** (지정가=그 가격 / 시장가=현재가).
  // 계산은 사이드바가 `utils/calc.minEntryQty`로 해서 넘긴다
  const minQtyNow = orderType === "MARKET" ? minEntry?.market : minEntry?.limit;
  const isMin     = qtyMode === "min";
  const effQty    = isMin ? minQtyNow : posCalc?.actualQty;

  return (
    <div style={{ marginBottom:"12px" }}>
      <div style={{ padding:"10px",
        border:`1px solid ${color}33`, borderLeft:`2px solid ${color}`,
        borderRadius:"5px", marginBottom:"10px" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"8px" }}>
          <span style={{ fontSize:"13px", color, fontWeight:"700" }}>
            {drawing.isLong ? "▲ LONG" : "▼ SHORT"} 플랜
          </span>
          {hasPending && (
            <span style={{ fontSize:"11px", color:"#f0b90b", fontWeight:"600" }}>⏳ 체결 대기중</span>
          )}
        </div>
        {[
          ["청산가",     "—",                                                                                          "#ff4444"],
          ["손익비 R:R", `1 : ${calcRR(drawing.entry, drawing.tp, drawing.sl, drawing.isLong, qTick)}`,                     "#a78bfa"],
          ["수량",       effQty ? qtyLabel(effQty, qStep, qBase) : "—",                                              "#94a3b8"],
          ["포지션 USD", effQty ? fmtI(effQty * drawing.entry) : "—",                                                "#94a3b8"],
          ["예상 손실",  effQty ? `-${fmt(effQty * Math.abs(drawing.entry - drawing.sl))}` : "—",                    "#f6465d"],
          ["예상 수익",  effQty ? `+${fmt(effQty * Math.abs(drawing.tp - drawing.entry))}` : "—",                    "#0ecb81"],
          ["미실현",     "—",                                                                                          theme.textFaint],
        ].map(([l, v, c]) => (
          <div key={l} style={{ display:"flex", justifyContent:"space-between",
            padding:"3px 0", borderBottom:`1px solid ${theme.border}` }}>
            <span style={{ fontSize:"12px", color:theme.textMuted }}>{l}</span>
            <span style={{ fontSize:"13px", color:c, fontWeight:"600" }}>{v}</span>
          </div>
        ))}
      </div>

      {posCalc?.isLeverageCapped && (
        <div style={{ marginBottom:"6px", padding:"8px 10px", background:theme.bgWarning,
          border:"1px solid #f6465d33", borderRadius:"5px", fontSize:"12px", lineHeight:"1.7" }}>
          <span style={{ color:"#f6465d", fontWeight:"700" }}>⚠ 레버리지 한도 조정</span>
          <span style={{ color:theme.textMuted }}> — {leverage}x 한도로 수량 제한됨</span>
        </div>
      )}
      {posCalc?.isMinCapped && (
        <div style={{ padding:"8px 10px", background:theme.bgWarning, border:"1px solid #f0b90b33",
          borderRadius:"5px", fontSize:"12px", lineHeight:"1.7", marginBottom:"6px" }}>
          <span style={{ color:"#f0b90b", fontWeight:"700" }}>⚠ 최소 수량 적용</span>
          <span style={{ color:theme.textMuted }}> — 실제 리스크 </span>
          <span style={{ color:"#f6465d", fontWeight:"700" }}>{posCalc.actualRiskPct.toFixed(2)}%</span>
        </div>
      )}

      {sameSidePos ? (
        <div style={{ padding:"10px", background:theme.bgCard, border:`1px solid #f6465d44`,
          borderLeft:`2px solid #f6465d`,
          borderRadius:"5px", fontSize:"12px", color:theme.textMuted, textAlign:"center" }}>
          {drawing.isLong ? "▲ LONG" : "▼ SHORT"} 포지션이 이미 있습니다
          <br/><span style={{ color:"#f6465d" }}>청산 후 주문 가능</span>
        </div>
      ) : hasPending ? (
        <button onClick={onCancel} style={{
          width:"100%", padding:"10px 0", borderRadius:"5px", fontSize:"13px",
          cursor:"pointer", fontFamily:"inherit", fontWeight:"700",
          background:"transparent", border:`1px solid ${color}66`, color,
          transition:"all 0.15s",
        }}>
          주문 취소
        </button>
      ) : (
        <>
          {/* 수량 방식 — 리스크 % / 최소. 주문 종류(지정가·시장가)와 **따로** 고른다.
              ⚠ `최소`는 수동 스케일 진입의 첫 조각용이다: 최소로 들어가 손절을 걸어 두면
                그 뒤 추가 진입이 체결돼도 전량 손절이 저절로 유지된다 */}
          <div style={{ display:"flex", gap:"6px", marginBottom:"6px" }}>
            {[["risk", "리스크 " + riskPct + "%"], ["min", "최소"]].map(([v, label]) => (
              <button key={v} onClick={() => setQtyMode(v)} style={{
                flex:1, padding:"7px 0", borderRadius:"5px", cursor:"pointer",
                fontSize:"12px", fontFamily:"inherit", fontWeight:"600",
                background: qtyMode === v ? color : "transparent",
                border:`1px solid ${qtyMode === v ? color : theme.borderSec}`,
                color: qtyMode === v ? "#000" : theme.textMuted,
                transition:"all 0.15s",
              }}>{label}</button>
            ))}
          </div>
          {/* ⚠ `최소 수량 — 0.05 SOL ($6) · 진입가 기준` 안내 줄은 2026-09-27 사용자 요청으로
              제거됐다. 위 정보 줄의 `수량`·`포지션 USD`가 이미 그 값을 보여준다 — 중복이었다.
              되살리지 말 것 */}
          <div style={{ display:"flex", gap:"6px", marginBottom:"6px" }}>
            {["LIMIT", "MARKET"].map(t => (
              <button key={t} onClick={() => setOrderType(t)} style={{
                flex:1, padding:"7px 0", borderRadius:"5px", cursor:"pointer",
                fontSize:"12px", fontFamily:"inherit", fontWeight:"600",
                background: orderType === t ? color : "transparent",
                border:`1px solid ${orderType === t ? color : theme.borderSec}`,
                color: orderType === t ? "#000" : theme.textMuted,
                transition:"all 0.15s",
              }}>{t === "LIMIT" ? "지정가" : "시장가"}</button>
            ))}
          </div>
          {/* ⚠ `⚠ 시장가 주의 — 즉시 체결, 슬리피지 발생 가능` 줄은 2026-09-27 사용자 요청으로
              제거됐다. `시장가` 버튼을 고른 것 자체가 그 선택이고, 슬리피지가 실제로 크면
              주문 뒤 배너가 수치로 알린다 (`routes/order.js`의 `slippageWarn` — 0.3% 초과 시
              계획가와 체결가를 함께 띄운다). 되살리지 말 것 */}
          <div style={{ display:"flex", gap:"6px" }}>
            <button onClick={onCancel} style={{
              flex:1, padding:"10px 0", borderRadius:"5px", cursor:"pointer",
              background:"transparent", border:`1px solid ${theme.borderSec}`,
              color:theme.textMuted, fontSize:"13px", fontFamily:"inherit",
            }}>취소</button>
            <button onClick={() => onConfirm(orderType, qtyMode)} disabled={!effQty} style={{
              flex:2, padding:"10px 0", borderRadius:"5px",
              cursor: effQty ? "pointer" : "not-allowed",
              background: effQty ? color : "#1f2937",
              border:"none", color: effQty ? "#000" : "#374151",
              fontSize:"14px", fontFamily:"inherit", fontWeight:"700",
              transition:"all 0.15s",
            }}>{drawing.isLong ? "▲ LONG 실행" : "▼ SHORT 실행"}</button>
          </div>
        </>
      )}
    </div>
  );
}

// ⚠ **OrphanPendingCard는 2026-08-23 사용자 요청으로 제거됐다.**
//   박스 없는 미체결 주문(밖에서 낸 것 포함)은 이제 **차트의 대기선**이 보여준다 —
//   점선 + 좌측 `대기` 버튼 + 수량 배지 + `×`(취소).
//   카드는 가격을 글자로만 알려줬는데, 미체결 주문에서 정작 궁금한 건 "지금 가격에서
//   얼마나 떨어져 있나"라 차트에 선으로 있는 편이 낫다. 취소도 그 선에서 된다.
//   되살리려면 `hitDetection.pendingEntryLines`와 PositionLines의 대기선을 **같이** 지울 것 —
//   둘 다 두면 같은 주문을 두 군데서 취소하게 된다
