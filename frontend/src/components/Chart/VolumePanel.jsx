import { memo } from "react";
import * as d3 from "d3";
import { useTheme } from "../../ThemeContext";

const C_VOL = "#888888";

function fmtVol(v) {
  if (v == null) return "";
  if (v >= 1e9) return (v / 1e9).toFixed(2) + "B";
  if (v >= 1e6) return (v / 1e6).toFixed(2) + "M";
  if (v >= 1e3) return (v / 1e3).toFixed(1) + "K";
  return v.toFixed(2);
}

export const VolumePanel = memo(function VolumePanel({ candles, xScale, IW, volH }) {
  const { theme, isDark } = useTheme();

  if (!candles?.length || !xScale || !volH) return null;

  const [i0Raw, i1Raw] = xScale.domain();
  const i0 = Math.max(0, Math.floor(i0Raw));
  const i1 = Math.min(candles.length - 1, Math.ceil(i1Raw));
  const visible = candles.slice(i0, i1 + 1);

  const maxVol = d3.max(visible, d => d.v) || 1;
  const yScale = d3.scaleLinear().domain([0, maxVol]).range([volH, 0]);

  const span = i1Raw - i0Raw;
  const barW = Math.max(1, IW / span * 0.6);

  const last = candles[candles.length - 1];

  return (
    <>
      <line x1={0} x2={IW} y1={0} y2={0}
        stroke={theme.borderSec} strokeWidth={1} opacity={0.4} />
      <rect x={0} y={1} width={IW} height={volH - 1}
        fill={isDark ? "#060a12" : "#f8fafc"} opacity={0.55} />

      {visible.map((d, idx) => {
        const i  = i0 + idx;
        const cx = xScale(i);
        const h  = Math.max(1, volH - yScale(d.v));
        return (
          <rect key={i} x={cx - barW / 2} y={volH - h}
            width={barW} height={h}
            fill={C_VOL} opacity={0.5} />
        );
      })}

      <text x={4} y={10} fill={theme.textFaint} fontSize={10} opacity={0.55}>VOL</text>
      {last && (
        <text x={IW - 2} y={10} fill={C_VOL}
          fontSize={11} textAnchor="end" fontWeight="700">
          {fmtVol(last.v)}
        </text>
      )}
    </>
  );
});
