import { useState, useRef, useEffect } from "react";
import { useTheme } from "../ThemeContext";
import { INDICATOR_DEFAULTS } from "../hooks/useIndicatorParams";
import { getZzChochTotal } from "../chart/structureZigzag";
import { getRsiZoneCount } from "../chart/overlayRenderers";
import { INTERVALS } from "../constants";
import { FIB_ALL_LEVELS, FIB_DEFAULT_LEVELS } from "../chart/fib";

export const INDICATORS = [
  { key: "vol", label: "Volume" },
  { key: "rsi", label: "RSI" },
  // 지지/저항 — 구 "S/R Levels"(백엔드 KDE.py 밀도 기반)는 2026-08-13 **완전히 제거**됐고
  // 스윙 터치 기반 Pivot Levels가 대신한다 (chart/pivotLevels.js)
  { key: "pivot", label: "Pivot Levels" },
  { key: "ob",  label: "Order Block" },
  { key: "fvg", label: "FVG" },
  { key: "zz",  label: "Structure Zigzag" },
  // 수동 구조 표시 토글 — 자동 ZZ와 독립
  // ※ key는 "struct" 유지 — 바꾸면 localStorage("indicators")에 저장된 on/off가 초기화된다
  // ⚙ 설정은 전용 패널(StructTfPanel): **표시 타임프레임뿐이다.**
  //   CHoCH 표시/개수·거래량 비교는 자동 ZZ와 달리 여기 없다 — 전부 구조별이라
  //   각 구조의 더블클릭 팝업에 있다 (아래 STRUCT 주석 참고)
  { key: "struct", label: "Custom Structure Zigzag" },
  // 피보나치 되돌림 — 선/채널/원과 같은 **도형**인데 여기 행이 있는 이유는
  // 레벨 목록이 전역 파라미터라서다 (chart/fib.js [F1]). 체크박스는 표시 on/off이고,
  // OFF면 렌더·히트 판정에서 빠지고 TopBar "피보나치" 버튼도 죽는다 (수동 구조와 같은 규칙)
  { key: "fib", label: "Fibonacci" },
  { key: "ema", label: "EMA" },
];

