import { useEffect, useRef } from "react";
import { useTheme } from "../../ThemeContext";
import { PALETTE } from "../../constants";
import { getStructChochCount } from "../../chart/structRenderState";
import { getZzChochTotal } from "../../chart/structureZigzag";
import { FIB_ALL_LEVELS, fibLevelsOf } from "../../chart/fib";
import { structAutoParamsOf } from "../../chart/structAutoPivots";

// 자동 ZZ와 수동 구조는 **같은 이름("구조")** 을 쓴다 (2026-08-12 사용자 요청).
// 사용자에게는 둘 다 "구조"이고, 어느 쪽을 더블클릭했는지는 이미 알고 있다.
// "ZZ 투명도"처럼 이름이 갈리면 같은 팝업인데 다른 기능처럼 보인다.
// ⚠ 자동 ZZ와 수동 구조는 **이름이 갈려 있어야 한다** (2026-08-24 사용자 요청).
//   예전엔 둘 다 `구조`라, 팝업만 봐서는 무엇을 더블클릭했는지 알 수 없었다
//   (지표 메뉴의 `Auto` / `Custom` 짝과 같은 이유 — IndicatorMenu의 INDICATORS)
const KIND_LABEL = {
  line: "선", channel: "채널", circle: "원", fib: "피보나치", measure: "측정",
  structure: "커스텀 구조", zz: "자동 구조",
};

// 근접 알림(useTrendLineAlert)은 선/채널/원/피보나치만 대상.
// 피보나치는 **레벨 가로선 각각**이 근접 대상이고, 어느 레벨에 닿았는지는
// 토스트 본문에 비율로 찍힌다 (useTrendLineAlert 참고).
// 구조·ZZ의 🔔은 같은 자리·같은 아이콘이지만 **CHoCH 발생 알림**이다 (useChochAlert).
const PROXIMITY_ALERT_KINDS = new Set(["line", "channel", "circle", "fib"]);
// CHoCH를 갖는 종류 — 🔔(발생 알림) + 아래 CHoCH 표시 영역
const CHOCH_KINDS = new Set(["structure", "zz"]);
// 레그 hover 거래량 비교(3줄)를 갖는 종류 — **자동 ZZ·수동 구조 둘 다** (2026-08-24).
// ※ 2026-08-14~24에는 수동 구조뿐이었다 (그날 자동 ZZ에서 기능째 제거).
//   사용자가 다시 요청해 되살렸다 — 두 지표의 팝업이 같아야 한다는 이유다.
//   그래서 지금 이 집합은 CHOCH_KINDS와 같다. 그래도 **따로 둔다**:
//   한쪽만 다시 갈릴 때 어느 줄을 끄는 건지가 이름으로 남아 있어야 한다.
const LEGVOL_KINDS = new Set(["structure", "zz"]);
// 드래그로 움직일 수 있는 것만 잠금이 의미 있다. ZZ는 지표라 제외
const LOCK_KINDS = new Set(["line", "channel", "circle", "fib", "measure", "structure"]);
// ※ 측정 박스는 **투명도 + 잠금뿐**이다 — 근접 알림(PROXIMITY_ALERT_KINDS)에 넣지 말 것.
//   측정은 "지금 얼마나 움직였나"를 읽는 도구고, 가격을 지키라고 그은 선이 아니다.
//   넣으면 🔔이 생기는데 useTrendLineAlert에는 대응하는 경로가 없어 죽은 버튼이 된다
// 자동 이어그리기를 갖는 종류 — **커스텀 구조뿐이다** (2026-08-26).
// 자동 구조(zz)는 그 자체가 자동이라 넣을 것이 없다. 그리고 두 지표의 설정은
// **서로 영향을 주지 않는다** — 사용자가 공유를 취소하고 구조별로 옮겼다
const AUTO_KINDS = new Set(["structure"]);
// 자동 이어그리기 설정 4가지 — 라벨은 지표 메뉴(IndicatorMenu)의 ZZ ⚙과 **같은 말**이다.
// 계산 규칙이 같은 것을 나눠 쓰므로(chart/zigzagPivots.js) 이름까지 같아야
// "저기서 본 그 값"으로 읽힌다. 값만 구조마다 따로 산다
const AUTO_PARAMS = [
  { key: "left_bars",  label: "피벗 감지(봉)", min: 1,   max: 10,  step: 1 },
  { key: "use_filter", label: "노이즈 필터",   type: "toggle" },
  { key: "atr_mult",   label: "ATR 배수",      min: 0.1, max: 5.0, step: 0.1, fmt: v => v.toFixed(1) + "×" },
  { key: "atr_period", label: "ATR 기간",      min: 5,   max: 50,  step: 1 },
];
// 표시할 레벨 목록을 갖는 종류 — 피보나치뿐.
// **도형별**이다 (chart/fib.js [F1], 2026-08-15). 전역 값을 다시 만들지 말 것
const LEVEL_KINDS = new Set(["fib"]);

