export function Confluence({ fvgData, obData, scales, IW }) {
  if (!fvgData?.length || !obData?.length || !scales) return null;
  const { xScale, yScale } = scales;

  const zones = [];
  for (const fvg of fvgData) {
    for (const ob of obData) {
      const overlapBottom = Math.max(fvg.bottom, ob.bottom);
      const overlapTop    = Math.min(fvg.top,    ob.top);
      if (overlapBottom >= overlapTop) continue;
      const t = fvg.t > ob.t ? fvg.t : ob.t; // 나중에 생긴 쪽 기준
      zones.push({ bottom: overlapBottom, top: overlapTop, t });
    }
  }

  if (!zones.length) return null;

  return (
    <g style={{ pointerEvents: "none" }}>
      {zones.map((z, i) => {
        const x1   = Math.max(0, xScale(new Date(z.t)));
        const x2   = IW;
        if (x1 >= x2) return null;
        const yTop = yScale(z.top);
        const yBot = yScale(z.bottom);
        const h    = Math.max(yBot - yTop, 2);

        return (
          <g key={i}>
            <rect x={x1} y={yTop} width={x2 - x1} height={h}
              fill="#f0b90b" fillOpacity={0.2} />
            <text x={x1 + 3} y={yTop + 9}
              fill="#f0b90b" fillOpacity={0.7} fontSize={10} fontWeight="600">
              CF
            </text>
          </g>
        );
      })}
    </g>
  );
}