// 각 지표별 파라미터 슬라이더 정의
const PARAMS_META = {
  rsi: [
    { key: "period",     label: "기간",     min: 2,    max: 50,  step: 1 },
    { key: "overbought", label: "과매수",   min: 51,   max: 95,  step: 1 },
    { key: "oversold",   label: "과매도",   min: 5,    max: 49,  step: 1 },
    // 과매수/과매도 구간을 메인 차트 배경에 파란 세로 밴드로 (RSI 패널은 그대로)
    { key: "zone_bg",    label: "구간 배경", type: "toggle" },
    // OFF(기본) = 지금 이어지는 국면만 / ON = 검출된 전 구간.
    // ⚠ **기본은 OFF다.** ON이 기본이면 5m처럼 구간이 많은 TF에서 화면이 통째로 물든다
    //   (그게 애초에 "마지막 연속 구간만" 규칙이 생긴 이유다 — overlayRenderers 주석)
    { key: "zone_all",   label: "구간 배경 전체 표시", type: "toggle" },
  ],
  fvg: [
    { key: "lookback",       label: "표시 범위",      min: 50,  max: 1000, step: 10 },
    { key: "max_display",    label: "최대 표시",     min: 5,   max: 50,   step: 1  },
    { key: "mitigation_pct", label: "미티게이션(%)", min: 0,   max: 100,  step: 5  },
    { key: "disp_threshold", label: "Displacement(×ATR)", min: 0.5, max: 3.0, step: 0.1, fmt: v => v.toFixed(1) + "×" },
    { key: "disp_atr_period", label: "ATR 기간",     min: 5,   max: 50,   step: 1  },
    { key: "displacement_only", label: "Displacement만",  type: "toggle" },
  ],
  ob: [
    { key: "swing_lb",       label: "스윙 감지(봉)",  min: 1,   max: 10,   step: 1  },
    { key: "bos_window",     label: "BOS 윈도우",     min: 5,   max: 100,  step: 1  },
    { key: "ob_lookback",    label: "탐색 범위(봉)",   min: 5,   max: 50,   step: 1  },
    { key: "scan_from",      label: "표시 범위",      min: 100, max: 1000, step: 50 },
    { key: "mitigation_pct", label: "미티게이션(%)", min: 0,   max: 100,  step: 5  },
    { key: "max_display",    label: "최대 표시",      min: 5,   max: 30,   step: 1  },
    { key: "disp_threshold", label: "Displacement(×ATR)", min: 0.5, max: 3.0, step: 0.1, fmt: v => v.toFixed(1) + "×" },
    { key: "disp_atr_period", label: "ATR 기간",     min: 5,   max: 50,   step: 1  },
    { key: "displacement_only", label: "Displacement만",  type: "toggle" },
    { key: "use_wick",          label: "윅 포함",           type: "toggle" },
  ],
  zz: [
    { key: "left_bars",  label: "피벗 감지(봉)",  min: 1,   max: 10,    step: 1  },
    { key: "use_filter", label: "노이즈 필터",    type: "toggle" },
    { key: "atr_mult",   label: "ATR 배수",       min: 0.1, max: 5.0,   step: 0.1, fmt: v => v.toFixed(1) + "×" },
    { key: "atr_period", label: "ATR 기간",       min: 5,   max: 50,    step: 1  },
    // 표시 범위(scan_from)는 제거 — 지그재그는 로드된 캔들 전체를 잇는다.
    // CHoCH 표시/개수는 아래 SettingsPanel의 전용 블록에 있다 (PARAMS_META 아님) —
    // 개수 슬라이더의 상한이 실제 검출 개수라 정적 meta로 만들 수 없고,
    // 팝업과 **순서를 맞춰야** 해서 표시 → 개수를 한 덩어리로 그린다.
  ],
  // Pivot Levels — 노브 4개, **전부 단조롭다**: 앞의 3개는 올릴수록 레벨이 줄고
  // top_n은 표시만 늘린다.
  // ⚠ 제거된 S/R Levels(KDE)의 교훈이다 — 거기선 6개 중 4개가 서로 다른 지점에서
  //   "레벨이 몇 개 나오나"를 건드렸고, 늘리는 노브와 줄이는 노브가 상쇄돼 사용자가
  //   전부 최대로 둔 채 "레벨이 4개밖에 안 나온다" 상태로 쓰고 있었다.
  //   여기에 노브를 더 붙일 때도 방향이 한쪽으로만 움직이는지 먼저 확인할 것
  // lookback(600)은 숨김 — 이유는 INDICATOR_DEFAULTS.pivot 주석 참고.
  // tfs(계산 타임프레임)는 슬라이더가 아니라 SettingsPanel의 TfGrid로 뜬다
  // ※ 아래 값들은 **선택한 TF 각각에** 적용된다 (표시 개수 3 × TF 3개 = 최대 18줄).
  //   TF를 늘렸는데 화면이 복잡하면 표시 개수부터 내리면 된다
  pivot: [
    { key: "pivot_bars", label: "피벗 감지(봉)", min: 2, max: 20, step: 1,
      fmt: v => v + "봉",
      desc: "좌우 이만큼의 봉보다 높은 고가(낮은 저가)만 스윙으로 본다. 올리면 큰 스윙만 남는다" },
    { key: "merge_atr", label: "레벨 병합 폭", min: 0.1, max: 1.5, step: 0.05,
      fmt: v => v.toFixed(2) + "×",
      desc: "이 폭(ATR 배수) 안에 있는 스윙들을 한 레벨로 묶는다. 올리면 뭉쳐서 개수가 준다" },
    { key: "min_touch", label: "최소 터치", min: 1, max: 5, step: 1,
      fmt: v => v + "회",
      desc: "이만큼 반복해서 반응한 자리만 남긴다. 1로 내리면 한 번 스친 곳까지 전부 나온다" },
    { key: "top_n", label: "표시 개수", min: 1, max: 6, step: 1,
      fmt: v => v + "개",
      desc: "TF마다 현재가 위/아래 각각 가까운 순으로 이만큼만. 멀리 있는 레벨은 지금 거래에 쓸 일이 없다" },
  ],
};

// 수동 구조(struct)는 이 메뉴에 **표시 타임프레임(tfs)만** 둔다 (StructTfPanel).
// CHoCH 관련은 전부 각 구조의 더블클릭 팝업에 있다 — 표시 on/off(showChoch),
// 개수(maxChoch), 검출 개수 모두 **구조별**이라 메뉴에 둘 자리가 없다 (Structures.jsx [R6]).
//
// ⚠ 지표 전체 CHoCH 스위치(`struct.show_choch`)는 **없앴다** (2026-08-12 사용자 요청).
//   되살리면 안 되는 이유: 팝업의 구조별 토글과 AND로 걸리는 별개 값이라,
//   전체 스위치를 OFF로 저장해 둔 채 UI만 사라지면 구조별 ON이 아무 효과가 없고
//   되돌릴 방법도 없다. 화면 정리는 구조별 토글 하나로 충분하다.

// "검출된 ○○ N개" — ZZ의 CHoCH / RSI의 과매수·과매도 구간이 공유한다.
// 둘 다 렌더 경로의 모듈 상태를 직접 읽는 것이라 **메뉴를 여는 시점의 스냅샷**이다
// (계산이 캔버스 렌더에만 있어 React 상태로 올라오지 않는다).
function DetectedCountRow({ label, total, theme }) {
  return (
    <div style={{
      display: "flex", justifyContent: "space-between", alignItems: "center",
      marginBottom: 8, paddingBottom: 6,
      borderBottom: `1px solid ${theme.borderSec}`,
      fontSize: 11, color: theme.textSec,
    }}>
      <span>검출된 {label}</span>
      <span style={{
        color: total ? "#c084fc" : theme.textFaint, fontWeight: 700,
        fontVariantNumeric: "tabular-nums",
      }}>
        {total}개
      </span>
    </div>
  );
}