// 헤더의 아이콘 토글 — 모든 종류가 같은 자리·같은 크기를 쓰도록 한 곳에서 그린다
function IconToggle({ icon, on, onClick, title, theme, onColor = PALETTE.warn }) {
  return (
    <button onClick={onClick} title={title} style={{
      background: "none", border: "none", cursor: "pointer", padding: 0,
      fontSize: "14px", lineHeight: 1,
      opacity: on ? 1 : 0.35,
      color: on ? onColor : theme.textMuted,
    }}>
      {icon}
    </button>
  );
}

// 슬라이더 아래 영역 — 아이콘으로 뭉뚱그리지 않고 라벨 + ON/OFF로 명시한다
// (👁 아이콘 방식은 "무슨 표시인지 모르겠다"는 이유로 사용자가 되돌렸다. 되살리지 말 것)
function ToggleRow({ label, on, onClick, title, theme }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: "6px",
      marginTop: "10px", paddingTop: "8px",
      borderTop: `1px solid ${theme.borderSec}`,
    }}>
      <span style={{ fontSize: "12px", color: theme.textMuted, flex: 1 }}>{label}</span>
      <button onClick={onClick} title={title} style={{
        padding: "2px 10px", borderRadius: "3px", cursor: "pointer",
        fontSize: "11px", fontFamily: "inherit", fontWeight: on ? 700 : 400,
        background: on ? PALETTE.accent : "transparent",
        border: `1px solid ${on ? PALETTE.accent : theme.borderSec}`,
        color: on ? "#000" : theme.textMuted,
        transition: "all 0.15s",
      }}>
        {on ? "ON" : "OFF"}
      </button>
    </div>
  );
}

/**
 * CHoCH 표시 개수 — 최신 N개. 오른쪽 끝까지 올리면 "전체"(제한 없음)로 저장한다.
 *
 * 숫자를 고정 저장하지 않고 "전체"를 따로 두는 이유: 상한(detected)은 구조를 편집하면
 * 늘어난다. 그때 저장값이 옛 상한에 묶여 있으면 새로 생긴 CHoCH가 조용히 잘려나가
 * "왜 안 뜨지"가 된다 (실제로 겪은 문제 — Structures.jsx [R6]).
 */
