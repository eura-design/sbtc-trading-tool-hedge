import { HIT } from "../constants";
import { distToSeg, findHitLine } from "../utils/hitTest";
import { tsToIdx } from "./scales";
import { idxToTimestamp, getCandleMs } from "../utils/coordUtils";

// 채널 두 선의 픽셀 좌표 계산
export function channelXYs(ch, candles, xScale, yScale, isLog = false) {
  const i1 = tsToIdx(ch.t1, candles), i2 = tsToIdx(ch.t2, candles);
  const p1off = isLog ? ch.p1 * ch.offset : ch.p1 + ch.offset;
  const p2off = isLog ? ch.p2 * ch.offset : ch.p2 + ch.offset;
  return {
    ax: xScale(i1), ay: yScale(ch.p1),
    bx: xScale(i2), by: yScale(ch.p2),
    ax2: xScale(i1), ay2: yScale(p1off),
    bx2: xScale(i2), by2: yScale(p2off),
  };
}

export function findHitChannel(px, py, channels, xScale, yScale, candles, threshold = 8, isLog = false) {
  return channels.find(ch => {
    const { ax, ay, bx, by, ax2, ay2, bx2, by2 } = channelXYs(ch, candles, xScale, yScale, isLog);
    return distToSeg(px, py, ax, ay, bx, by)    < threshold
        || distToSeg(px, py, ax2, ay2, bx2, by2) < threshold;
  });
}

export function findHitCircle(px, py, circles, xScale, yScale, candles, threshold = 8) {
  return circles.find(ci => {
    const cx = xScale(tsToIdx(ci.cx_t, candles)), cy = yScale(ci.cx_p);
    const rx = xScale(tsToIdx(ci.rx_t, candles)), ry = yScale(ci.rx_p);
    const r  = Math.hypot(rx - cx, ry - cy);
    return Math.abs(Math.hypot(px - cx, py - cy) - r) < threshold;
  });
}

// timestamp → 현재 타임프레임 bar index → 픽셀 좌표
export function lineXY(t, p, candles, xScale, yScale) {
  return { x: xScale(tsToIdx(t, candles)), y: yScale(p) };
}

// 마우스 픽셀 → timestamp + 가격 (미래 영역 외삽 포함)
export function snapToOHLC(pos, candles, xScale, yScale) {
  return { t: idxToTimestamp(xScale.invert(pos.x), candles), p: yScale.invert(pos.y) };
}

