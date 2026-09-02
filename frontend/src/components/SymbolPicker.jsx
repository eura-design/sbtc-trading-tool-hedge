import { useState, useRef, useEffect, useMemo } from "react";
import { useTheme } from "../ThemeContext";

// 심볼 선택기 — 상단바 왼쪽 (2026-09-02)
//
// 목록은 백엔드가 바이낸스 `exchangeInfo`에서 받아 준다 (`GET /api/symbols`,
// USDT 무기한 + 거래 중만, 실측 526개). **하드코딩한 목록이 없다** — 코인을 늘릴 때
// 손댈 곳이 없다는 게 이 방식의 요점이다.
//
// ⚠ 500개를 그냥 뿌리지 않는다. 타이핑으로 좁히고, 아무것도 안 쳤을 때는
//   **거래량이 아니라 이름순 상위 몇 개**만 보여준다 — 거래량은 이 목록에 없고,
//   그것만 받으려고 요청을 하나 더 늘릴 만큼 중요하지 않다.
// ⚠ 목록을 못 받았으면(`symbols`가 비었으면) **버튼이 죽는다.** 규칙을 모르는 채로
//   심볼을 바꾸면 수량 계산이 BTC 단위로 돌아가 화면 숫자가 조용히 틀린다
//   (`useSymbolFilters`의 `ready` 주석과 같은 이유).
//
// ⚠ **리플레이 중에는 바꿀 수 없다.** 재생 중에 심볼이 바뀌면 그 구간의 캔들·페이퍼
//   장부·도형이 전부 어긋난다. 연습을 끝내고 바꾸는 것이 맞다

const MAX_ROWS = 60;

export function SymbolPicker({ symbol, symbols, onChange, disabled, disabledReason }) {
  const { theme } = useTheme();
  const [open, setOpen] = useState(false);
  const [q, setQ]       = useState("");
  const boxRef   = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDown = e => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    const onKey  = e => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    // 열자마자 바로 칠 수 있게 — 500개를 스크롤로 찾게 두지 않는다
    inputRef.current?.focus();
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const list = useMemo(() => {
    const needle = q.trim().toUpperCase();
    const pool = needle ? symbols.filter(s => s.symbol.includes(needle)) : symbols;
    // 친 글자로 **시작하는** 것을 위로 (ETH를 치면 ETHUSDT가 1000ETHFIUSDT보다 먼저)
    const ranked = needle
      ? [...pool].sort((a, b) => (b.symbol.startsWith(needle) - a.symbol.startsWith(needle))
                              || a.symbol.localeCompare(b.symbol))
      : pool;
    return ranked.slice(0, MAX_ROWS);
  }, [symbols, q]);

  const base = symbols.find(s => s.symbol === symbol)?.baseAsset
    ?? symbol.replace(/USDT$/, "");

  const pick = (s) => { onChange(s); setOpen(false); setQ(""); };

  return (
    <div ref={boxRef} style={{ position: "relative", flexShrink: 0 }}>
      <button
        onClick={() => !disabled && setOpen(o => !o)}
        disabled={disabled}
        title={disabled ? (disabledReason ?? "지금은 바꿀 수 없습니다") : "심볼 변경"}
        style={{
          display: "flex", alignItems: "center", gap: 5,
          height: 22, padding: "0 8px", borderRadius: 3,
          border: `1px solid ${open ? "#f0b90b" : theme.borderSec}`,
          background: "transparent", fontFamily: "inherit",
          cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.45 : 1,
          whiteSpace: "nowrap",
        }}
      >
        <span style={{ fontSize: 14, fontWeight: 700, color: "#f7931a" }}>{base}/USDT</span>
        <span style={{ fontSize: 9, color: theme.textMuted }}>{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div style={{
          position: "absolute", top: 26, left: 0, zIndex: 1000,
          width: 210, background: theme.bgCard,
          border: `1px solid ${theme.borderSec}`, borderRadius: 6,
          boxShadow: "0 4px 16px rgba(0,0,0,0.4)", overflow: "hidden",
        }}>
          <input
            ref={inputRef}
            value={q}
            onChange={e => setQ(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && list[0]) pick(list[0].symbol); }}
            placeholder="심볼 검색 (예: ETH)"
            style={{
              width: "100%", boxSizing: "border-box", padding: "6px 8px",
              border: "none", borderBottom: `1px solid ${theme.borderSec}`,
              background: theme.bgCardAlt, color: theme.textPrimary,
              fontSize: 12, fontFamily: "inherit", outline: "none",
            }}
          />
          <div style={{ maxHeight: 260, overflowY: "auto" }}>
            {list.map(s => {
              const on = s.symbol === symbol;
              return (
                <div
                  key={s.symbol}
                  onClick={() => pick(s.symbol)}
                  style={{
                    display: "flex", justifyContent: "space-between", alignItems: "center",
                    padding: "5px 8px", cursor: "pointer", fontSize: 12,
                    color: on ? "#f0b90b" : theme.textPrimary,
                    fontWeight: on ? 700 : 400,
                    background: on ? theme.border : "transparent",
                  }}
                  onMouseEnter={e => { if (!on) e.currentTarget.style.background = theme.borderSec; }}
                  onMouseLeave={e => { if (!on) e.currentTarget.style.background = "transparent"; }}
                >
                  <span>{s.baseAsset}<span style={{ color: theme.textMuted }}>/USDT</span></span>
                  {/* 수량 단위를 같이 보여준다 — 코인마다 다르고(DOGE는 1),
                      고르기 전에 알아야 "왜 0.001을 못 넣지"가 안 생긴다 */}
                  <span style={{ fontSize: 10, color: theme.textMuted }}>{s.stepSize}</span>
                </div>
              );
            })}
            {!list.length && (
              <div style={{ padding: "10px 8px", fontSize: 11, color: theme.textMuted }}>
                {symbols.length ? "일치하는 심볼이 없습니다" : "심볼 목록을 받지 못했습니다"}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
