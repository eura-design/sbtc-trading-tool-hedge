import { HIT } from "../constants";
import { distToSeg } from "../utils/hitTest";
import { tsToIdx } from "./scales";
import { channelXYs, lineXY } from "./hitDetection";

export const CURSOR_RULES = [
  {
    test: ({ selectedLineId, lines, pos, xScale, yScale, candles }) => {
      if (selectedLineId === null) return false;
      const ln = lines.find(l => l.id === selectedLineId);
      if (!ln) return false;
      const { x: ax, y: ay } = lineXY(ln.t1, ln.p1, candles, xScale, yScale);
      const { x: bx, y: by } = lineXY(ln.t2, ln.p2, candles, xScale, yScale);
      return Math.hypot(pos.x-ax, pos.y-ay) < 10 || Math.hypot(pos.x-bx, pos.y-by) < 10;
    },
    cursor: "move",
  },
  {
    test: ({ selectedLineId, lines, pos, xScale, yScale, candles }) => {
      if (selectedLineId === null) return false;
      const ln = lines.find(l => l.id === selectedLineId);
      if (!ln) return false;
      const { x: ax, y: ay } = lineXY(ln.t1, ln.p1, candles, xScale, yScale);
      const { x: bx, y: by } = lineXY(ln.t2, ln.p2, candles, xScale, yScale);
      if (Math.hypot(pos.x-ax, pos.y-ay) < 10 || Math.hypot(pos.x-bx, pos.y-by) < 10) return false;
      return distToSeg(pos.x, pos.y, ax, ay, bx, by) < 8;
    },
    cursor: "move",
  },
  {
    test: ({ hasPos, tpsl, pos, yScale }) => {
      if (!hasPos || !tpsl || pos.x < 0 || pos.x > 60) return false;
      const prices = [
        tpsl.long?.tp?.price, tpsl.long?.sl?.price,
        tpsl.short?.tp?.price, tpsl.short?.sl?.price,
      ].filter(p => p != null);
      return prices.some(p => Math.abs(pos.y - yScale(p)) < HIT);
    },
    cursor: "ns-resize",
  },
  {
    test: ({ scaleInOrders, pos, yScale }) => {
      if (!scaleInOrders?.length || pos.x < 0 || pos.x > 60) return false;
      return scaleInOrders.some(o => Math.abs(pos.y - yScale(o.price)) < HIT);
    },
    cursor: "ns-resize",
  },
  {
    test: ({ splitTps, pos, yScale }) => {
      if (!splitTps?.length || pos.x < 0 || pos.x > 60) return false;
      return splitTps.some(o => Math.abs(pos.y - yScale(o.price)) < HIT);
    },
    cursor: "ns-resize",
  },
  {
    test: ({ drawing, pos, xScale, yScale, candles }) => {
      if (!drawing) return false;
      const ePx = yScale(drawing.entry);
      const x1  = xScale(tsToIdx(drawing.tStart, candles)), x2 = xScale(tsToIdx(drawing.tEnd, candles));
      return pos.x >= x1-10 && pos.x <= x2+10 && Math.abs(pos.y-ePx) < HIT;
    },
    cursor: "move",
  },
  {
    test: ({ drawing, pos, xScale, yScale, candles }) => {
      if (!drawing) return false;
      const tPx = yScale(drawing.tp), slPx = yScale(drawing.sl);
      const x1  = xScale(tsToIdx(drawing.tStart, candles)), x2 = xScale(tsToIdx(drawing.tEnd, candles));
      return pos.x >= x1-10 && pos.x <= x2+10 &&
            (Math.abs(pos.y-tPx)<HIT || Math.abs(pos.y-slPx)<HIT);
    },
    cursor: "ns-resize",
  },
  {
    test: ({ selectedChannelId, channels, pos, xScale, yScale, candles, isLog }) => {
      if (selectedChannelId == null || !channels?.length) return false;
      const ch = channels.find(c => c.id === selectedChannelId);
      if (!ch) return false;
      const { ax, ay, bx, by } = channelXYs(ch, candles, xScale, yScale, isLog);
      return Math.hypot(pos.x-ax, pos.y-ay) < 10 || Math.hypot(pos.x-bx, pos.y-by) < 10;
    },
    cursor: "move",
  },
  // 채널 선택 시 미러선 끝점 핸들 (메인 라인과 함께 이동 — 평행 유지)
  {
    test: ({ selectedChannelId, channels, pos, xScale, yScale, candles, isLog }) => {
      if (selectedChannelId == null || !channels?.length) return false;
      const ch = channels.find(c => c.id === selectedChannelId);
      if (!ch) return false;
      const { ax2, ay2, bx2, by2 } = channelXYs(ch, candles, xScale, yScale, isLog);
      return Math.hypot(pos.x-ax2, pos.y-ay2) < 10 || Math.hypot(pos.x-bx2, pos.y-by2) < 10;
    },
    cursor: "move",
  },
  // 채널 선택 시 미러선 중간 핸들 (양쪽 offset 동일 delta 조절)
  {
    test: ({ selectedChannelId, channels, pos, xScale, yScale, candles, isLog }) => {
      if (selectedChannelId == null || !channels?.length) return false;
      const ch = channels.find(c => c.id === selectedChannelId);
      if (!ch) return false;
      const { ax2, ay2, bx2, by2 } = channelXYs(ch, candles, xScale, yScale, isLog);
      return Math.hypot(pos.x-(ax2+bx2)/2, pos.y-(ay2+by2)/2) < 10;
    },
    cursor: "ns-resize",
  },
  // 채널 선택 시 몸통
  {
    test: ({ selectedChannelId, channels, pos, xScale, yScale, candles, isLog }) => {
      if (selectedChannelId == null || !channels?.length) return false;
      const ch = channels.find(c => c.id === selectedChannelId);
      if (!ch) return false;
      const { ax, ay, bx, by, ax2, ay2, bx2, by2 } = channelXYs(ch, candles, xScale, yScale, isLog);
      if (Math.hypot(pos.x-ax, pos.y-ay) < 10 || Math.hypot(pos.x-bx, pos.y-by) < 10) return false;
      if (Math.hypot(pos.x-ax2, pos.y-ay2) < 10 || Math.hypot(pos.x-bx2, pos.y-by2) < 10) return false;
      if (Math.hypot(pos.x-(ax2+bx2)/2, pos.y-(ay2+by2)/2) < 10) return false;
      return distToSeg(pos.x, pos.y, ax, ay, bx, by) < 8
          || distToSeg(pos.x, pos.y, ax2, ay2, bx2, by2) < 8;
    },
    cursor: "move",
  },
  // 원 선택 시 중심/반지름 핸들
  {
    test: ({ selectedCircleId, circles, pos, xScale, yScale, candles }) => {
      if (selectedCircleId == null || !circles?.length) return false;
      const ci = circles.find(c => c.id === selectedCircleId);
      if (!ci) return false;
      const cx = xScale(tsToIdx(ci.cx_t, candles)), cy = yScale(ci.cx_p);
      const rx = xScale(tsToIdx(ci.rx_t, candles)), ry = yScale(ci.rx_p);
      return Math.hypot(pos.x-cx, pos.y-cy) < 10 || Math.hypot(pos.x-rx, pos.y-ry) < 10;
    },
    cursor: "move",
  },
  // 원 선택 시 테두리
  {
    test: ({ selectedCircleId, circles, pos, xScale, yScale, candles }) => {
      if (selectedCircleId == null || !circles?.length) return false;
      const ci = circles.find(c => c.id === selectedCircleId);
      if (!ci) return false;
      const cx = xScale(tsToIdx(ci.cx_t, candles)), cy = yScale(ci.cx_p);
      const rx = xScale(tsToIdx(ci.rx_t, candles)), ry = yScale(ci.rx_p);
      if (Math.hypot(pos.x-cx, pos.y-cy) < 10 || Math.hypot(pos.x-rx, pos.y-ry) < 10) return false;
      const r = Math.hypot(rx-cx, ry-cy);
      return Math.abs(Math.hypot(pos.x-cx, pos.y-cy) - r) < 8;
    },
    cursor: "move",
  },
];

export function getCursor(ctx) {
  for (const rule of CURSOR_RULES) {
    if (rule.test(ctx)) return rule.cursor;
  }
  return null;
}