function CountRow({ value, detected, onChange, theme }) {
  const hi   = Math.max(1, detected);
  const all  = value == null || value >= hi;
  const cur  = all ? hi : Math.max(1, value);
  return (
    // 레이아웃은 위 투명도 컨트롤과 같다 — 라벨+값 한 줄, 슬라이더는 그 아래 전폭.
    // ※ 슬라이더를 라벨과 같은 줄에 flex:1로 두지 말 것: input[type=range]는
    //   브라우저 기본 최소 너비(Chrome ~129px)가 있어 flex로 줄어들지 않고
    //   팝업 밖으로 삐져나온다. min-width:0으로 억지로 줄이면 조작 폭이 너무 좁다.
    <div style={{ marginTop: "8px" }}>
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        marginBottom: "4px",
      }}>
        <span style={{ fontSize: "12px", color: theme.textMuted }}>CHoCH 개수</span>
        <span style={{
          fontSize: "12px", fontVariantNumeric: "tabular-nums",
          color: all ? theme.textMuted : PALETTE.accent, fontWeight: all ? 400 : 700,
        }}>
          {detected === 0 ? "없음" : all ? `전체 ${hi}` : `${cur} / ${hi}`}
        </span>
      </div>
      <input
        // 막대는 0에서 시작하고 손잡이는 1에서 멈춘다 (2026-08-24 사용자 요청,
        // 사이드바·지표 메뉴 슬라이더와 같은 규칙)
        type="range" min={0} max={hi} step={1} value={cur}
        disabled={detected === 0}
        onChange={e => {
          const n = Math.max(1, parseInt(e.target.value, 10));
          onChange(n >= hi ? null : n);      // 끝까지 올리면 제한 해제
        }}
        style={{
          width: "100%", accentColor: PALETTE.accent,
          cursor: detected ? "pointer" : "default",
          opacity: detected ? 1 : 0.4,
        }}
      />
    </div>
  );
}

/**
 * 자동 이어그리기 설정값 한 줄 — 라벨 + 값 + 전폭 슬라이더.
 * 레이아웃은 CountRow와 같다 (같은 팝업 안에서 줄마다 다르게 보이면 안 된다).
 */
function ParamRow({ label, value, min, max, step, fmt, onChange, theme }) {
  return (
    <div style={{ marginTop: "8px" }}>
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        marginBottom: "4px",
      }}>
        <span style={{ fontSize: "12px", color: theme.textMuted }}>{label}</span>
        <span style={{
          fontSize: "12px", fontVariantNumeric: "tabular-nums",
          color: PALETTE.accent, fontWeight: 700,
        }}>
          {fmt ? fmt(value) : value}
        </span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        style={{ width: "100%", accentColor: PALETTE.accent, cursor: "pointer" }}
      />
    </div>
  );
}

/**
 * 표시할 피보나치 레벨 — **이 도형에만** 적용된다 (chart/fib.js [F1], 2026-08-15).
 *
 * ※ 2026-08-14~15은 지표 메뉴의 전역 패널이었다. 지표 체크박스를 켜야만 TopBar
 *   피보나치 버튼이 살아나는 게 이상하다는 사용자 지적으로 지표 행째 없앴고,
 *   그러면서 레벨을 둘 곳이 여기밖에 남지 않았다.
 *   ⚠ 전역 값을 다시 만들지 말 것 — 두 값이 생기면 AND인지 덮어쓰기인지가
 *     화면 어디에도 안 드러난다 (struct.show_choch에서 겪은 문제).
 *
 * 3열인 이유는 후보가 10개라서다. 체크박스 12px는 IndicatorMenu의 TfGrid와 같은 규격.
 */
