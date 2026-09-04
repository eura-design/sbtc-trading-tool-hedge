import { useState, useRef, useEffect, useMemo } from "react";
import { useTheme } from "../ThemeContext";
import { lsGetJSON, lsSetJSON } from "../utils/storage";

// 심볼 선택기 — 상단바 왼쪽 (2026-09-02)
//
// 목록은 백엔드가 바이낸스 `exchangeInfo`에서 받아 준다 (`GET /api/symbols`,
// USDT 무기한 + 거래 중만, 실측 526개). **하드코딩한 목록이 없다** — 코인을 늘릴 때
// 손댈 곳이 없다는 게 이 방식의 요점이다.
//
// ⚠ 500개를 그냥 뿌리지 않는다. 타이핑으로 좁히고, 아무것도 안 쳤을 때는
//   **즐겨찾기 → 이름순 상위 몇 개** 순서로 보여준다 — 거래량순이 아니다.
//   거래량은 이 목록에 없고, 그것만 받으려고 요청을 하나 더 늘릴 만큼 중요하지 않다.
// ⚠ 목록을 못 받았으면(`symbols`가 비었으면) **버튼이 죽는다.** 규칙을 모르는 채로
//   심볼을 바꾸면 수량 계산이 BTC 단위로 돌아가 화면 숫자가 조용히 틀린다
//   (`useSymbolFilters`의 `ready` 주석과 같은 이유).
//
// ⚠ **리플레이 중에는 바꿀 수 없다.** 재생 중에 심볼이 바뀌면 그 구간의 캔들·페이퍼
//   장부·도형이 전부 어긋난다. 연습을 끝내고 바꾸는 것이 맞다

const MAX_ROWS = 60;

// ── 즐겨찾기 (2026-09-04 사용자 요청) ──────────────────────────────────────
//
// 526개 중 실제로 오가는 것은 몇 개뿐이라, 매번 검색해서 찾는 대신 위에 고정한다.
//
// ⚠ 저장은 **브라우저**다 (`localStorage`). 백엔드가 꺼져 있어도 목록이 보여야 하고,
//   계좌와 무관한 화면 설정이기 때문이다 (CLAUDE.md "데이터가 사는 곳").
//   백업은 브라우저 저장소를 통째로 뜨므로 이 값도 자동으로 딸려 간다.
// ⚠ **심볼 문자열만 담는다.** 수량 단위 같은 규칙을 같이 저장하면 낡은 값이 남는다 —
//   규칙의 원본은 언제나 바이낸스 `exchangeInfo`다
const FAV_KEY = "favoriteSymbols";

const loadFavs = () => {
  const v = lsGetJSON(FAV_KEY, []);
  return Array.isArray(v) ? v.filter(x => typeof x === "string") : [];
};

export function SymbolPicker({ symbol, symbols, onChange, disabled, disabledReason }) {
  const { theme } = useTheme();
  const [open, setOpen] = useState(false);
  const [q, setQ]       = useState("");
  const [favs, setFavs] = useState(loadFavs);
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

  const favSet = useMemo(() => new Set(favs), [favs]);

  // 아무것도 안 쳤을 때만 즐겨찾기를 **맨 위로** 모은다.
  //
  // ⚠ **검색 중에는 즐겨찾기를 위로 올리지 않는다.** 올리면 "친 글자로 시작하는 것이
  //   위"라는 규칙이 깨진다 — 1000ETHFI를 즐겨찾기에 넣어 두면 `ETH`를 쳤을 때
  //   ETHUSDT보다 먼저 나오고, Enter가 엉뚱한 코인을 고른다.
  //   검색은 "내가 지금 찾는 것"이고 즐겨찾기는 "안 찾을 때 빨리 가는 길"이라 목적이 다르다
  // ⚠ 즐겨찾기는 `MAX_ROWS`에 잘리지 않는다 — 고정해 둔 것이 목록에 밀려 사라지면
  //   고정한 의미가 없다. 나머지가 남은 자리를 채운다
  const { favRows, restRows } = useMemo(() => {
    const needle = q.trim().toUpperCase();
    if (needle) {
      const ranked = symbols
        .filter(s => s.symbol.includes(needle))
        .sort((a, b) => (b.symbol.startsWith(needle) - a.symbol.startsWith(needle))
                     || a.symbol.localeCompare(b.symbol));
      return { favRows: [], restRows: ranked.slice(0, MAX_ROWS) };
    }
    const fav  = symbols.filter(s => favSet.has(s.symbol));
    const rest = symbols.filter(s => !favSet.has(s.symbol));
    return { favRows: fav, restRows: rest.slice(0, Math.max(0, MAX_ROWS - fav.length)) };
  }, [symbols, q, favSet]);

  const list = useMemo(() => [...favRows, ...restRows], [favRows, restRows]);

  // ⚠ 별을 누르는 것은 **고르는 것이 아니다** — 이벤트를 여기서 멈춘다.
  //   안 그러면 즐겨찾기에 넣는 순간 그 코인으로 화면이 바뀐다
  const toggleFav = (e, sym) => {
    e.stopPropagation();
    setFavs(prev => {
      const next = prev.includes(sym) ? prev.filter(x => x !== sym) : [...prev, sym];
      lsSetJSON(FAV_KEY, next);
      return next;
    });
  };

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
            {list.map((s, i) => {
              const on  = s.symbol === symbol;
              const fav = favSet.has(s.symbol);
              // 즐겨찾기와 나머지 사이에 줄 하나 — 어디까지가 고정인지 보이게
              const divider = i === favRows.length && favRows.length > 0 && restRows.length > 0;
              return (
                <div
                  key={s.symbol}
                  onClick={() => pick(s.symbol)}
                  style={{
                    display: "flex", alignItems: "center", gap: 6,
                    padding: "5px 8px", cursor: "pointer", fontSize: 12,
                    color: on ? "#f0b90b" : theme.textPrimary,
                    fontWeight: on ? 700 : 400,
                    background: on ? theme.border : "transparent",
                    borderTop: divider ? `1px solid ${theme.borderSec}` : "none",
                  }}
                  onMouseEnter={e => { if (!on) e.currentTarget.style.background = theme.borderSec; }}
                  onMouseLeave={e => { if (!on) e.currentTarget.style.background = "transparent"; }}
                >
                  <span
                    onClick={e => toggleFav(e, s.symbol)}
                    title={fav ? "즐겨찾기에서 빼기" : "즐겨찾기에 넣기"}
                    style={{
                      fontSize: 12, lineHeight: 1, width: 12, textAlign: "center",
                      color: fav ? "#f0b90b" : theme.textMuted,
                      opacity: fav ? 1 : 0.45,
                    }}
                  >{fav ? "★" : "☆"}</span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    {s.baseAsset}<span style={{ color: theme.textMuted }}>/USDT</span>
                  </span>
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
