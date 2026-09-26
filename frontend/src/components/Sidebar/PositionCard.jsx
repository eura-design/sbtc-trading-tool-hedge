import * as d3 from "d3";
import { useState } from "react";
import { useTheme } from "../../ThemeContext";
import { useAccordion } from "../../hooks/useAccordion";
import { ScaleInCard } from "./ScaleInCard";
import { SplitTPCard } from "./SplitTPCard";
import { SplitSLCard } from "./SplitSLCard";
import { unrealizedFor } from "../../utils/equity";
import { fmtQty, floorQty, qtyLabel } from "../../utils/qty";
import { fmtPriceUsd } from "../../utils/price";
import { useStore } from "../../store";
import { CONFIRM_ROW, primaryBtn, ghostBtn, actionBtn, SECTION_HEADER, headerArrow } from "../sidebarBtn";
import { lsGet, lsSet } from "../../utils/storage";

function AccordionSection({ label, badge, isOpen, onToggle, theme, posColor, children }) {
  return (
    <>
      <button
        onClick={onToggle}
        style={{
          width:"100%", display:"flex", justifyContent:"space-between", alignItems:"center",
          padding:"8px 0 6px", background:"transparent", border:"none", cursor:"pointer",
          borderTop:`1px solid ${theme.border}`,
        }}
      >
        <span style={{ fontSize:"12px", color:theme.textMuted, fontWeight:"600", letterSpacing:"0.05em" }}>
          {label}
          {badge != null && badge > 0 && (
            <span style={{
              marginLeft:"6px", fontSize:"10px", fontWeight:"700",
              color:"#60a5fa", background:"#60a5fa22",
              padding:"1px 5px", borderRadius:"8px",
            }}>{badge}</span>
          )}
        </span>
        <span style={headerArrow(theme)}>{isOpen ? "▲" : "▼"}</span>
      </button>
      {isOpen && (
        <div style={{ paddingTop:"8px" }}>
          {children}
        </div>
      )}
    </>
  );
}

// 하늘색 = **여기서는 주문할 수 없다** (2026-09-26 사용자 요청).
//
// 다른 코인의 포지션 카드에 쓴다. 롱·숏을 색으로 가르지 않는 것이 요점이다 —
// 초록·빨강은 "이 카드로 주문할 수 있다"는 뜻으로 남긴다.
//
// ⚠ `#60a5fa`를 쓰지 말 것. 이 시스템에서 그 색은 이미 **"지금 켜져 있다"**는 뜻이고
//   (sidebarBtn.js의 SECTION_OPEN_COLOR·상단 바 모드 버튼), 카드 안쪽 청산 버튼과
//   개수 배지도 그 색이라 카드 전체를 그 색으로 두면 구분이 흐려진다
const READ_ONLY_COLOR = "#38bdf8";

/**
 * @param readOnly 하늘색 읽기 전용 카드인가 (= 지금 보고 있는 코인이 아니다).
 *   ⚠ 주문 아코디언 넷을 **그리지 않는다** — 회색으로 비활성만 하면 안 된다.
 *     `api/client.js`가 모든 주문 요청에 **화면 심볼**을 싣기 때문에, 다른 코인 카드의
 *     버튼이 한 번이라도 눌리면 그 요청은 **지금 보고 있는 코인으로 나간다.**
 *     아무 일도 안 일어나는 게 아니라 엉뚱한 코인이 청산된다
 * @param symbol 이 카드의 심볼. 하늘색 카드에서 `차트 보기`가 넘겨줄 값이다
 * @param filters 이 심볼의 호가·수량 단위. 안 주면 스토어의 것(= 지금 보는 심볼)을 쓴다
 * @param onPickSymbol 하늘색 카드의 `차트 보기` — 그 코인으로 화면을 옮긴다
 */
