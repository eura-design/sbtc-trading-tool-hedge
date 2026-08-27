import { useState, useCallback, useEffect } from "react";
import { useTheme } from "../../ThemeContext";
import { actionBtn } from "../sidebarBtn";
import { lsGet, lsSet } from "../../utils/storage";
import { useStore } from "../../store";
import { maxSplitCount } from "../../utils/splitLevels";

// localStorage에 영속화되는 숫자 state — 추가진입/분할TP/분할SL 카드가 공유한다.
// 비율(%)과 **분할 개수** 둘 다 이걸 쓴다 (그래서 이름이 Pct가 아니다)
export function usePersistedNum(storageKey, defaultValue) {
  const [v, setState] = useState(() => Number(lsGet(storageKey)) || defaultValue);
  const set = useCallback((next) => {
    setState(next);
    lsSet(storageKey, next);
  }, [storageKey]);
  return [v, set];
}

// 0~100% 슬라이더 (**1% 단위, 최소 1%**) + 상단 라벨/값 + 하단 0~100 가이드
//
// ⚠ 2026-08-25 사용자 요청으로 5% → **1%**로 바꿨다 (추가 진입·분할 TP·분할 SL 공용).
//   포지션 카드의 `청산 비율` 슬라이더도 **같이** 바꿨다 — 카드 안 네 슬라이더는
//   성격이 같아서 단위가 갈리면 안 된다 (`PositionCard.jsx`).
//   ⚠ 하한도 5 → **1**이다. step만 1로 내리고 `Math.max(5, …)`를 두면 1~4%가
//     **끌리는데 선택되지 않는 죽은 구간**이 된다 (하한이 5였던 건 그때 최소 눈금이
//     5였기 때문이지, 5% 미만을 막으려던 게 아니다)
export function PercentSlider({ pct, onChange, color, label, secondaryText }) {
  const { theme } = useTheme();
  return (
    <div style={{ marginBottom: "6px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
        <span style={{ fontSize: "11px", color: theme.textMuted }}>{label}</span>
        <span style={{ fontSize: "12px", color, fontWeight: "600" }}>{secondaryText}</span>
      </div>
      <input
        type="range" min={0} max={100} step={1} value={pct}
        onChange={e => onChange(Math.max(1, Number(e.target.value)))}
        style={{ width: "100%", accentColor: color, cursor: "pointer", height: "3px" }}
      />
      <div style={{ display: "flex", justifyContent: "space-between",
        fontSize: "11px", color: theme.textBare, marginTop: "2px" }}>
        <span>0%</span><span>100%</span>
      </div>
    </div>
  );
}

// 분할 개수 슬라이더 — **상한은 총 수량이 정한다** (utils/splitLevels.maxSplitCount).
//
// ⚠ 상한을 안 묶으면 0.002 BTC를 5분할하는 설정을 만들 수 있고, 그때 뒤쪽 셋은
//   수량 0이라 조용히 빠진다 — 화면엔 5개라고 적혀 있는데 실제로는 2개만 나간다
// ⚠ 고를 게 하나뿐이면(총 수량이 최소 단위 한 칸) **아예 그리지 않는다.**
//   끌리는데 값이 안 변하는 죽은 컨트롤을 남기지 않는다는 이 앱의 규칙과 같다
//   (PercentSlider의 1~4% 죽은 구간 주석 참고)
export function CountSlider({ count, onChange, qty, color }) {
  const { theme } = useTheme();
  const max = maxSplitCount(qty);
  if (max <= 1) return null;
  return (
    <div style={{ marginBottom: "6px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
        <span style={{ fontSize: "11px", color: theme.textMuted }}>분할 개수</span>
        <span style={{ fontSize: "12px", color, fontWeight: "600" }}>{Math.min(count, max)}</span>
      </div>
      <input
        type="range" min={1} max={max} step={1} value={Math.min(count, max)}
        onChange={e => onChange(Number(e.target.value))}
        style={{ width: "100%", accentColor: color, cursor: "pointer", height: "3px" }}
      />
    </div>
  );
}

/**
 * `차트에서 지정` 모드의 on/off — 켜져 있는 동안 스토어의 `orderPick`을 들고 있는다.
 *
 * ⚠ **슬라이더를 움직이면 켜져 있는 모드의 값도 따라가야 한다.** 버튼을 누른 시점의
 *   개수·수량으로 굳어 버리면, 켜 둔 채로 슬라이더를 만지고 차트를 눌렀을 때
 *   화면에 보이는 값과 **다른 주문이 나간다**
 * ⚠ 카드가 사라지면(아코디언을 닫거나 포지션이 없어지면) **스스로 끈다.**
 *   안 끄면 차트만 주문 모드로 남아, 화면 어디에도 켜져 있다는 표시가 없는 채로
 *   다음 클릭이 실주문이 된다
 */
export function useChartPick({ kind, side, count, qty }) {
  const orderPick    = useStore(s => s.orderPick);
  const setOrderPick = useStore(s => s.setOrderPick);
  const active = orderPick?.kind === kind && orderPick?.side === side;

  useEffect(() => {
    if (active) setOrderPick({ kind, side, count, qty });
  }, [active, kind, side, count, qty, setOrderPick]);

  useEffect(() => () => {
    const cur = useStore.getState().orderPick;
    if (cur?.kind === kind && cur?.side === side) useStore.getState().setOrderPick(null);
  }, [kind, side]);

  return { active, toggle: () => setOrderPick(active ? null : { kind, side, count, qty }) };
}

// `차트에서 지정` 버튼 + 켜져 있을 때의 조작 안내 한 줄
export function ChartPickButton({ active, onToggle, disabled, color, count, qty }) {
  const { theme } = useTheme();
  const n = Math.min(count, maxSplitCount(qty));
  return (
    <>
      <button
        disabled={disabled}
        onClick={onToggle}
        style={{
          ...actionBtn(theme, color, disabled),
          background: active ? `${color}22` : "transparent",
          borderStyle: active ? "solid" : "dashed",
        }}
      >
        차트에서 지정
      </button>
      {active && (
        <div style={{ fontSize: "10px", color: theme.textFaint,
          textAlign: "center", marginTop: "4px" }}>
          클릭 1개 · 세로 드래그 {n}개
        </div>
      )}
    </>
  );
}

// 외곽선 + 색상 토큰 + 호버 강조 — 사이드바 액션 카드의 제출 버튼
export function SubmitButton({ disabled, onClick, color, children }) {
  const { theme } = useTheme();
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      style={actionBtn(theme, color, disabled)}
      onMouseEnter={e => { if (!disabled) e.currentTarget.style.background = `${color}22`; }}
      onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
    >
      {children}
    </button>
  );
}

// embedded=true면 children만 반환, false면 카드 래퍼로 감쌈
export function CardWrapper({ embedded, title, extra, children }) {
  const { theme } = useTheme();
  if (embedded) return children;
  return (
    <div style={{ padding: "10px", border: `1px solid ${theme.borderSec}`,
      borderRadius: "5px", marginBottom: "10px" }}>
      <div style={{ fontSize: "12px", color: theme.textMuted, fontWeight: "600",
        letterSpacing: "0.05em", marginBottom: "8px" }}>
        {title}
        {extra}
      </div>
      {children}
    </div>
  );
}