/**
 * "최근 N개만" 슬라이더 — `null`을 저장하면 **전체**(제한 없음)다.
 *
 * "전체"를 숫자와 따로 두는 이유: 항목이 늘어났을 때 저장값이 옛 개수에 묶여 있으면
 * 새 항목이 조용히 잘려 "왜 안 뜨지"가 된다. 그래서 끝까지 올리면 제한을 해제한다.
 *
 * 상한(`hi`) = **실제 검출 개수**이고, 맨 오른쪽 칸이 곧 "전체"다 (둘이 같은 뜻이라 겹쳐 둔다).
 * 구조/ZZ 팝업의 `CountRow`와 같은 규칙 — 두 곳이 같은 값을 조작하므로 맞춰야 한다.
 *
 * ※ 예전엔 `cap` 인자가 있어서 RSI의 구간 개수만 상한을 10으로 고정했다.
 *   그 슬라이더가 2026-08-15에 제거되면서 분기도 같이 뺐다 (지금 쓰는 곳은 ZZ 하나뿐)
 */
function RecentCountSlider({ label, value, detected, onChange, theme }) {
  const hi   = Math.max(1, detected);
  const top  = hi;      // "전체" 칸의 위치
  const all  = value == null || value >= top;
  const cur  = all ? hi : Math.max(1, value);
  const pos  = all ? top : cur;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5 }}>
      <span style={{ fontSize: 11, color: theme.textSec, width: 100, flexShrink: 0 }}>
        {label}
      </span>
      <input
        type="range" min={1} max={top} step={1} value={pos}
        disabled={detected === 0}
        onChange={e => {
          const n = parseInt(e.target.value, 10);
          onChange(n >= top ? null : n);      // 맨 오른쪽 칸 = 전체(제한 해제)
        }}
        style={{
          flex: 1, accentColor: "#c084fc",
          cursor: detected ? "pointer" : "default",
          opacity: detected ? 1 : 0.4,
        }}
      />
      <span style={{
        fontSize: 11, color: all ? theme.textMuted : theme.textPrimary,
        width: 38, textAlign: "right",
        fontVariantNumeric: "tabular-nums", flexShrink: 0,
      }}>
        {detected === 0 ? "없음" : all ? "전체" : cur}
      </span>
    </div>
  );
}

// meta.desc — 슬라이더 아래 회색 한 줄 설명. "올리면 어떻게 되는가"를 쓴다.
// 파라미터 이름(bandwidth, persistence…)만으로는 뭘 하는 건지 알 수 없어서 붙였다.
function ParamDesc({ desc, theme }) {
  if (!desc) return null;
  return (
    <div style={{
      fontSize: 10, color: theme.textMuted, lineHeight: 1.4,
      margin: "-2px 0 7px 106px",   // 라벨 폭(100) + gap(6)에 맞춰 값 영역 아래로 들여쓴다
    }}>
      {desc}
    </div>
  );
}

function ParamSlider({ meta, value, onChange, theme }) {
  if (meta.type === "toggle") {
    const on = !!value;
    return (
      <>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5 }}>
        <span style={{ fontSize: 11, color: theme.textSec, width: 100, flexShrink: 0 }}>
          {meta.label}
        </span>
        <button
          onClick={() => onChange(!on)}
          style={{
            flex: 1, padding: "3px 0", borderRadius: 3, cursor: "pointer",
            fontSize: 11, fontFamily: "inherit", fontWeight: on ? 700 : 400,
            background: on ? "#c084fc" : "transparent",
            border: `1px solid ${on ? "#c084fc" : theme.borderSec}`,
            color: on ? "#000" : theme.textMuted,
            transition: "all 0.15s",
          }}
        >
          {on ? "ON" : "OFF"}
        </button>
      </div>
      <ParamDesc desc={meta.desc} theme={theme} />
      </>
    );
  }
  const fmt = meta.fmt ?? (v => String(v));
  return (
    <>
    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5 }}>
      <span style={{ fontSize: 11, color: theme.textSec, width: 100, flexShrink: 0 }}>
        {meta.label}
      </span>
      <input
        type="range"
        min={meta.min} max={meta.max} step={meta.step}
        // 저장값이 상한을 넘을 수 있다 (예: max_choch 상한이 실제 검출 개수로 좁혀진 경우).
        // 핸들이 범위 밖으로 나가지 않도록 표시만 클램프한다 — 저장값은 그대로 둔다.
        value={Math.min(Math.max(value, meta.min), meta.max)}
        onChange={e => {
          const raw = e.target.value;
          onChange(meta.step < 1 ? parseFloat(raw) : parseInt(raw, 10));
        }}
        style={{ flex: 1, cursor: "pointer", accentColor: "#c084fc" }}
      />
      <span style={{
        fontSize: 11, color: theme.textPrimary, width: 38, textAlign: "right",
        fontVariantNumeric: "tabular-nums", flexShrink: 0,
      }}>
        {fmt(value)}
      </span>
    </div>
    <ParamDesc desc={meta.desc} theme={theme} />
    </>
  );
}