function FibLevelRow({ levels, onToggle, onReset, theme }) {
  return (
    <div style={{ marginTop: "10px", paddingTop: "8px", borderTop: `1px solid ${theme.borderSec}` }}>
      <div style={{ fontSize: "12px", color: theme.textMuted, marginBottom: "6px" }}>표시할 레벨</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "3px 2px" }}>
        {FIB_ALL_LEVELS.map(r => {
          const on = levels.includes(r);
          return (
            <div key={r} onClick={() => onToggle(r)}
              style={{
                display: "flex", alignItems: "center", gap: "5px",
                padding: "2px 1px", borderRadius: "3px", cursor: "pointer",
                fontSize: "11px", color: on ? theme.textPrimary : theme.textMuted,
                fontVariantNumeric: "tabular-nums",
              }}
              onMouseEnter={e => e.currentTarget.style.background = theme.borderSec}
              onMouseLeave={e => e.currentTarget.style.background = "transparent"}
            >
              <span style={{
                width: 12, height: 12, flexShrink: 0,
                border: `1.5px solid ${on ? PALETTE.accent : theme.textFaint}`,
                borderRadius: 3,
                background: on ? PALETTE.accent : "transparent",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 9, color: "#000", fontWeight: 700, lineHeight: 1,
                transition: "all 0.15s",
              }}>{on ? "✓" : ""}</span>
              {r}
            </div>
          );
        })}
      </div>
      {/* 1 초과는 되돌림이 아니라 추세 시작점을 뚫고 더 간 자리 — 뜻이 다르니 적어 둔다 */}
      <div style={{ fontSize: "10px", color: theme.textMuted, marginTop: "6px", lineHeight: 1.4 }}>
        1 초과는 되돌림이 아니라 돌파 후 확장 목표가입니다.
      </div>
      {levels.length === 0 && (
        <div style={{ fontSize: "10px", color: PALETTE.short, marginTop: "4px", lineHeight: 1.4 }}>
          가로선이 하나도 그려지지 않습니다. (앵커 대각선만 남습니다)
        </div>
      )}
      <button onClick={onReset} style={{
        width: "100%", marginTop: "8px", padding: "3px 0", borderRadius: "4px",
        border: `1px solid ${theme.borderSec}`, background: "transparent",
        color: theme.textMuted, fontSize: "11px", cursor: "pointer", fontFamily: "inherit",
      }}>기본값</button>
    </div>
  );
}

/**
 * 차트 도형 더블클릭 팝업 — 투명도 슬라이더 + 헤더 아이콘 토글.
 *
 * ── UI 통일 규칙 (2026-08-12 사용자 요청) ──────────────────────────────────
 * 헤더 = 이름 + % + 아이콘, 그 아래 슬라이더, 그 아래 옵션 영역. 종류가 달라도 배치가 같다.
 *   🔔 알림 — 선/채널/원은 근접 알림, 구조/ZZ는 CHoCH 발생 알림 (추세선과 같은 자리·아이콘)
 *   🔒 잠금 — 드래그 가능한 도형만. 자동 ZZ는 움직일 대상이 아니라 없다(죽은 버튼을 두지 않음)
 *   CHoCH 표시 — **아이콘이 아니라 슬라이더 아래 라벨+ON/OFF 행**.
 *     👁 아이콘으로 바꿨다가 "무슨 표시인지 모르겠다"는 이유로 사용자가 되돌렸다. 되살리지 말 것
 *   거래량 비교 — 레그 hover의 거래량 3줄(상위3/평균/총량). 같은 라벨+ON/OFF 행 (2026-08-13).
 *     **수동 구조에만 있다** — 자동 ZZ는 2026-08-14 사용자 요청으로 거래량 비교를 뺐다
 *   표시할 레벨 — **피보나치에만**. 체크박스 10개, 이 도형에만 적용 (2026-08-15, [F1]).
 *     예전엔 지표 메뉴의 전역 패널이었다 — 되돌리지 말 것 (FibLevelRow 주석 참고)
 *
 * **자동 ZZ와 수동 구조는 이름도 "구조"로 같고, 팝업 구성도 거의 같다**
 * (자동 ZZ에 없는 것: 잠금 🔒, 거래량 비교).
 * 사용자에게는 둘 다 "구조"다 — 이름이 갈리면 같은 팝업인데 다른 기능처럼 보인다.
 *
 * kind "zz"(자동 Structure Zigzag)는 도형이 아니라 지표라 항목이 하나뿐이고
 * (drawables의 가짜 drawable, id는 ZZ_ID) 삭제·잠금이 no-op이다.
 */
