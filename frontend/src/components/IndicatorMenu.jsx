import { useState, useRef, useEffect } from "react";
import { useTheme } from "../ThemeContext";
import { INDICATOR_DEFAULTS } from "../hooks/useIndicatorParams";
import { getZzChochTotal } from "../chart/structureZigzag";
import { INTERVALS } from "../constants";

export const INDICATORS = [
  { key: "vol", label: "Volume" },
  { key: "rsi", label: "RSI" },
  { key: "sr",  label: "S/R Levels" },
  { key: "ob",  label: "Order Block" },
  { key: "fvg", label: "FVG" },
  { key: "zz",  label: "Structure Zigzag" },
  // 수동 구조 표시 토글 — 자동 ZZ와 독립. 파라미터 없음(PARAMS_META에 항목 없음)
  // ※ key는 "struct" 유지 — 바꾸면 localStorage("indicators")에 저장된 on/off가 초기화된다
  // ⚙ 설정은 표시 타임프레임 선택(StructTfPanel) — 슬라이더 파라미터는 없다
  { key: "struct", label: "Custom Structure Zigzag" },
  { key: "ema", label: "EMA" },
];

// 각 지표별 파라미터 슬라이더 정의
const PARAMS_META = {
  rsi: [
    { key: "period",     label: "기간",     min: 2,    max: 50,  step: 1 },
    { key: "overbought", label: "과매수",   min: 51,   max: 95,  step: 1 },
    { key: "oversold",   label: "과매도",   min: 5,    max: 49,  step: 1 },
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
    // max_choch의 상한은 실제 검출 개수로 SettingsPanel에서 덮어쓴다.
    { key: "max_choch",  label: "CHoCH 표시 개수", min: 1,  max: 30,    step: 1  },
    { key: "show_choch", label: "CHoCH 표시",     type: "toggle" },
  ],
  sr: [
    { key: "kde_range",       label: "분석 범위(%)",  min: 5,    max: 40,   step: 1,    fmt: v => v + "%" },
    { key: "persistence_atr", label: "스윙 최소크기", min: 0.1,  max: 2.0,  step: 0.1,  fmt: v => v.toFixed(1) },
    { key: "bandwidth_atr",   label: "커널 폭",       min: 0.05, max: 1.0,  step: 0.05, fmt: v => v.toFixed(2) },
    { key: "peak_min_pers",   label: "피크 필터",     min: 0.01, max: 0.30, step: 0.01, fmt: v => v.toFixed(2) },
    { key: "limit",           label: "데이터량(봉)",  min: 200,  max: 1500, step: 100 },
    { key: "top_n",           label: "표시 레벨수",   min: 3,    max: 15,   step: 1   },
  ],
};

function ParamSlider({ meta, value, onChange, theme }) {
  if (meta.type === "toggle") {
    const on = !!value;
    return (
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
    );
  }
  const fmt = meta.fmt ?? (v => String(v));
  return (
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

// 수동 구조를 표시할 타임프레임 선택 (중복 선택, 기본 1h)
// 구조 데이터 자체는 전 TF 공유이고 여기서는 "어느 TF에서 보여줄지"만 거른다.
// 선택 안 된 TF에서는 지표 OFF와 동일 — 렌더·히트 판정·그리기 전부 막힌다.
function StructTfPanel({ tfs, setParam, resetIndicator, theme }) {
  const list = Array.isArray(tfs) ? tfs : [];
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
  const indParams = params[indKey] || {};

  // ZZ: 현재 검출된 CHoCH 개수를 읽어 슬라이더 상한(1~N)으로 쓴다.
  // 모듈 상태 직접 조회라 메뉴를 여는 시점의 값이며, 열려 있는 동안은 갱신되지 않는다.
  const zzTotal = isZZ ? getZzChochTotal() : 0;
  const resolveMeta = meta =>
    (isZZ && meta.key === "max_choch") ? { ...meta, max: Math.max(1, zzTotal) } : meta;

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
      {isZZ && (
        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          marginBottom: 8, paddingBottom: 6,
          borderBottom: `1px solid ${theme.borderSec}`,
          fontSize: 11, color: theme.textSec,
        }}>
          <span>검출된 CHoCH</span>
          <span style={{
            color: zzTotal ? "#c084fc" : theme.textFaint, fontWeight: 700,
            fontVariantNumeric: "tabular-nums",
          }}>
            {zzTotal}개
          </span>
        </div>
      )}
      {metas.map(meta => {
        const m = resolveMeta(meta);
        return (
          <ParamSlider
            key={m.key}
            meta={m}
            value={indParams[m.key] ?? INDICATOR_DEFAULTS[indKey][m.key]}
            onChange={val => setParam(indKey, m.key, val)}
            theme={theme}
          />
        );
      })}
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
                        tfs={params.struct?.tfs ?? INDICATOR_DEFAULTS.struct.tfs}
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