// ── onMouseDown 히트 테스트 체인 ──────────────────────────────────────────────
export function buildHitChain(ctx) {
  const {
    pos, xScale, yScale, candles,
    lineMode, lineStart, setLineStart, addLine,
    selectedLineId, lines, setSelectedLineId, dragRef,
    hasPos, tpsl, scaleInOrders, splitTps,
    drawing, locked, drawMode, setCurrent,
    xDomainRef,
    setSelectedBox,
    isLog,
    // 채널
    channelMode, channelStep, setChannelStep,
    channelPoints, setChannelPoints, channelPreview,
    channels, selectedChannelId, setSelectedChannelId,
    addChannel, updateChannelEndpoint, setChannelPosition, setChannelOffset,
    // 원
    circleMode, circleCenter, setCircleCenter, circlePreview,
    circles, selectedCircleId, setSelectedCircleId,
    addCircle, moveCircle,
  } = ctx;

  return [
    // 0. 채널 그리기 모드
    {
      when: channelMode,
      handle() {
        const { t, p } = snapToOHLC(pos, candles, xScale, yScale);
        if (channelStep === 0) {
          setChannelPoints({ t1: t, p1: p });
          setChannelStep(1);
        } else if (channelStep === 1) {
          setChannelPoints(prev => ({ ...prev, t2: t, p2: p }));
          setChannelStep(2);
        } else if (channelStep === 2 && channelPoints) {
          const defaultOffset = isLog ? 1 : 0;
          const offset = channelPreview?.offset ?? defaultOffset;
          addChannel(channelPoints.t1, channelPoints.p1, channelPoints.t2, channelPoints.p2, offset);
        }
      },
    },
    // 0.5. 원 그리기 모드
    {
      when: circleMode,
      handle() {
        const { t, p } = snapToOHLC(pos, candles, xScale, yScale);
        if (!circleCenter) {
          setCircleCenter({ t, p });
        } else {
          addCircle(circleCenter.t, circleCenter.p, t, p);
        }
      },
    },
    // 1. 선 그리기 모드
    {
      when: lineMode,
      handle() {
        const { t, p } = snapToOHLC(pos, candles, xScale, yScale);
        if (!lineStart) setLineStart({ t, p });
        else            addLine(lineStart.t, lineStart.p, t, p);
      },
    },
    // 2. 선 끝점 드래그
    {
      when: selectedLineId !== null,
      handle() {
        const ln = lines.find(l => l.id === selectedLineId);
        if (!ln || ln.locked) return false;
        const { x: ax, y: ay } = lineXY(ln.t1, ln.p1, candles, xScale, yScale);
        const { x: bx, y: by } = lineXY(ln.t2, ln.p2, candles, xScale, yScale);
        if (Math.hypot(pos.x-ax, pos.y-ay) < 10) {
          dragRef.current = { type:"line_ep", lineId:selectedLineId, endpoint:"start" }; return true;
        }
        if (Math.hypot(pos.x-bx, pos.y-by) < 10) {
          dragRef.current = { type:"line_ep", lineId:selectedLineId, endpoint:"end"   }; return true;
        }
        // 2b. 선 몸통 드래그
        const bodyHit = isLog
          ? findHitLine(pos.x, pos.y, [ln], xScale, yScale, candles, 8, true)
          : distToSeg(pos.x, pos.y, ax, ay, bx, by) < 8;
        if (bodyHit) {
          dragRef.current = { type:"line_move", lineId:selectedLineId,
            startX:pos.x, startY:pos.y,
            startT1:ln.t1, startP1:ln.p1, startT2:ln.t2, startP2:ln.p2 };
          return true;
        }
        return false;
      },
    },
    // 3. 박스 라인 드래그
    {
      when: !!drawing && !hasPos,
      handle() {
        const ePx = yScale(drawing.entry), tPx = yScale(drawing.tp), slPx = yScale(drawing.sl);
        const x1  = xScale(tsToIdx(drawing.tStart, candles)), x2 = xScale(tsToIdx(drawing.tEnd, candles));
        if (pos.x < x1-10 || pos.x > x2+10) return false;
        if (Math.abs(pos.y-slPx) < HIT) { setSelectedBox(true); setSelectedLineId(null); dragRef.current = { type:"sl",    startY:pos.y, startSl:drawing.sl }; return true; }
        if (Math.abs(pos.y-tPx)  < HIT) { setSelectedBox(true); setSelectedLineId(null); dragRef.current = { type:"tp",    startY:pos.y, startTp:drawing.tp }; return true; }
        if (Math.abs(pos.y-ePx)  < HIT) { setSelectedBox(true); setSelectedLineId(null); dragRef.current = { type:"entry", startY:pos.y, startX:pos.x, startEntry:drawing.entry, startTp:drawing.tp, startSl:drawing.sl, startTStart:drawing.tStart, startTEnd:drawing.tEnd }; return true; }
        return false;
      },
    },
    // 3.5. 박스 내부 클릭 → 선택 (선보다 우선)
    {
      when: !!drawing,
      handle() {
        const x1   = xScale(tsToIdx(drawing.tStart, candles)), x2 = xScale(tsToIdx(drawing.tEnd, candles));
        const yMin = Math.min(yScale(drawing.tp), yScale(drawing.sl));
        const yMax = Math.max(yScale(drawing.tp), yScale(drawing.sl));
        if (pos.x >= x1 && pos.x <= x2 && pos.y >= yMin && pos.y <= yMax) {
          setSelectedBox(true);
          setSelectedLineId(null);
          return true;
        }
        return false;
      },
    },
    // 3.7. 박스 그리기 시작 (선 선택보다 우선)
    {
      when: drawMode && !locked,
      handle() {
        dragRef.current = { type:"draw", startX:pos.x, startY:pos.y };
        setCurrent({ x1:pos.x, y1:pos.y, x2:pos.x, y2:pos.y });
      },
    },
    // 4. TP/SL 드래그 (선 선택보다 우선)
    {
      when: hasPos && !!tpsl,
      handle() {
        const tpPx = tpsl.tp ? yScale(tpsl.tp.price) : null;
        const slPx = tpsl.sl ? yScale(tpsl.sl.price) : null;
        if (tpPx !== null && Math.abs(pos.y-tpPx) < HIT && pos.x >= 0 && pos.x <= 60) {
          dragRef.current = { type:"pos_tp", startY:pos.y, startPrice:tpsl.tp.price }; return true;
        }
        if (slPx !== null && Math.abs(pos.y-slPx) < HIT && pos.x >= 0 && pos.x <= 60) {
          dragRef.current = { type:"pos_sl", startY:pos.y, startPrice:tpsl.sl.price }; return true;
        }
        return false;
      },
    },
    // 4.5 추가 진입 핸들 드래그 (선 선택보다 우선)
    {
      when: !!scaleInOrders?.length && pos.x >= 0 && pos.x <= 60,
      handle() {
        for (const o of scaleInOrders) {
          const px = yScale(o.price);
          if (Math.abs(pos.y - px) < HIT) {
            dragRef.current = { type:"scale_in", orderId:o.orderId, startY:pos.y, startPrice:o.price };
            return true;
          }
        }
        return false;
      },
    },
    // 4.6 분할 TP 핸들 드래그 (선 선택보다 우선)
    {
      when: !!splitTps?.length && pos.x >= 0 && pos.x <= 60,
      handle() {
        for (const o of splitTps) {
          const px = yScale(o.price);
          if (Math.abs(pos.y - px) < HIT) {
            dragRef.current = { type:"split_tp", orderId:o.orderId, startY:pos.y, startPrice:o.price };
            return true;
          }
        }
        return false;
      },
    },
    // 4.7 선택된 채널 드래그 처리
    {
      when: selectedChannelId !== null && !channelMode && !drawMode,
      handle() {
        const ch = channels.find(c => c.id === selectedChannelId);
        if (!ch || ch.locked) return false;
        const { ax, ay, bx, by, ax2, ay2, bx2, by2 } = channelXYs(ch, candles, xScale, yScale, isLog);
        // 메인 라인 시작점 끝점
        if (Math.hypot(pos.x-ax, pos.y-ay) < 10) {
          dragRef.current = { type:"channel_ep", channelId:selectedChannelId, endpoint:"start" }; return true;
        }
        if (Math.hypot(pos.x-bx, pos.y-by) < 10) {
          dragRef.current = { type:"channel_ep", channelId:selectedChannelId, endpoint:"end" }; return true;
        }
        // 미러선 중간 핸들 (오프셋 조절)
        const midX = (ax2+bx2)/2, midY = (ay2+by2)/2;
        if (Math.hypot(pos.x-midX, pos.y-midY) < 10) {
          dragRef.current = { type:"channel_offset", channelId:selectedChannelId, startY:pos.y, startOffset:ch.offset }; return true;
        }
        // 몸통 드래그
        if (distToSeg(pos.x, pos.y, ax, ay, bx, by) < 8 || distToSeg(pos.x, pos.y, ax2, ay2, bx2, by2) < 8) {
          dragRef.current = { type:"channel_move", channelId:selectedChannelId, startX:pos.x, startY:pos.y, startT1:ch.t1, startP1:ch.p1, startT2:ch.t2, startP2:ch.p2 }; return true;
        }
        return false;
      },
    },
    // 4.8 선택된 원 드래그
    {
      when: selectedCircleId !== null && !circleMode && !drawMode,
      handle() {
        const ci = circles.find(c => c.id === selectedCircleId);
        if (!ci || ci.locked) return false;
        const cx = xScale(tsToIdx(ci.cx_t, candles)), cy = yScale(ci.cx_p);
        const rx = xScale(tsToIdx(ci.rx_t, candles)), ry = yScale(ci.rx_p);
        const r  = Math.hypot(rx - cx, ry - cy);
        // 반지름 끝점 핸들
        if (Math.hypot(pos.x-rx, pos.y-ry) < 10) {
          dragRef.current = { type:"circle_radius", circleId:selectedCircleId, cxT:ci.cx_t, cxP:ci.cx_p }; return true;
        }
        // 중심 핸들 or 테두리 → 전체 이동
        if (Math.hypot(pos.x-cx, pos.y-cy) < 10 || Math.abs(Math.hypot(pos.x-cx, pos.y-cy) - r) < 8) {
          dragRef.current = { type:"circle_move", circleId:selectedCircleId, startX:pos.x, startY:pos.y, startCxT:ci.cx_t, startCxP:ci.cx_p, startRxT:ci.rx_t, startRxP:ci.rx_p }; return true;
        }
        return false;
      },
    },
    // 5. 선 선택/해제 (drawMode 중에는 실행 안 함)
    {
      when: !drawMode,
      handle() {
        const hit = findHitLine(pos.x, pos.y, lines, xScale, yScale, candles, 8, isLog);
        if (hit) { setSelectedLineId(hit.id); setSelectedBox(false); setSelectedChannelId(null); setSelectedCircleId(null); return true; }
        const hitCh = findHitChannel(pos.x, pos.y, channels ?? [], xScale, yScale, candles, 8, isLog);
        if (hitCh) { setSelectedChannelId(hitCh.id); setSelectedLineId(null); setSelectedBox(false); setSelectedCircleId(null); return true; }
        const hitCi = findHitCircle(pos.x, pos.y, circles ?? [], xScale, yScale, candles);
        if (hitCi) { setSelectedCircleId(hitCi.id); setSelectedLineId(null); setSelectedChannelId(null); setSelectedBox(false); return true; }
        setSelectedLineId(null);
        setSelectedChannelId(null);
        setSelectedCircleId(null);
        return false;
      },
    },
    // 6. 박스 그리기 시작
    {
      when: drawMode && !locked,
      handle() {
        dragRef.current = { type:"draw", startX:pos.x, startY:pos.y };
        setCurrent({ x1:pos.x, y1:pos.y, x2:pos.x, y2:pos.y });
      },
    },
    // 7. 팬 (기본)
    {
      when: true,
      handle() {
        setSelectedBox(false);
        dragRef.current = { type:"pan", startX:pos.x, xDom0:[...xDomainRef.current] };
      },
    },
  ];
}
