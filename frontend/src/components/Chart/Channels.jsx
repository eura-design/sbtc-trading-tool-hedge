import { memo } from "react";
import { SEL_HANDLE_R } from "../../constants";
import { tsToIdx } from "../../chart/scales";
import { clipSegmentX, VIEW_PAD } from "../../chart/svgGeom";

const CHANNEL_COLOR = "#888888";

/**
 * 채널 데이터: { id, t1, p1, t2, p2, offset, opacity, locked }
 * 메인 라인: (t1,p1) → (t2,p2)
 * 미러 라인: (t1, p1+offset) → (t2, p2+offset)
 */
export const Channels = memo(function Channels({
  channels, selectedChannelId,
  channelStep, channelPoints, channelPreview,
  scales, IW, IH, candles, isLog,
}) {
  if (!scales || !candles?.length) return null;
  const { xScale, yScale } = scales;

  function toXY(t, p) {
    const idx = tsToIdx(t, candles);
    return { x: xScale(idx), y: yScale(p) };
  }

  // offset 적용: 채널 생성 시점의 isLog 기준 (현재 스케일 무관)
  function applyOffset(ch, price, useOffset2 = false) {
    const off = useOffset2 ? (ch.offset2 ?? ch.offset) : ch.offset;
    return ch.isLog ? price * off : price + off;
  }

  return (
    <g style={{ pointerEvents: "none" }}>
      {/* 저장된 채널들 */}
      {channels.map(ch => {
        const a1 = toXY(ch.t1, ch.p1);
        const b1 = toXY(ch.t2, ch.p2);
        const a2 = toXY(ch.t1, applyOffset(ch, ch.p1, false));
        const b2 = toXY(ch.t2, applyOffset(ch, ch.p2, true));
        const selected = ch.id === selectedChannelId;
        const alert    = !!ch.alert;
        const color    = selected ? "#f0b90b" : alert ? "#fbbf24" : CHANNEL_COLOR;
        const opacity  = ch.opacity ?? 1.0;
        const sw       = selected || alert ? 1.5 : 1;
        // 뷰포트로 자른다 — 알림 ON이면 점선이라, 화면 밖 수만 px까지 뻗은 선이
        // 그 길이만큼 점선 조각으로 펼쳐진다 (chart/svgGeom.js 주석의 5m 실측 참고)
        const s1 = clipSegmentX(a1.x, a1.y, b1.x, b1.y, -VIEW_PAD, IW + VIEW_PAD);
        const s2 = clipSegmentX(a2.x, a2.y, b2.x, b2.y, -VIEW_PAD, IW + VIEW_PAD);
        if (!s1 && !s2) return null;                    // 완전히 화면 밖

        return (
          <g key={ch.id}>
            {/* 메인 라인 */}
            {s1 && <line x1={s1.x1} y1={s1.y1} x2={s1.x2} y2={s1.y2}
              stroke={color} strokeWidth={sw} opacity={opacity}
              strokeDasharray={alert && !selected ? "6,3" : undefined} />}
            {/* 미러 라인 */}
            {s2 && <line x1={s2.x1} y1={s2.y1} x2={s2.x2} y2={s2.y2}
              stroke={color} strokeWidth={sw} opacity={opacity}
              strokeDasharray={alert && !selected ? "6,3" : undefined} />}
            {/* ※ 알림 ON을 나타내던 🔔 아이콘은 2026-08-14 사용자 요청으로 제거.
                알림 여부는 **호박색 + 점선**만으로 나타낸다 (선/원/수동 구조도 동일) */}
            {/* 선택 핸들 — **메인 3 + 미러 3, 총 6개** (2026-08-24 사용자 요청).
                예전엔 가운데 점이 미러 쪽에만 있어 5개였다.
                가운데 점의 규칙은 양쪽이 같다: **그 점이 있는 선만 움직이고
                반대쪽 선은 제자리** → 폭이 바뀐다 (dragStateMachine의
                channel_mid_main / channel_mid_offset).
                ⚠ 좌표는 히트 판정(hitDetection 4.7)과 같아야 한다 — 각자 계산하면
                  보이는 자리와 잡히는 자리가 어긋난다 */}
            {selected && <>
              <circle cx={a1.x} cy={a1.y} r={SEL_HANDLE_R} fill="#f0b90b" opacity={0.9} />
              <circle cx={(a1.x+b1.x)/2} cy={(a1.y+b1.y)/2} r={SEL_HANDLE_R} fill="#f0b90b" opacity={0.9} />
              <circle cx={b1.x} cy={b1.y} r={SEL_HANDLE_R} fill="#f0b90b" opacity={0.9} />
              <circle cx={a2.x} cy={a2.y} r={SEL_HANDLE_R} fill="#f0b90b" opacity={0.9} />
              <circle cx={(a2.x+b2.x)/2} cy={(a2.y+b2.y)/2} r={SEL_HANDLE_R} fill="#f0b90b" opacity={0.9} />
              <circle cx={b2.x} cy={b2.y} r={SEL_HANDLE_R} fill="#f0b90b" opacity={0.9} />
            </>}
          </g>
        );
      })}

      {/* 그리기 프리뷰 */}
      {channelStep === 1 && channelPoints && channelPreview && (() => {
        const a = toXY(channelPoints.t1, channelPoints.p1);
        const b = toXY(channelPreview.t, channelPreview.p);
        return (
          <g>
            <line x1={a.x} y1={a.y} x2={b.x} y2={b.y}
              stroke={CHANNEL_COLOR} strokeWidth={1} opacity={0.5} strokeDasharray="4,3" />
            <circle cx={a.x} cy={a.y} r={3} fill={CHANNEL_COLOR} opacity={0.7} />
          </g>
        );
      })()}

      {channelStep === 2 && channelPoints && channelPreview?.offset != null && (() => {
        const { t1, p1, t2, p2 } = channelPoints;
        const offset = channelPreview.offset;
        const a1 = toXY(t1, p1);
        const b1 = toXY(t2, p2);
        const a2 = toXY(t1, applyOffset({ isLog, offset }, p1));
        const b2 = toXY(t2, applyOffset({ isLog, offset }, p2));
        return (
          <g>
            <line x1={a1.x} y1={a1.y} x2={b1.x} y2={b1.y}
              stroke={CHANNEL_COLOR} strokeWidth={1} opacity={0.7} />
            <line x1={a2.x} y1={a2.y} x2={b2.x} y2={b2.y}
              stroke={CHANNEL_COLOR} strokeWidth={1} opacity={0.5} strokeDasharray="4,3" />
          </g>
        );
      })()}
    </g>
  );
});