export function PositionCard({
  posData, side, tpsl, tpslSaving, onClose, lastPrice,
  scaleInOrders, onScaleIn, onCancelScaleIn,
  onCancelSplitTp, onCancelPartialSl,
  symbol, readOnly = false, filters, onPickSymbol,
}) {
  const { theme } = useTheme();
  // 수량 자릿수와 코인 이름은 심볼마다 다르다 (SOL 0.01 / DOGE 1)
  // ⚠ 하늘색 카드는 **자기 심볼의 단위**를 인자로 받는다. 스토어에는 지금 보는 심볼의
  //   단위만 있어서, 그걸 그대로 쓰면 DOGE 청산가가 `$0`으로 보인다
  const storeFilters = useStore(s => s.symbolFilters);
  const { step: qStep, base: qBase, tick: qTick } = filters ?? storeFilters;
  const [closePct, setClosePct] = useState(() => Number(lsGet("closePct")) || 100);
  const handleClosePct = v => { setClosePct(v); lsSet("closePct", v); };
  const [confirming, setConfirming] = useState(false);
  // ⚠ 세 아코디언(시장가 청산·추가 진입·분할 TP)은 **한 번에 하나만 열린다**
  //   (2026-08-22 사용자 요청). 열린 것을 상태 하나로 들고 있으므로 다른 것을 열면
  //   이전 것은 자동으로 닫힌다 — 불리언 셋으로 되돌리지 말 것.
  //   같은 것을 다시 누르면 닫힌다(null). 카드 단위라 LONG·SHORT는 서로 독립이다
  const [openSection, setOpenSection] = useState(null);   // "close" | "scaleIn" | "splitTP" | "splitSL" | null
  const scaleInOpen = openSection === "scaleIn";
  const splitTPOpen = openSection === "splitTP";
  const splitSLOpen = openSection === "splitSL";
  const closeOpen   = openSection === "close";
  // ⚠ 접은 상태의 저장 키는 **하늘색 카드만 심볼을 포함한다.** 안 그러면 비트코인 롱
  //   카드를 접었을 때 이더리움 롱 카드도 같이 접힌다.
  //   보고 있는 코인의 카드는 예전 키를 그대로 쓴다 — 바꾸면 이미 저장된 접기 설정이
  //   한 번 초기화된다.
  // ⚠ **기본값이 카드 종류마다 다르다** (2026-09-27 사용자 요청):
  //   하늘색은 펼침(그래야 목록으로 읽힌다) · 일반은 접힘.
  //   그리고 **코인을 바꾸면 일반 카드는 늘 접힌 상태로 돌아온다** — 그 일은 두 곳이
  //   나눠 한다: `settingsSlice.setSymbol`이 저장값을 접힘으로 적고, `SidebarPanel`이
  //   `key={symbol}`로 카드를 새로 만들어 그 값을 다시 읽게 한다.
  //   ⚠ 한쪽만 있으면 안 된다 — 저장값만 바꾸면 이미 떠 있는 카드가 그대로 펼쳐져 있고
  //     (`useAccordion`은 처음 뜰 때 한 번만 읽는다), 새로 만들기만 하면 지난번 펼침을
  //     다시 읽어 온다
  const [expanded, toggleExpanded] = useAccordion(
    readOnly ? `accordion_pos_${symbol}_${side}` : `accordion_pos_${side}`, readOnly);
  // 어느 쪽으로 옮겨 가든 청산 확인 단계는 푼다 — 접힌 채로 `✓ 확인`이 남아 있으면
  // 다시 펼쳤을 때 한 번 클릭으로 시장가 청산이 나간다
  const openOnly        = (k) => { setOpenSection(v => (v === k ? null : k)); setConfirming(false); };
  const toggleScaleIn   = () => openOnly("scaleIn");
  const toggleSplitTP   = () => openOnly("splitTP");
  const toggleSplitSL   = () => openOnly("splitSL");
  const toggleClose     = () => openOnly("close");

  if (!posData) return null;

  // ⚠ 음수는 **`-$1,202.59`**다 — `$-1,202.59`가 아니다 (2026-08-22 사용자 지적).
  //   d3 포맷은 부호를 숫자 앞에 붙이므로 `$` + `-1,202.59`가 되어 달러 기호와 마이너스가
  //   뒤집힌다. 부호를 밖으로 빼고 절댓값을 넣는다 (ReplayStatsCard·StatsCard와 같은 방식).
  //   ※ 부르는 쪽이 양수에 `+`를 덧붙인다 — 여기서 `+`까지 붙이면 `++$x`가 된다
  // ⚠ **가격과 돈을 나눈다** (2026-09-02). 둘 다 `,.0f`였는데, 가격은 코인마다
  //   자릿수가 달라야 하고(DOGE 0.2가 `$0`이 됐다) 돈(USDT)은 정수로 보는 게 맞다.
  //   `fmtMoney`를 가격에 쓰지 말 것 — 그게 원래 버그였다
  const fmtP    = p => fmtPriceUsd(p, qTick);
  const fmtI = p => `${p < 0 ? "-" : ""}$${d3.format(",.0f")(Math.abs(p))}`;
  const fmt  = p => `${p < 0 ? "-" : ""}$${d3.format(",.2f")(Math.abs(p))}`;

  const isLong     = side === "LONG";
  // 이 한 값이 테두리·왼쪽 굵은 선·아코디언 강조·슬라이더·버튼 색을 전부 정한다
  const posColor   = readOnly ? READ_ONLY_COLOR : isLong ? "#0ecb81" : "#f6465d";
  const tpPrice    = tpsl.tp?.price ?? null;
  const slPrice    = tpsl.sl?.price ?? null;
  const slInProfit = slPrice !== null && (isLong ? slPrice >= posData.entryPrice : slPrice <= posData.entryPrice);
  const rrVal      = (tpPrice && slPrice)
    ? slInProfit ? "∞"
    : (Math.abs(tpPrice - posData.entryPrice) / Math.abs(slPrice - posData.entryPrice)).toFixed(2)
    : null;
  const slPnl = slPrice
    ? posData.size * (isLong ? slPrice - posData.entryPrice : posData.entryPrice - slPrice)
    : null;
  // ⚠ 식은 `utils/equity.js` 하나가 갖는다 (2026-08-22) — 잔고 카드의 `총자산`이
  //   같은 값에서 나와야 한다. 여기 인라인으로 되돌리면 한 화면의 두 숫자가 조용히 갈린다
  const realTimeUnrealized = unrealizedFor(posData, lastPrice, isLong);

  const closeQty = floorQty(posData.size * closePct / 100, qStep);
  const splitTpCount = tpsl?.splitTps?.length ?? 0;
  const partialSlCount = tpsl?.partialSls?.length ?? 0;

  return (
    <div style={{
      marginBottom:"12px", padding:"10px",
      border:`1px solid ${posColor}33`, borderLeft:`2px solid ${posColor}`,
      borderRadius:"5px",
    }}>
      {/* 포지션 헤더 — 클릭으로 접기/펼치기 */}
      <button
        onClick={toggleExpanded}
        style={{ ...SECTION_HEADER, marginBottom: expanded ? "8px" : 0 }}
      >
        <span style={{ fontSize:"13px", color:posColor, fontWeight:"700", lineHeight:"1" }}>
          {/* ⚠ 코인 이름을 **두 종류 카드 모두** 적는다 (2026-09-26 사용자 요청).
              카드가 여러 개 늘어서므로, 어느 코인 것인지가 제목에 없으면 읽을 수 없다 */}
          {isLong ? "▲ LONG" : "▼ SHORT"} 포지션{qBase ? ` (${qBase})` : ""}
        </span>
        <span style={headerArrow(theme)}>{expanded ? "▲" : "▼"}</span>
      </button>

      {expanded && <>
      {/* 포지션 정보 rows */}
      {[
        ["청산가",     posData.liquidationPrice ? fmtP(posData.liquidationPrice) : "—",                     "#ff4444"],
        ["손익비 R:R", rrVal ? `1 : ${rrVal}` : "—",                                                        "#a78bfa"],
        ["수량",       qtyLabel(posData.size, qStep, qBase),                                                 "#94a3b8"],
        ["포지션 USD", fmtI(posData.size * posData.entryPrice),                                              "#94a3b8"],
        ["예상 손실",  slPnl !== null ? `${slPnl >= 0 ? "+" : ""}${fmt(slPnl)}` : "—",                      slPnl !== null && slPnl >= 0 ? "#0ecb81" : "#f6465d"],
        ["예상 수익",  tpPrice ? `+${fmt(posData.size * Math.abs(tpPrice - posData.entryPrice))}` : "—",    "#0ecb81"],
        ["미실현",     `${realTimeUnrealized >= 0 ? "+" : ""}${fmt(realTimeUnrealized)}`,                   realTimeUnrealized >= 0 ? "#0ecb81" : "#f6465d"],
      ].map(([l, v, c]) => (
        <div key={l} style={{ display:"flex", justifyContent:"space-between",
          padding:"3px 0", borderBottom:`1px solid ${theme.border}` }}>
          <span style={{ fontSize:"12px", color:theme.textMuted }}>{l}</span>
          <span style={{ fontSize:"13px", color:c, fontWeight:"600" }}>{v}</span>
        </div>
      ))}

      {/* 주문 아코디언 넷 — **하늘색 카드에는 아예 그리지 않는다** (위 readOnly 주석) */}
      {!readOnly && <>
      {/* 아코디언: 시장가 청산 */}
      <AccordionSection
        label="시장가 청산"
        isOpen={closeOpen}
        onToggle={toggleClose}
        theme={theme}
        posColor={posColor}
      >
        <div style={{ display:"flex", flexDirection:"column", gap:"6px" }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
            <span style={{ fontSize:"12px", color:theme.textMuted, letterSpacing:"0.06em" }}>청산 비율</span>
            <span style={{ fontSize:"15px", color:posColor, fontWeight:"700" }}>
              {closePct}%
              <span style={{ fontSize:"11px", color:theme.textMuted, fontWeight:"400", marginLeft:"6px" }}>
                ({fmtQty(closeQty, qStep)} {qBase})
              </span>
            </span>
          </div>
          {/* ⚠ **1% 단위, 최소 1%** (2026-08-25 사용자 요청 — 5%에서 내렸다).
              카드 안 네 슬라이더(청산·추가 진입·분할 TP·분할 SL)는 성격이 같아서
              단위가 갈리면 안 된다 — 나머지 셋은 `cardControls.PercentSlider`가 갖는다.
              한쪽만 5로 되돌리지 말 것 */}
          <input
            type="range" min={0} max={100} step={1} value={closePct}
            onChange={e => { handleClosePct(Math.max(1, Number(e.target.value))); setConfirming(false); }}
            style={{ width:"100%", accentColor:posColor, cursor:"pointer", height:"3px" }}
          />
          <div style={{ display:"flex", justifyContent:"space-between", fontSize:"11px", color:theme.textBare }}>
            <span>0%</span><span>100%</span>
          </div>
          {/* ⚠ 세 버튼(`청산` / `✓ 확인` / `✕ 취소`)은 **`lineHeight:"1"`을 명시한다**
              (2026-08-22 사용자 지적). 패딩·테두리·글자크기가 전부 같았는데도
              청산 36px / 확인·취소 39px로 **3px 달람다**: `✓`(U+2713)·`✕`(U+2715)가
              이 앱 폰트 스택(JetBrains Mono)에 없어 **OS 폴백 폰트**가 그리고,
              그 폰트의 줄 높이가 더 커서 박스까지 밀어 올렸다
              (ReplayBar 일시정지 글리프와 같은 원인 — 그쪽 주석 참고).
              줄 높이를 1로 못박으면 글자 메트릭이 바뀔 때마다 높이가 달라진다.
              결과는 세 버튼 모두 33px — 예전 36px보다 살짝 낮다(같은 날 요청) */}
          {confirming ? (
            <div style={CONFIRM_ROW}>
              <button
                onClick={() => { setConfirming(false); onClose(side, closeQty, closePct < 100); }}
                style={primaryBtn(theme, "#60a5fa")}
              >✓ 확인</button>
              <button
                onClick={() => setConfirming(false)}
                style={ghostBtn(theme)}
              >✕ 취소</button>
            </div>
          ) : (
            <button
              onClick={() => setConfirming(true)}
              style={actionBtn(theme, "#60a5fa")}
              onMouseEnter={e => { e.currentTarget.style.background="#60a5fa22"; }}
              onMouseLeave={e => { e.currentTarget.style.background="transparent"; }}
            >
              청산 {closePct === 100 ? "(전체)" : `(${closePct}%)`}
            </button>
          )}
        </div>
      </AccordionSection>

      {tpslSaving && (
        <div style={{ marginTop:"8px", padding:"8px 10px", background:theme.bgWarning,
          border:"1px solid #f0b90b33", borderRadius:"5px",
          fontSize:"12px", color:"#f0b90b", textAlign:"center" }}>
          ⏳ TP/SL 수정 중...
        </div>
      )}

      {/* 아코디언: 추가 진입 */}
      <AccordionSection
        label="추가 진입"
        badge={scaleInOrders?.length}
        isOpen={scaleInOpen}
        onToggle={toggleScaleIn}
        theme={theme}
        posColor={posColor}
      >
        <ScaleInCard
          embedded
          posData={posData}
          side={side}
          lastPrice={lastPrice}
          onScaleIn={onScaleIn}
          scaleInOrders={scaleInOrders}
          onCancelScaleIn={onCancelScaleIn}
        />
      </AccordionSection>

      {/* 아코디언: 분할 TP */}
      <AccordionSection
        label="분할 TP"
        badge={splitTpCount}
        isOpen={splitTPOpen}
        onToggle={toggleSplitTP}
        theme={theme}
        posColor={posColor}
      >
        {/* ⚠ **`등록 시 단일 TP 취소됨` 문구는 2026-08-23 제거됐다.**
            그날 단일 TP ↔ 분할 TP 배타 규칙을 없애 **둘이 공존한다** — 틀린 말이 된다.
            ⚠ **여기와 `SplitTPCard`에 같은 문구가 두 벌 있었다** (embedded일 때는 이쪽,
              아닐 때는 저쪽). 한쪽만 지우면 화면에 그대로 남는다 — 실제로 그랬다 */}
        <SplitTPCard
          embedded
          posData={posData}
          side={side}
          tpsl={tpsl}
          onCancelSplitTp={onCancelSplitTp}
        />
      </AccordionSection>

      {/* 아코디언: 분할 SL — 분할 TP의 손절 쪽 짝 (2026-08-24)
          ⚠ 넷이 **한 번에 하나만 열린다** (openSection 하나로 관리) */}
      <AccordionSection
        label="분할 SL"
        badge={partialSlCount}
        isOpen={splitSLOpen}
        onToggle={toggleSplitSL}
        theme={theme}
        posColor={posColor}
      >
        <SplitSLCard
          embedded
          posData={posData}
          side={side}
          tpsl={tpsl}
          onCancelPartialSl={onCancelPartialSl}
        />
      </AccordionSection>
      </>}

      {/* 하늘색 카드에만 있는 버튼. 누르면 그 코인 차트로 옮겨 가고, 이 카드가
          초록·빨강으로 돌아와 주문까지 맡는다 (= 보고 있는 차트에서만 매매한다).
          ⚠ 카드 전체 클릭으로 바꾸지 말 것 — 제목 줄이 이미 접기/펼치기 버튼이고,
            심볼 전환은 차트 축·도형·플랜 박스를 다시 읽는 무거운 동작이라
            접으려다 눌리면 안 된다 */}
      {readOnly && (
        <button
          onClick={() => onPickSymbol?.(symbol)}
          style={{ ...actionBtn(theme, READ_ONLY_COLOR), marginTop: "10px" }}
          onMouseEnter={e => { e.currentTarget.style.background = `${READ_ONLY_COLOR}22`; }}
          onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
        >차트 보기</button>
      )}
      </>}
    </div>
  );
}