function EmaSettingsPanel({ emaList, setEmaList, resetIndicator, theme }) {
  const nextId = () => (emaList.length ? Math.max(...emaList.map(e => e.id)) + 1 : 1);

  return (
    <div style={{ padding: "10px 12px", background: theme.bgCardAlt, borderTop: `1px solid ${theme.borderSec}` }}>
      {emaList.map(item => {
        const enabled = item.enabled !== false;
        return (
          <div key={item.id} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5, opacity: enabled ? 1 : 0.38 }}>
            <span style={{
              width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
              background: item.color ?? "#888888",
            }} />
            <span style={{ fontSize: 11, color: theme.textSec, width: 28, flexShrink: 0 }}>EMA</span>
            <input
              type="number"
              min={1} max={500}
              value={item.period}
              onChange={e => {
                const val = Math.max(1, Math.min(500, parseInt(e.target.value) || 1));
                setEmaList(emaList.map(x => x.id === item.id ? { ...x, period: val } : x));
              }}
              style={{
                flex: 1, background: theme.bgMain, border: `1px solid ${theme.borderSec}`,
                color: theme.textPrimary, fontSize: 12, padding: "2px 6px", borderRadius: 3,
                fontFamily: "inherit", textAlign: "center", outline: "none",
              }}
            />
            <button
              onClick={() => setEmaList(emaList.map(x => x.id === item.id ? { ...x, enabled: !enabled } : x))}
              title={enabled ? "숨기기" : "표시"}
              style={{
                width: 20, height: 20, borderRadius: 3,
                border: `1px solid ${enabled ? (item.color ?? "#888888") : theme.borderSec}`,
                background: enabled ? (item.color ?? "#888888") + "33" : "transparent",
                color: enabled ? (item.color ?? "#888888") : theme.textFaint,
                cursor: "pointer", fontSize: 10,
                display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "inherit",
              }}
            >●</button>
          </div>
        );
      })}
      <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
        <button
          onClick={() => resetIndicator("ema")}
          style={{
            flex: 1, padding: "4px 0", borderRadius: 4, border: `1px solid ${theme.borderSec}`,
            background: "transparent", color: theme.textMuted, fontSize: 11, cursor: "pointer", fontFamily: "inherit",
          }}
        >초기화</button>
        <button
          onClick={() => setEmaList([...emaList, { id: nextId(), period: 20, color: "#888888", enabled: true }])}
          style={{
            flex: 2, padding: "4px 0", borderRadius: 4, border: "none",
            background: "#c084fc", color: "#000", fontSize: 11, fontWeight: 700,
            cursor: "pointer", fontFamily: "inherit",
          }}
        >+ 추가</button>
      </div>
    </div>
  );
}

/**
 * 타임프레임 다중 선택 그리드 — RSI(표시 TF) / 수동 구조(표시 TF) / Pivot Levels(계산 TF) 공유.
 * 지표마다 **뜻이 다르므로**(표시 필터 vs 계산 대상) label로 구분해 붙인다.
 *
 * 저장은 항상 INTERVALS 순서로 정렬한다 — 클릭 순서대로 저장하면 같은 선택인데도
 * 배열이 달라져 재조회·재계산이 헛돈다.
 *
 * ⚠ **체크박스다. ON/OFF 버튼으로 되돌리지 말 것** (2026-08-14 사용자 요청 — 세 지표 전부).
 *   다중 선택이라는 게 모양에서 바로 읽혀야 한다. 버튼 스타일은 "하나만 고르는 것"처럼
 *   보였고, 바로 위 지표 행의 체크박스와도 어긋났다.
 *   체크 표식은 지표 행(IndicatorMenu 본문)과 **같은 규격**을 쓴다 — 13px, #c084fc, ✓.
 */