export function LineOpacityPopup({ popup, drawables, onClose }) {
  const { theme } = useTheme();
  const ref  = useRef(null);
  const kind = popup.type;
  const d    = drawables[kind];
  const item = d?.items?.find(x => x.id === popup.id) ?? null;

  // 대상이 사라지면(Delete 키 등) popup 자동 닫기
  useEffect(() => {
    if (!item) onClose();
  }, [item, onClose]);

  // 외부 클릭 / ESC 로 닫기
  useEffect(() => {
    const onDown = e => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    const onKey  = e => { if (e.key === "Escape") onClose(); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown",   onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown",   onKey);
    };
  }, [onClose]);

  const opacity = item?.opacity ?? 1.0;
  const locked  = item?.locked  ?? false;
  // 알림/표시는 기본 ON이라 undefined는 ON으로 읽는다 — 기존에 저장된 항목이
  // 새 필드 때문에 전부 꺼진 채로 뜨면 안 된다.
  // (근접 알림만 반대: 명시적으로 켜는 기능이라 기본 OFF)
  const isChoch = CHOCH_KINDS.has(kind);
  // CHoCH 알림은 수동 구조 = 기본 OFF(true일 때만 ON, Structures.jsx [R10]),
  // 자동 ZZ = App.jsx가 이미 boolean으로 풀어서 넘긴다. 둘 다 !! 하나로 읽힌다
  const alert   = isChoch ? !!item?.alertChoch : (item?.alert ?? false);
  const showMk  = item?.showChoch !== false;
  // ⚠ **`!== false`로 되돌리지 말 것** — 거래량 비교는 자동·수동 둘 다 기본 OFF다
  //   (2026-08-24). 자동 ZZ는 App.jsx가 이미 boolean으로 풀어서 넘긴다
  const showVol = item?.showLegVol === true;
  // 개수 슬라이더 상한 — 렌더 경로의 모듈 상태를 직접 읽는다(팝업을 여는 시점의 스냅샷).
  // 수동 구조는 구조별, 자동 ZZ는 지표 전체가 리스트 하나다.
  const chochCount = !isChoch ? 0
    : kind === "zz" ? getZzChochTotal() : getStructChochCount(popup.id);
  // 표시할 레벨 — 도형별([F1]). 저장 안 된 도형은 기본 7개로 읽는다
  const hasLevels = LEVEL_KINDS.has(kind);
  const levels    = hasLevels ? fibLevelsOf(item) : [];
  // 자동 이어그리기 — **구조마다** 켜고 끄고, 설정도 구조마다 따로다 (2026-08-26).
  // ⚠ **기본 OFF**다 (`=== true`). `!== false`로 되돌리지 말 것 — 손대지 않은 기존
  //   구조가 전부 켜진 채로 뜨고, 그러면 그려둔 구조 전부가 현재 봉까지 점선을 뻗는다
  const hasAuto = AUTO_KINDS.has(kind);
  const autoOn  = item?.autoZz === true;
  const autoP   = hasAuto ? structAutoParamsOf(item) : null;

  // 팝업이 화면 밖으로 나가지 않도록 위치 조정.
  // 슬라이더가 브라우저 기본 최소 너비(~129px)를 갖고 좌우 여백 24px가 빠지므로
  // 폭은 넉넉히 잡는다. 높이는 구조/ZZ일 때 CHoCH 두 블록 + `거래량 비교` 행만큼 더 크다
  // (2026-08-24부터 자동 ZZ도 같은 구성이라 둘의 높이가 같다).
  // 피보나치는 레벨 체크박스 4줄 + 안내 + 버튼이 붙어 가장 크다
  // 자동 이어그리기는 켜야 설정 4줄이 나온다 — 꺼 두면 ON/OFF 한 줄뿐이라
  // 팝업이 쓸데없이 길어지지 않는다
  const autoH = !hasAuto ? 0 : autoOn ? 210 : 35;
  const W = 210, H = (hasLevels ? 250
    : LEGVOL_KINDS.has(kind) ? 210 : isChoch ? 175 : 80) + autoH;
  const x = Math.min(popup.x, window.innerWidth  - W - 8);
  const y = Math.min(popup.y, window.innerHeight - H - 8);

  return (
    <div ref={ref} style={{
      position: "fixed", left: x, top: y,
      width: W, padding: "10px 12px",
      background: theme.bgCard,
      border: `1px solid ${theme.borderSec}`,
      borderRadius: "6px",
      boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
      zIndex: 1000,
      userSelect: "none",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
        <span style={{ fontSize: "12px", color: theme.textMuted }}>{KIND_LABEL[kind]} 투명도</span>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ fontSize: "12px", color: PALETTE.accent, fontWeight: "700" }}>
            {Math.round(opacity * 100)}%
          </span>

          {/* 🔔 알림 — 선/채널/원은 근접, 구조/ZZ는 CHoCH 발생 */}
          {(PROXIMITY_ALERT_KINDS.has(kind) || isChoch) && (
            <IconToggle icon="🔔" on={alert}
              onClick={() => d.toggleAlert?.(popup.id)}
              title={isChoch
                ? (alert ? "CHoCH 발생 알림 ON — 클릭하여 OFF" : "CHoCH 발생 알림 OFF — 클릭하여 ON")
                : (alert ? "근접 알림 ON — 클릭하여 OFF"       : "근접 알림 OFF — 클릭하여 ON")}
              theme={theme} />
          )}

          {/* 🔒 잠금 */}
          {LOCK_KINDS.has(kind) && (
            <IconToggle icon={locked ? "🔒" : "🔓"} on={locked}
              onClick={() => d.toggleLock(popup.id)}
              title={locked ? "잠김 — 클릭하여 해제" : "잠금 해제됨 — 클릭하여 잠금"}
              theme={theme} />
          )}
        </div>
      </div>
      <input
        // ⚠ **10% 단위 / 하한 10%** (2026-08-25 사용자 지정 — 그전엔 25% 단위·하한 25%).
        //   막대는 0에서 시작하고 **손잡이만 0.1에서 멈춘다**(아래 onChange의 Math.max) —
        //   min을 0.1로 올리지 말 것: 그러면 눈금이 10~100을 10칸으로 나눠 0.1 간격이
        //   깨진다. 완전히 투명한 도형은 "사라진 것"과 구분되지 않아 하한을 둔다
        //   ⚠ 단축키 `[` `]`(useKeyboardShortcuts)도 **같은 폭·같은 하한**이다 — 한쪽만
        //     바꾸면 슬라이더 눈금에 없는 값이 만들어진다
        type="range" min={0} max={1} step={0.1}
        value={opacity}
        onChange={e => d.setOpacity(popup.id, Math.max(0.1, parseFloat(e.target.value)))}
        style={{ width: "100%", accentColor: PALETTE.accent, cursor: "pointer" }}
      />

      {/* 표시할 레벨 — 피보나치뿐. **이 도형에만** 적용된다 (전역 값 없음, [F1]) */}
      {hasLevels && (
        <FibLevelRow
          levels={levels}
          onToggle={r => d.toggleLevel?.(popup.id, r)}
          onReset={()  => d.resetLevels?.(popup.id)}
          theme={theme}
        />
      )}

      {/* CHoCH 옵션 — 자동 ZZ·수동 구조 모두 같은 자리, 같은 모양.
          수동 구조는 **이 구조에만** 적용된다 — 전역 설정이 아니다.
          자동 ZZ(kind "zz")는 값이 지표 파라미터라 **지표 메뉴 ⚙에도 같은 세 줄이 있다**
          (2026-08-14 사용자 요청). 같은 값을 가리키는 거울이므로 한쪽을 바꾸면 양쪽이 바뀐다 —
          줄 순서(표시 → 개수 → 거래량 비교)를 양쪽 같게 유지할 것 */}
      {isChoch && (
        <>
          <ToggleRow
            label="CHoCH 표시" on={showMk}
            onClick={() => d.toggleChoch?.(popup.id)}
            title={showMk ? "CHoCH 마크 표시 중 — 클릭하여 숨김"
                          : "CHoCH 마크 숨김 — 클릭하여 표시"}
            theme={theme}
          />
          <CountRow
            value={item?.maxChoch ?? null} detected={chochCount}
            onChange={n => d.setMaxChoch?.(popup.id, n)}
            theme={theme}
          />
          {/* 레그 hover의 거래량 비교 3줄(상위3/평균/총량) — **자동 ZZ·수동 구조 둘 다**.
              등락률(%)은 이 설정과 무관하게 계속 뜬다 — 끄고 싶은 건 거래량 쪽이고,
              등락률까지 사라지면 "hover가 통째로 죽었다"로 보인다.
              ⚠ 값이 사는 곳이 다르다: 수동 구조는 **구조마다**(localStorage),
                자동 ZZ는 **지표 하나에 값 하나**(indicatorParams.zz.show_legvol).
                팝업은 그 차이를 모른다 — App.jsx의 drawables가 흡수한다 */}
          {LEGVOL_KINDS.has(kind) && (
            <ToggleRow
              label="거래량 비교" on={showVol}
              onClick={() => d.toggleLegVol?.(popup.id)}
              title={showVol ? "레그 hover 시 거래량 비교 표시 중 — 클릭하여 숨김"
                             : "레그 hover 시 거래량 비교 숨김 — 클릭하여 표시"}
              theme={theme}
            />
          )}
        </>
      )}

      {/* 자동 이어그리기 — **커스텀 구조에만**. 마지막 꼭짓점 뒤를 자동으로 이어 그린다
          (Structures.jsx [R12]).
          ⚠ 자동 구조 지표(kind "zz")의 설정과 **아무 관계가 없다** (2026-08-26 사용자
            요청으로 공유를 끊었다). 처음 값만 같고, 그 뒤로는 서로 영향을 주지 않는다.
            지표 메뉴 ⚙에 이 네 줄을 거울로 만들지 말 것 — 값이 구조마다 있어서
            지표 메뉴가 가리킬 대상이 없다 (struct의 다른 값들과 같은 이유) */}
      {hasAuto && (
        <>
          <ToggleRow
            label="자동 이어그리기" on={autoOn}
            onClick={() => d.toggleAuto?.(popup.id)}
            title={autoOn ? "마지막 꼭짓점 뒤를 자동으로 이어 그리는 중 — 클릭하여 끔"
                          : "마지막 꼭짓점 뒤를 자동으로 이어 그린다 — 클릭하여 켬"}
            theme={theme}
          />
          {/* 꺼져 있으면 설정을 감춘다 — 아무 일도 안 하는 슬라이더가 남아 있으면
              끈 게 아니라 고장 난 것처럼 보인다 */}
          {autoOn && AUTO_PARAMS.map(m => (
            m.type === "toggle" ? (
              <ToggleRow
                key={m.key} label={m.label} on={!!autoP[m.key]}
                onClick={() => d.setAutoParam?.(popup.id, m.key, !autoP[m.key])}
                title={autoP[m.key] ? "작은 흔들림을 걸러내는 중 — 클릭하여 끔"
                                    : "작은 흔들림도 꼭짓점으로 잡는다 — 클릭하여 켬"}
                theme={theme}
              />
            ) : (
              <ParamRow
                key={m.key} label={m.label} value={autoP[m.key]}
                min={m.min} max={m.max} step={m.step} fmt={m.fmt}
                onChange={v => d.setAutoParam?.(popup.id, m.key, v)}
                theme={theme}
              />
            )
          ))}
        </>
      )}
    </div>
  );
}
