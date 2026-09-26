import { useState } from "react";
import { useTheme } from "../../ThemeContext";
import { calcRR } from "../../utils/format";
import { qtyLabel } from "../../utils/qty";
import { fmtPriceUsd } from "../../utils/price";
import { useStore } from "../../store";

/**
 * @param scale 스케일 진입 계산 결과 `{ maxLayers, count, plan, preview }` (사이드바가 계산한다)
 *   ⚠ **카드가 직접 계산하지 않는다** — `posCalc`와 같은 방식이다. 카드가 자본·리스크·
 *     레버리지를 또 구독하면 한 값이 바뀔 때 두 곳이 따로 움직인다
 * @param onSetLayers 층 개수를 바꾼다 (박스에 저장 → 차트의 층 선이 따라 움직인다)
 * @param onScaleConfirm 스케일 진입 실행 (`orderSlice.executeScalePlan`)
 */
export function PlanCard({ drawing, posCalc, leverage, riskPct, position, hasPending, onConfirm, onCancel,
                           scale, onSetLayers, onScaleConfirm }) {
  const { theme } = useTheme();
  // 수량 자릿수와 코인 이름은 심볼마다 다르다 (SOL 0.01 / DOGE 1).
  // ⚠ 훅은 아래 조기 반환보다 **앞**이어야 한다 (React 규칙)
  const { step: qStep, base: qBase, tick: qTick } = useStore(s => s.symbolFilters);
  const [orderType, setOrderType] = useState("LIMIT");
  if (!drawing) return null;
  // 가격 자릿수는 호가 단위가 정한다 (DOGE는 0.00001이라 두 자리로는 뭉개진다).
  // ⚠ 아래 손익·리스크 금액은 **USDT라 두 자리가 맞다** — 섞지 말 것
  const fmtI  = p => fmtPriceUsd(p, qTick);
  const fmt   = p => fmtPriceUsd(p, qTick);
  const color = drawing.isLong ? "#0ecb81" : "#f6465d";
  const sameSidePos = drawing.isLong ? position?.long : position?.short;

  // ── 단일 진입 / 스케일 진입 (2026-09-27 사용자 요청) ──────────────────────
  //
  // 박스의 `layers`가 2 이상이면 스케일이다. **박스에 담는** 이유: 차트가 그 값을 보고
  // 층 선을 그리고, 새로고침해도 유지되고, 롱·숏이 서로 다른 층수를 가질 수 있다.
  //
  // ⚠ 스케일은 **지정가뿐이다.** 시장가로 여러 층을 낸다는 것은 "지금 가격에 N번 산다"는
  //   뜻이라 층을 나눈 의미가 없다. 그래서 스케일을 고르면 지정가/시장가 선택을 감춘다.
  // ⚠ 아래 정보 줄(수량·예상 손실·예상 수익)은 스케일이면 **전부 체결됐을 때**를 기준으로
  //   한다. 손절에 닿으려면 모든 층을 지나쳐야 하므로, 손절 손실은 늘 이 값이다
  const isScale   = (drawing.layers ?? 1) >= 2;
  const scalePlan = isScale ? scale?.plan : null;
  // 기준가 — 스케일은 전부 체결 시 평단이다. R:R도 이 값으로 잰다
  const refPrice  = scalePlan ? scalePlan.avgEntry : drawing.entry;
  const effQty    = scalePlan ? scalePlan.totalQty : posCalc?.actualQty;

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
          /* ⚠ 스케일이면 **평단 기준**으로 잰다. 박스의 진입선으로 재면 손익비가 실제보다
                나쁘게 보인다 — 층이 아래로 퍼져 평단이 익절선에 가까워지기 때문이다 */
          ["손익비 R:R", `1 : ${calcRR(refPrice, drawing.tp, drawing.sl, drawing.isLong, qTick)}`,                        "#a78bfa"],
          ["수량",       effQty ? qtyLabel(effQty, qStep, qBase) : "—",                                              "#94a3b8"],
          ["포지션 USD", effQty ? fmtI(effQty * refPrice) : "—",                                                     "#94a3b8"],
          ["예상 손실",  effQty ? `-${fmt(effQty * Math.abs(refPrice - drawing.sl))}` : "—",                         "#f6465d"],
          ["예상 수익",  effQty ? `+${fmt(effQty * Math.abs(drawing.tp - refPrice))}` : "—",                         "#0ecb81"],
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
          {/* 진입 방식 — 단일 / 스케일. ⚠ 버튼을 사이드바에 따로 두지 않는다
              (2026-09-27 사용자 확정): 박스는 같은 것이고 "어떻게 들어갈지"만 다르므로,
              그리고 나서 정할 수 있어야 한다. 지정가/시장가 선택과 같은 자리다 */}
          <div style={{ display:"flex", gap:"6px", marginBottom:"6px" }}>
            {[[false, "단일"], [true, "스케일"]].map(([v, label]) => (
              <button key={label} onClick={() => onSetLayers?.(v ? (scale?.count ?? 4) : 1)} style={{
                flex:1, padding:"7px 0", borderRadius:"5px", cursor:"pointer",
                fontSize:"12px", fontFamily:"inherit", fontWeight:"600",
                background: isScale === v ? color : "transparent",
                border:`1px solid ${isScale === v ? color : theme.borderSec}`,
                color: isScale === v ? "#000" : theme.textMuted,
                transition:"all 0.15s",
              }}>{label}</button>
            ))}
          </div>

          {isScale && scale?.maxLayers < 2 && (
            <div style={{ marginBottom:"6px", padding:"8px 10px", background:theme.bgWarning,
              border:"1px solid #f0b90b33", borderRadius:"5px", fontSize:"12px", lineHeight:"1.7" }}>
              <span style={{ color:"#f0b90b", fontWeight:"700" }}>⚠ 층을 나눌 수 없습니다</span>
              <span style={{ color:theme.textMuted }}> — 층 하나가 거래소 최소 주문 금액을 못 넘습니다. 단일로 진입하세요</span>
            </div>
          )}
          {isScale && scale?.maxLayers >= 2 && (
            <div style={{ marginBottom:"6px", padding:"8px 10px",
              border:`1px solid ${color}33`, borderRadius:"5px" }}>
              {/* 층 개수 — 최대값은 **거래소 최소 금액 때문에 실제로 낼 수 있는 층수**다.
                  낼 수 없는 숫자를 애초에 못 넣게 해서 "층이 많으면 거절된다"를 없앤다 */}
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"4px" }}>
                <span style={{ fontSize:"12px", color:theme.textMuted }}>층 개수</span>
                <span style={{ fontSize:"14px", color, fontWeight:"700" }}>
                  {scale?.count ?? "—"}
                  {scale?.maxLayers > 0 && (
                    <span style={{ fontSize:"11px", color:theme.textFaint, fontWeight:"400", marginLeft:"5px" }}>
                      / 최대 {scale.maxLayers}
                    </span>
                  )}
                </span>
              </div>
              <input
                type="range" min={2} max={Math.max(2, scale?.maxLayers ?? 2)} step={1}
                value={scale?.count ?? 2}
                onChange={e => onSetLayers?.(Number(e.target.value))}
                style={{ width:"100%", accentColor:color, cursor:"pointer", height:"3px" }}
              />
              {/* ⚠ **두 줄을 같이 보여준다** (2026-09-27 사용자 요청). 손절에 닿으려면 모든
                  층을 지나쳐야 하므로 **손실은 늘 `전부 체결`** 값이고, 익절은 부분일 수 있다.
                  그 비대칭이 숫자로 읽혀야 층수를 정할 수 있다 */}
              {scale?.preview && [
                ["전부 체결", scale.preview.full],
                ["절반 체결", scale.preview.half],
              ].map(([label, r]) => (
                <div key={label} style={{ display:"flex", justifyContent:"space-between",
                  fontSize:"11px", marginTop:"5px", color:theme.textMuted }}>
                  <span>{label}</span>
                  <span style={{ color:theme.textSec ?? theme.textMuted }}>
                    {qtyLabel(r.qty, qStep, qBase)} · 평단 {fmt(r.avgEntry)} · 증거금 {fmtI(r.margin)}
                  </span>
                </div>
              ))}
              {!scalePlan && (
                <div style={{ fontSize:"11px", color:"#f6465d", marginTop:"5px" }}>
                  이 층수로는 주문을 낼 수 없습니다 — 층을 줄이세요
                </div>
              )}
            </div>
          )}

          {/* 지정가/시장가 — 스케일은 지정가뿐이라 감춘다 (위 isScale 주석) */}
          {!isScale && <div style={{ display:"flex", gap:"6px", marginBottom:"6px" }}>
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
          </div>}
          {!isScale && orderType === "MARKET" && (
            <div style={{ marginBottom:"6px", padding:"8px 10px", background:theme.bgMarket,
              border:"1px solid #f6465d33", borderRadius:"5px", fontSize:"12px", lineHeight:"1.7" }}>
              <span style={{ color:"#f6465d", fontWeight:"700" }}>⚠ 시장가 주의</span>
              <span style={{ color:theme.textMuted }}> — 즉시 체결, 슬리피지 발생 가능</span>
            </div>
          )}
          <div style={{ display:"flex", gap:"6px" }}>
            <button onClick={onCancel} style={{
              flex:1, padding:"10px 0", borderRadius:"5px", cursor:"pointer",
              background:"transparent", border:`1px solid ${theme.borderSec}`,
              color:theme.textMuted, fontSize:"13px", fontFamily:"inherit",
            }}>취소</button>
            {(() => {
              // 스케일이면 층 계획이 만들어졌을 때만 누를 수 있다
              const ready = isScale ? !!scalePlan : !!posCalc;
              const run = () => (isScale ? onScaleConfirm?.() : onConfirm(orderType));
              return (
                <button onClick={run} disabled={!ready} style={{
                  flex:2, padding:"10px 0", borderRadius:"5px",
                  cursor: ready ? "pointer" : "not-allowed",
                  background: ready ? color : "#1f2937",
                  border:"none", color: ready ? "#000" : "#374151",
                  fontSize:"14px", fontFamily:"inherit", fontWeight:"700",
                  transition:"all 0.15s",
                }}>
                  {/* ⚠ 문구는 단일·스케일이 **같다** (2026-09-27 사용자 요청) —
                      층수를 여기 적지 말 것. 층수는 바로 위 슬라이더가 이미 보여준다 */}
                  {drawing.isLong ? "▲ LONG 실행" : "▼ SHORT 실행"}
                </button>
              );
            })()}
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