function TfGrid({ label, list, onChange, theme, emptyWarn }) {
  const toggle = (val) => {
    const next = list.includes(val) ? list.filter(v => v !== val) : [...list, val];
    onChange(INTERVALS.filter(i => next.includes(i.value)).map(i => i.value));
  };
  return (
    <>
      <div style={{ fontSize: 11, color: theme.textSec, marginBottom: 6 }}>{label}</div>
      {/* 3열 — 체크박스가 붙어 라벨 폭이 커졌다. 4열이면 "1시간"이 줄바꿈된다 */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "4px 2px" }}>
        {INTERVALS.map(iv => {
          const on = list.includes(iv.value);
          return (
            <div
              key={iv.value}
              onClick={() => toggle(iv.value)}
              style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "3px 2px", borderRadius: 3, cursor: "pointer",
                fontSize: 11, color: on ? theme.textPrimary : theme.textMuted,
                userSelect: "none",
              }}
              onMouseEnter={e => e.currentTarget.style.background = theme.borderSec}
              onMouseLeave={e => e.currentTarget.style.background = "transparent"}
            >
              <span style={{
                width: 12, height: 12, flexShrink: 0,
                border: `1.5px solid ${on ? "#c084fc" : theme.textFaint}`,
                borderRadius: 3,
                background: on ? "#c084fc" : "transparent",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 9, color: "#000", fontWeight: 700, lineHeight: 1,
                transition: "all 0.15s",
              }}>
                {on ? "✓" : ""}
              </span>
              {iv.label}
            </div>
          );
        })}
        {/* ※ 여기 있던 표시/숨김 버튼은 2026-08-13 사용자 요청으로 제거했다 —
            지표 행의 체크박스와 같은 값이라 중복이었다. 되살리지 말 것 */}
      </div>
      {list.length === 0 && emptyWarn && (
        <div style={{ fontSize: 10, color: "#f6465d", marginTop: 6, lineHeight: 1.4 }}>
          {emptyWarn}
        </div>
      )}
    </>
  );
}

// 수동 구조 설정 패널 — 표시 타임프레임 **전용**
//
// 표시 TF: 중복 선택, 기본 1h. 구조 데이터 자체는 전 TF 공유이고 여기서는
// "어느 TF에서 보여줄지"만 거른다. 선택 안 된 TF에서는 렌더·히트 판정이 막힌다
// (단, 지표 토글과 달리 그리기 버튼은 죽이지 않는다 — 구조 모드로 들어가면 TF가 자동 추가됨).
//
// CHoCH는 여기 없다 — 표시 on/off·개수·검출 개수 전부 구조별이라 각 구조의
// 더블클릭 팝업에서 조작한다 (Structures.jsx [R6]). 위 STRUCT 주석 참고.
function StructTfPanel({ structParams, setParam, resetIndicator, theme }) {
  const list = Array.isArray(structParams?.tfs) ? structParams.tfs : [];

  return (
    <div style={{ padding: "10px 12px", background: theme.bgCardAlt, borderTop: `1px solid ${theme.borderSec}` }}>
      <TfGrid
        label="표시 타임프레임" list={list} theme={theme}
        onChange={next => setParam("struct", "tfs", next)}
        emptyWarn="선택된 타임프레임이 없어 구조가 어디에도 표시되지 않고 그리기도 막힙니다."
      />

      <button
        onClick={() => resetIndicator("struct")}
        style={{
          width: "100%", marginTop: 8, padding: "4px 0", borderRadius: 4,
          border: `1px solid ${theme.borderSec}`, background: "transparent",
          color: theme.textMuted, fontSize: 11, cursor: "pointer", fontFamily: "inherit",
        }}
      >초기화</button>
    </div>
  );
}

/**
 * 피보나치 레벨 선택 패널 — **전역**이다 (2026-08-14 사용자 확정, chart/fib.js [F1]).
 * 여기서 고른 레벨이 차트의 모든 피보나치 도형에 함께 적용된다.
 *
 * ⚠ 도형별 레벨 편집(더블클릭 팝업)을 만들지 말 것 — 두 값이 생기면 AND로 걸리는지
 *   덮어쓰는지가 UI 어디에도 안 드러난다 (struct.show_choch에서 겪은 문제와 같다).
 *
 * TfGrid와 같은 체크박스 규격을 쓴다 (13px 아님, 12px — 후보가 10개라 3열이 필요하다).
 * 값이 숫자라 정렬은 chart/fib.js의 normFibLevels가 맡는다 — 클릭 순서로 저장하면
 * 같은 선택인데 배열이 달라져 useMemo가 헛돈다.
 */
