import { useState, useRef, useEffect } from "react";
import { useTheme } from "../ThemeContext";
import { INDICATOR_DEFAULTS } from "../hooks/useIndicatorParams";
import { getZzChochTotal } from "../chart/structureZigzag";
import { getRsiZoneCount } from "../chart/overlayRenderers";
import { INTERVALS } from "../constants";

export const INDICATORS = [
  { key: "vol", label: "Volume" },
  { key: "rsi", label: "RSI" },
  { key: "sr",  label: "S/R Levels" },
  { key: "ob",  label: "Order Block" },
  { key: "fvg", label: "FVG" },
  { key: "zz",  label: "Structure Zigzag" },
  // 수동 구조 표시 토글 — 자동 ZZ와 독립
  // ※ key는 "struct" 유지 — 바꾸면 localStorage("indicators")에 저장된 on/off가 초기화된다
  // ⚙ 설정은 전용 패널(StructTfPanel): 표시 타임프레임 + CHoCH 표시 개수/on-off
  { key: "struct", label: "Custom Structure Zigzag" },
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
    // CHoCH 관련(show_choch 표시 on/off, max_choch 개수)은 여기 없다 —
    // 전부 **ZZ 선 더블클릭 팝업**에 있다 (2026-08-12 사용자 요청으로 메뉴 쪽 중복 제거).
    // show_choch는 팝업과 **같은 값**(zz.show_choch)을 가리켜 두 곳에 둘 이유가 없었다.
  ],
  // S/R은 원래 6개였다. 그중 4개(persistence/bandwidth/peak + top_n)가 전부
  // "레벨이 몇 개 나오나"를 서로 다른 지점에서 건드려서, 사용자가 방향을 잡을 수 없었다
  // (실제로 전부 최대로 둔 채 쓰고 있었고, 그러면 필터가 이겨서 레벨이 4개만 나왔다 —
  //  올릴수록 늘어나는 top_n/limit/kde_range와 줄어드는 필터 3개가 서로 상쇄된다).
  //
  // ⚠ 아래 3개만 노출한다. 나머지 kde_range / limit / persistence_atr은
  //   INDICATOR_DEFAULTS에 값으로 남아 KDE.py에 그대로 전달되지만 **UI에는 없다**.
  //   숨긴 이유는 useIndicatorParams.js의 sr 주석 참고 — 특히 persistence_atr은
  //   단조롭지 않아서(조이면 오히려 레벨이 늘어난다) 노브로 두면 안 된다.
  sr: [
    // bandwidth는 기존 상한(1.0) 유지 — 전부 최대에 붙어 있던 건 범위가 좁아서가 아니라
    // 필터끼리 상쇄돼서였다. peak_min_pers만 0.30 → 0.50으로 넓혔다 (2026-08-13 사용자 요청):
    // 필터가 2개로 정리되면서 "센 것만" 쪽 여유가 필요해졌다. KDE.py에는 상한이 없다
    { key: "bandwidth_atr", label: "레벨 병합 폭", min: 0.1, max: 1.0, step: 0.05,
      fmt: v => v.toFixed(2),
      desc: "가까운 가격을 한 레벨로 합치는 폭. 올리면 촘촘한 레벨이 뭉쳐 개수가 준다" },
    { key: "peak_min_pers", label: "약한 레벨 컷", min: 0.02, max: 0.50, step: 0.02,
      fmt: v => v.toFixed(2),
      desc: "가장 강한 레벨 대비 이만큼 못 미치는 레벨은 버린다. 올릴수록 센 것만 남는다" },
    { key: "top_n", label: "표시 개수", min: 2, max: 12, step: 1,
      fmt: v => v + "개",
      desc: "위/아래 각각 현재가에서 가까운 순으로 이만큼만. 실제로는 위 두 필터를 통과한 만큼만 나온다" },
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
 * "최근 N개만" 슬라이더 — 상한이 **실제 검출 개수**라 데이터에 따라 움직인다.
 *
 * 구조/ZZ 팝업의 CHoCH 개수 슬라이더(LineOpacityPopup::CountRow)와 같은 규칙:
 * 끝까지 올리면 `null`(= 전체)로 저장한다. 숫자로 고정해두면 구간이 늘어났을 때
 * 새 밴드가 조용히 잘린다.
 */
function RecentCountSlider({ label, value, detected, onChange, theme }) {
  const hi  = Math.max(1, detected);
  const all = value == null || value >= hi;
  const cur = all ? hi : Math.max(1, value);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5 }}>
      <span style={{ fontSize: 11, color: theme.textSec, width: 100, flexShrink: 0 }}>
        {label}
      </span>
      <input
        type="range" min={1} max={hi} step={1} value={cur}
        disabled={detected === 0}
        onChange={e => {
          const n = parseInt(e.target.value, 10);
          onChange(n >= hi ? null : n);      // 끝까지 올리면 제한 해제
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
  const toggle = (val) => {
    const next = list.includes(val) ? list.filter(v => v !== val) : [...list, val];
    // INTERVALS 순서로 정렬해 저장 — 클릭 순서에 따라 표시가 뒤섞이지 않게
    setParam("struct", "tfs", INTERVALS.filter(i => next.includes(i.value)).map(i => i.value));
  };

  return (
    <div style={{ padding: "10px 12px", background: theme.bgCardAlt, borderTop: `1px solid ${theme.borderSec}` }}>
      <div style={{ fontSize: 11, color: theme.textSec, marginBottom: 6 }}>표시 타임프레임</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 4 }}>
        {INTERVALS.map(iv => {
          const on = list.includes(iv.value);
          return (
            <button key={iv.value} onClick={() => toggle(iv.value)} style={{
              padding: "4px 0", borderRadius: 4, cursor: "pointer",
              fontSize: 11, fontFamily: "inherit", fontWeight: on ? 700 : 400,
              background: on ? "#c084fc" : "transparent",
              border: `1px solid ${on ? "#c084fc" : theme.borderSec}`,
              color: on ? "#000" : theme.textMuted,
              transition: "all 0.15s",
            }}>{iv.label}</button>
          );
        })}
      </div>
      {list.length === 0 && (
        <div style={{ fontSize: 10, color: "#f6465d", marginTop: 6, lineHeight: 1.4 }}>
          선택된 타임프레임이 없어 구조가 어디에도 표시되지 않고 그리기도 막힙니다.
        </div>
      )}

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

function SettingsPanel({ indKey, params, setParam, resetIndicator, theme, srLoading, refreshSR }) {
  const [srStatus, setSrStatus] = useState(null); // null | 'ok' | 'err'
  const metas   = PARAMS_META[indKey] || [];
  const isSR    = indKey === "sr";
  const isZZ    = indKey === "zz";
  const isRSI   = indKey === "rsi";
  const indParams = params[indKey] || {};

  // ZZ: 검출된 CHoCH 개수 표시용 (모듈 상태 직접 조회 — 메뉴를 여는 시점의 값).
  // 표시 개수 제한(max_choch)은 여기 없다 — ZZ 선 더블클릭 팝업으로 옮겼다.
  const zzTotal = isZZ ? getZzChochTotal() : 0;

  // RSI: 검출된 과매수/과매도 구간 개수 — ZZ와 같은 이유로 모듈 상태 직접 조회.
  // 개수 슬라이더(zone_max)의 상한이자 "몇 개 중 몇 개인지"를 보여주는 값이다.
  const zoneTotal = isRSI ? getRsiZoneCount() : 0;
  const zoneBgOn  = indParams.zone_bg !== false;

  const handleRefresh = async () => {
    setSrStatus(null);
    try {
      await refreshSR(indParams);
      setSrStatus('ok');
      setTimeout(() => setSrStatus(null), 3000);
    } catch {
      setSrStatus('err');
      setTimeout(() => setSrStatus(null), 4000);
    }
  };

  return (
    <div style={{
      padding: "10px 12px",
      background: theme.bgCardAlt,
      borderTop: `1px solid ${theme.borderSec}`,
    }}>
      {isZZ  && <DetectedCountRow label="CHoCH"        total={zzTotal}   theme={theme} />}
      {isRSI && <DetectedCountRow label="과매수/과매도" total={zoneTotal} theme={theme} />}
      {metas.map(m => (
        <ParamSlider
          key={m.key}
          meta={m}
          value={indParams[m.key] ?? INDICATOR_DEFAULTS[indKey][m.key]}
          onChange={val => setParam(indKey, m.key, val)}
          theme={theme}
        />
      ))}
      {/* 구간 개수는 상한이 검출 개수라 정적 PARAMS_META로 못 만든다 → 전용 슬라이더.
          배경이 꺼져 있으면 조절할 대상이 없으므로 같이 숨긴다 */}
      {isRSI && zoneBgOn && (
        <RecentCountSlider
          label="구간 개수" value={indParams.zone_max} detected={zoneTotal}
          onChange={n => setParam("rsi", "zone_max", n)}
          theme={theme}
        />
      )}
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
        {isSR && (
          <button
            onClick={handleRefresh}
            disabled={srLoading}
            style={{
              flex: 2, padding: "4px 0", borderRadius: 4,
              border: "none",
              background: srLoading ? theme.borderSec
                        : srStatus === 'ok'  ? "#0ecb81"
                        : srStatus === 'err' ? "#f6465d"
                        : "#c084fc",
              color: srLoading ? theme.textMuted : "#000",
              fontSize: 11, fontWeight: 700, cursor: srLoading ? "not-allowed" : "pointer",
              fontFamily: "inherit",
              transition: "background 0.2s",
            }}
          >
            {srLoading        ? "계산 중..."
             : srStatus === 'ok'  ? "완료!"
             : srStatus === 'err' ? "실패 (콘솔 확인)"
             : "적용 (KDE 재실행)"}
          </button>
        )}
      </div>
    </div>
  );
}

export function IndicatorMenu({ indicators, onToggle, params, setParam, setEmaList, resetIndicator, srLoading, refreshSR }) {
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
                        srLoading={srLoading}
                        refreshSR={refreshSR}
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
