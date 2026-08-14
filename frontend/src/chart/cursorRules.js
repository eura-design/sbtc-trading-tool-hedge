import { HIT } from "../constants";
import { distToSeg } from "../utils/hitTest";
import { tsToIdx } from "./scales";
import { channelXYs, lineXY, findHitStructPointIdx, findStructEndpointHit, findHitFib, fibXs } from "./hitDetection";

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
  // 박스 좌우 모서리 — 폭 조절 (가로선 규칙보다 뒤에 둬야 꼭짓점에서 가격 이동이 이긴다)
  {
    test: ({ drawing, pos, xScale, yScale, candles }) => {
      if (!drawing) return false;
      const yLo = Math.min(yScale(drawing.tp), yScale(drawing.sl));
      const yHi = Math.max(yScale(drawing.tp), yScale(drawing.sl));
      if (pos.y < yLo - HIT || pos.y > yHi + HIT) return false;
      const iw = xScale.range()[1];
      return [drawing.tStart, drawing.tEnd].some(t => {
        const ex = xScale(tsToIdx(t, candles));
        return ex >= 0 && ex <= iw && Math.abs(pos.x - ex) < HIT;
      });
    },
    cursor: "ew-resize",
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
  // 피보나치 선택 시 앵커 핸들
  {
    test: ({ selectedFibId, fibs, pos, xScale, yScale, candles }) => {
      if (selectedFibId == null || !fibs?.length) return false;
      const fb = fibs.find(f => f.id === selectedFibId);
      if (!fb) return false;
      const { xa, xb } = fibXs(fb, candles, xScale);
      return Math.hypot(pos.x - xa, pos.y - yScale(fb.p1)) < 10
          || Math.hypot(pos.x - xb, pos.y - yScale(fb.p2)) < 10;
    },
    cursor: "move",
  },
  // 피보나치 선택 시 몸통 (레벨 가로선 + 앵커 대각선)
  {
    test: ({ selectedFibId, fibs, pos, xScale, yScale, candles, fibLevels, isLog }) => {
      if (selectedFibId == null || !fibs?.length) return false;
      const fb = fibs.find(f => f.id === selectedFibId);
      if (!fb) return false;
      const { xa, xb } = fibXs(fb, candles, xScale);
      if (Math.hypot(pos.x - xa, pos.y - yScale(fb.p1)) < 10) return false;
      if (Math.hypot(pos.x - xb, pos.y - yScale(fb.p2)) < 10) return false;
      return !!findHitFib(pos.x, pos.y, [fb], xScale, yScale, candles, fibLevels, isLog);
    },
    cursor: "move",
  },
  // 구조 모드에서 기존 구조의 끝점 위 — 클릭하면 이어진다는 신호
  // (draft 없으면 이어 그리기 시작, 있으면 그 구조를 흡수해 두 구조를 잇는다)
  {
    test: ({ structMode, structDraft, structures, pos, xScale, yScale, candles }) => {
      if (!structMode || !structures?.length) return false;
      const hit = findStructEndpointHit(pos.x, pos.y, structures, xScale, yScale, candles);
      if (!hit) return false;
      // 이미 draft에 들어와 있는 구조는 다시 이을 게 없다
      return hit.id !== structDraft?.extendId && !structDraft?.mergeIds?.includes(hit.id);
    },
    cursor: "cell",
  },
  // 구조 선택 시 꼭짓점 핸들
  {
    test: ({ selectedStructId, structures, pos, xScale, yScale, candles }) => {
      if (selectedStructId == null || !structures?.length) return false;
      const st = structures.find(s => s.id === selectedStructId);
      if (!st) return false;
      return findHitStructPointIdx(st, pos.x, pos.y, xScale, yScale, candles) !== -1;
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