function FibLevelPanel({ fibParams, setParam, resetIndicator, theme }) {
  const list = Array.isArray(fibParams?.levels) ? fibParams.levels : FIB_DEFAULT_LEVELS;
  const toggle = (r) => {
    const next = list.includes(r) ? list.filter(v => v !== r) : [...list, r];
    setParam("fib", "levels", FIB_ALL_LEVELS.filter(v => next.includes(v)));
  };

  return (
    <div style={{ padding: "10px 12px", background: theme.bgCardAlt, borderTop: `1px solid ${theme.borderSec}` }}>
      <div style={{ fontSize: 11, color: theme.textSec, marginBottom: 6 }}>
        표시할 레벨 (모든 피보나치 공통)
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "4px 2px" }}>
        {FIB_ALL_LEVELS.map(r => {
          const on = list.includes(r);
          return (
            <div
              key={r}
              onClick={() => toggle(r)}
              style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "3px 2px", borderRadius: 3, cursor: "pointer",
                fontSize: 11, color: on ? theme.textPrimary : theme.textMuted,
                fontVariantNumeric: "tabular-nums", userSelect: "none",
              }}
              onMouseEnter={e => e.currentTarget.style.background = theme.borderSec}
              onMouseLeave={e => e.currentTarget.style.background = "transparent"}
            >
              <span style={{
                width: 12, height: 12, flexShrink: 0,
                border: `1.5px solid ${on ? "#c084fc" : theme.textFaint}`,
                borderRadius: 3,
                background: on ? "#c084fc" : "transparent",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 9, color: "#000", fontWeight: 700, lineHeight: 1,
                transition: "all 0.15s",
              }}>
                {on ? "✓" : ""}
              </span>
              {r}
            </div>
          );
        })}
      </div>
      {/* 1 초과는 되돌림이 아니라 추세 시작점을 뚫고 더 간 자리 — 뜻이 다르니 적어 둔다 */}
      <div style={{ fontSize: 10, color: theme.textMuted, marginTop: 6, lineHeight: 1.4 }}>
        1 초과(1.272·1.414·1.618)는 되돌림이 아니라 돌파 후 확장 목표가입니다.
      </div>
      {list.length === 0 && (
        <div style={{ fontSize: 10, color: "#f6465d", marginTop: 6, lineHeight: 1.4 }}>
          선택된 레벨이 없어 가로선이 하나도 그려지지 않습니다. (앵커 대각선만 남습니다)
        </div>
      )}

      <button
        onClick={() => resetIndicator("fib")}
        style={{
          width: "100%", marginTop: 8, padding: "4px 0", borderRadius: 4,
          border: `1px solid ${theme.borderSec}`, background: "transparent",
          color: theme.textMuted, fontSize: 11, cursor: "pointer", fontFamily: "inherit",
        }}
      >초기화</button>
    </div>
  );
}

function VolColorPanel({ colorMode, setParam, theme }) {
  const modes = [
    { value: "neutral", label: "단색" },
    { value: "candle",  label: "캔들 색상" },
  ];
  return (
    <div style={{ padding: "10px 12px", background: theme.bgCardAlt, borderTop: `1px solid ${theme.borderSec}` }}>
      <div style={{ fontSize: 11, color: theme.textSec, marginBottom: 6 }}>바 색상</div>
      <div style={{ display: "flex", gap: 6 }}>
        {modes.map(m => (
          <button key={m.value} onClick={() => setParam("vol", "colorMode", m.value)} style={{
            flex: 1, padding: "5px 0", borderRadius: 4, cursor: "pointer",
            fontSize: 11, fontFamily: "inherit", fontWeight: colorMode === m.value ? 700 : 400,
            background: colorMode === m.value ? "#c084fc" : "transparent",
            border: `1px solid ${colorMode === m.value ? "#c084fc" : theme.borderSec}`,
            color: colorMode === m.value ? "#000" : theme.textMuted,
            transition: "all 0.15s",
          }}>{m.label}</button>
        ))}
      </div>
    </div>
  );
}

