import { memo } from "react";
import * as d3 from "d3";

const COLOR = {
  regular_bull: "#0ecb81",
  regular_bear: "#f6465d",
  hidden_bull:  "#f59e0b",
  hidden_bear:  "#f59e0b",
};

export const DivergenceLines = memo(function DivergenceLines({ divData, xScale, rsiH }) {
  if (!divData?.length || !xScale) return null;

  const yScale = d3.scaleLinear().domain([0, 100]).range([rsiH, 0]);

  return (
    <g style={{ pointerEvents: "none" }}>
      {divData.map((d, i) => {
        const x1    = xScale(d.i1);
        const x2    = xScale(d.i2);
        const y1    = yScale(d.r1);
        const y2    = yScale(d.r2);
        const color = COLOR[`${d.type}_${d.dir}`];
        const label = d.type === "hidden" ? "HD" : "D";

        return (
          <g key={i}>
            <line x1={x1} y1={y1} x2={x2} y2={y2}
              stroke={color} strokeWidth={1.5} strokeDasharray="4,3" opacity={0.85} />
            <circle cx={x1} cy={y1} r={3} fill={color} opacity={0.85} />
            <circle cx={x2} cy={y2} r={3} fill={color} opacity={0.85} />
            <text x={x2 + 4} y={y2 + 4}
              fill={color} fontSize={10} fontWeight="700" opacity={0.85}>
              {label}
            </text>
          </g>
        );
      })}
    </g>
  );
});