function SettingsPanel({ indKey, params, setParam, resetIndicator, theme }) {
  const metas   = PARAMS_META[indKey] || [];
  const isZZ    = indKey === "zz";
  const isRSI   = indKey === "rsi";
  const isPivot = indKey === "pivot";
  const indParams = params[indKey] || {};

  // ZZ: 검출된 CHoCH 개수 표시용 (모듈 상태 직접 조회 — 메뉴를 여는 시점의 값).
  // CHoCH 표시 개수(max_choch) 슬라이더의 상한이기도 하다.
  const zzTotal = isZZ ? getZzChochTotal() : 0;

  // RSI: 검출된 과매수/과매도 구간 개수 — ZZ와 같은 이유로 모듈 상태 직접 조회.
  // ※ 예전엔 개수 슬라이더의 상한이기도 했다. 그 슬라이더는 2026-08-15에 제거됐고
  //   지금은 순수 정보 표시다 (실제로 칠하는 건 마지막 연속 구간뿐이다)
  const zoneTotal = isRSI ? getRsiZoneCount() : 0;

  return (
    <div style={{
      padding: "10px 12px",
      background: theme.bgCardAlt,
      borderTop: `1px solid ${theme.borderSec}`,
    }}>
      {isZZ  && <DetectedCountRow label="CHoCH"        total={zzTotal}   theme={theme} />}
      {isRSI && <DetectedCountRow label="과매수/과매도" total={zoneTotal} theme={theme} />}
      {/* RSI: **구간 배경만** 거르는 필터다 (2026-08-14 사용자 확정).
          RSI 패널(선)은 이 목록과 무관하게 전 TF에서 보인다 — App.jsx의 showRsi(패널) /
          showRsiZones(배경)로 나뉘어 있다. 라벨에 "구간 배경"을 꼭 적을 것:
          그냥 "표시 타임프레임"이면 RSI 전체가 사라지는 줄 안다.
          알림(NotificationMenu의 TF별 RSI 과매수/과매도)도 이것과 무관하게 계속 울린다 */}
      {isRSI && (
        <div style={{ marginBottom: 10 }}>
          <TfGrid
            label="구간 배경 표시 타임프레임 (RSI 패널은 전 TF)"
            list={Array.isArray(indParams.tfs) ? indParams.tfs : []}
            theme={theme}
            onChange={next => setParam("rsi", "tfs", next)}
            emptyWarn="선택된 타임프레임이 없어 구간 배경이 어디에도 표시되지 않습니다. (RSI 패널·알림은 계속 동작)"
          />
        </div>
      )}
      {/* Pivot: TF 선택은 "표시 필터"가 아니라 **계산 대상**이다 — 여기서 고른 TF의
          레벨이 차트 TF와 무관하게 전 프레임에 똑같이 뜬다 (선 오른쪽 끝에 TF 태그) */}
      {isPivot && (
        <div style={{ marginBottom: 10 }}>
          <TfGrid
            label="레벨 계산 타임프레임 (모든 프레임에 함께 표시)"
            list={Array.isArray(indParams.tfs) ? indParams.tfs : []}
            theme={theme}
            onChange={next => setParam("pivot", "tfs", next)}
            emptyWarn="선택된 타임프레임이 없어 표시할 레벨이 없습니다."
          />
        </div>
      )}
      {metas.map(m => (
        <ParamSlider
          key={m.key}
          meta={m}
          value={indParams[m.key] ?? INDICATOR_DEFAULTS[indKey][m.key]}
          onChange={val => setParam(indKey, m.key, val)}
          theme={theme}
        />
      ))}
      {/* ZZ CHoCH — **ZZ 선 더블클릭 팝업과 같은 값**을 가리키는 거울이다
          (zz.show_choch / zz.max_choch). 한쪽에서 바꾸면 다른 쪽도 바뀐다.
          팝업과 순서를 같게 유지할 것 — 표시 → 개수.
          ※ `거래량 비교`는 여기 없다 — 자동 ZZ의 거래량 비교는 2026-08-14 사용자 요청으로
            기능째로 제거됐다 (거래량 3줄은 수동 구조 전용). 되살리지 말 것
          ※ 수동 구조(struct)에는 이 블록이 없다. 저쪽 값은 전부 **구조별**(localStorage)이라
            지표 메뉴가 가리킬 값 자체가 없다 (Structures.jsx [R6]).
            여기에 struct용 전역 값을 새로 만들지 말 것 — 구조별 값과 AND로 걸려
            전역 OFF일 때 구조별 ON이 먹지 않는데 그 사실이 구조 팝업에 안 보인다 */}
      {isZZ && (
        <>
          <ParamSlider
            meta={{ key: "show_choch", label: "CHoCH 표시", type: "toggle" }}
            value={indParams.show_choch !== false}
            onChange={v => setParam("zz", "show_choch", v)}
            theme={theme}
          />
          <RecentCountSlider
            label="CHoCH 개수" value={indParams.max_choch} detected={zzTotal}
            onChange={n => setParam("zz", "max_choch", n)}
            theme={theme}
          />
        </>
      )}
      {/* ※ RSI `구간 개수` 슬라이더는 2026-08-15 사용자 요청으로 제거됐다.
          이제 몇 개를 칠할지는 설정이 아니라 데이터가 정한다 — 마지막 구간과 같은
          종류로 **연속된 꼬리**만 나온다 (overlayRenderers의 lastRsiZoneRun).
          같은 날 추가된 `구간 배경 전체 표시`(zone_all)는 그 규칙의 on/off일 뿐
          개수 노브가 아니다 — 켜면 검출된 전 구간이 그대로 나온다. 슬라이더로 되돌리지 말 것 */}
      <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
        <button
          onClick={() => resetIndicator(indKey)}
          style={{
            flex: 1, padding: "4px 0", borderRadius: 4,
            border: `1px solid ${theme.borderSec}`,
            background: "transparent", color: theme.textMuted,
            fontSize: 11, cursor: "pointer", fontFamily: "inherit",
          }}
        >
          초기화
        </button>
        {/* ※ 구 S/R Levels의 "적용 (KDE 재실행)" 버튼은 지표째로 제거됐다 (2026-08-13).
            남은 지표는 전부 프론트에서 즉시 계산되므로 수동 재실행이 필요 없다 */}
      </div>
    </div>
  );
}

export function IndicatorMenu({ indicators, onToggle, params, setParam, setEmaList, resetIndicator }) {
  const { theme } = useTheme();
  const [open,        setOpen]        = useState(false);
  const [openSetting, setOpenSetting] = useState(null); // 열린 설정 패널 key
  const ref = useRef(null);

  useEffect(() => {
    const onDown = e => { if (ref.current && !ref.current.contains(e.target)) { setOpen(false); setOpenSetting(null); } };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const isOn  = key => indicators[key] !== false;
  const onCnt = INDICATORS.filter(i => isOn(i.key)).length;

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button onClick={() => setOpen(o => !o)} style={{
        height: "22px", padding: "0 7px",
        borderRadius: "3px", cursor: "pointer", flexShrink: 0,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: "12px", fontFamily: "inherit", fontWeight: "400",
        background: open ? theme.borderSec : "transparent",
        border: `1px solid ${open ? theme.textMuted : theme.textFaint}`,
        color: theme.textMuted,
        transition: "all 0.15s",
        whiteSpace: "nowrap",
      }}>
        지표{onCnt < INDICATORS.length ? ` ${onCnt}/${INDICATORS.length}` : ""} ▾
      </button>

      {open && (
        <div style={{
          position: "absolute", top: "30px", left: 0, zIndex: 200,
          background: theme.bgCard,
          border: `1px solid ${theme.borderSec}`,
          borderRadius: "6px",
          overflow: "hidden",
          minWidth: "220px",
          boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
        }}>
          {INDICATORS.map(ind => {
            const on         = isOn(ind.key);
            const settingOpen = openSetting === ind.key;
            return (
              <div key={ind.key}>
                {/* 지표 행 */}
                <div style={{
                  display: "flex", alignItems: "center",
                  padding: "6px 10px 6px 14px",
                  borderBottom: settingOpen ? `1px solid ${theme.borderSec}` : "none",
                }}>
                  {/* 체크박스 + 라벨 */}
                  <div
                    onClick={() => onToggle(ind.key)}
                    style={{
                      display: "flex", alignItems: "center", gap: "9px",
                      flex: 1, cursor: "pointer",
                      fontSize: "13px",
                      color: on ? theme.textPrimary : theme.textMuted,
                    }}
                    onMouseEnter={e => e.currentTarget.parentElement.style.background = theme.borderSec}
                    onMouseLeave={e => e.currentTarget.parentElement.style.background = "transparent"}
                  >
                    <span style={{
                      width: "13px", height: "13px", flexShrink: 0,
                      border: `1.5px solid ${on ? "#c084fc" : theme.textFaint}`,
                      borderRadius: "3px",
                      background: on ? "#c084fc" : "transparent",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: "10px", color: "#000", fontWeight: "700",
                      transition: "all 0.15s",
                    }}>
                      {on ? "✓" : ""}
                    </span>
                    {ind.label}
                  </div>

                  {/* ⚙ 버튼 */}
                  <button
                    onClick={e => { e.stopPropagation(); setOpenSetting(k => k === ind.key ? null : ind.key); }}
                    style={{
                      width: 20, height: 20, borderRadius: 3,
                      border: `1px solid ${settingOpen ? "#c084fc" : theme.borderSec}`,
                      background: settingOpen ? "#c084fc22" : "transparent",
                      color: settingOpen ? "#c084fc" : theme.textFaint,
                      cursor: "pointer", fontSize: 12, flexShrink: 0,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontFamily: "inherit",
                    }}
                    title="파라미터 설정"
                  >
                    ⚙
                  </button>
                </div>

                {/* 설정 패널 (아코디언) */}
                {settingOpen && (
                  ind.key === "ema"
                    ? <EmaSettingsPanel
                        emaList={params.ema ?? []}
                        setEmaList={setEmaList}
                        resetIndicator={resetIndicator}
                        theme={theme}
                      />
                    : ind.key === "struct"
                    ? <StructTfPanel
                        structParams={params.struct ?? INDICATOR_DEFAULTS.struct}
                        setParam={setParam}
                        resetIndicator={resetIndicator}
                        theme={theme}
                      />
                    : ind.key === "fib"
                    ? <FibLevelPanel
                        fibParams={params.fib ?? INDICATOR_DEFAULTS.fib}
                        setParam={setParam}
                        resetIndicator={resetIndicator}
                        theme={theme}
                      />
                    : ind.key === "vol"
                    ? <VolColorPanel
                        colorMode={params.vol?.colorMode ?? "neutral"}
                        setParam={setParam}
                        theme={theme}
                      />
                    : <SettingsPanel
                        indKey={ind.key}
                        params={params}
                        setParam={setParam}
                        resetIndicator={resetIndicator}
                        theme={theme}
                      />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
