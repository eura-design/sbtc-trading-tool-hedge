import { HIT } from "../constants";
import { distToSeg, findHitLine } from "../utils/hitTest";
import { tsToIdx } from "./scales";
import { idxToTimestamp, getCandleMs } from "../utils/coordUtils";
import { clearAllSelections, selectDrawable } from "./drawables";

// 채널 두 선의 픽셀 좌표 계산
export function channelXYs(ch, candles, xScale, yScale, _isLog = false) {
  const i1 = tsToIdx(ch.t1, candles), i2 = tsToIdx(ch.t2, candles);
  const chIsLog = ch.isLog ?? false;
  const offset2 = ch.offset2 ?? ch.offset;
  const p1off = chIsLog ? ch.p1 * ch.offset : ch.p1 + ch.offset;
  const p2off = chIsLog ? ch.p2 * offset2   : ch.p2 + offset2;
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
// ※ 이름과 달리 OHLC로 스냅하지 않는다 — 트렌드라인/채널/원은 자유 좌표를 쓴다.
export function snapToOHLC(pos, candles, xScale, yScale) {
  return { t: idxToTimestamp(xScale.invert(pos.x), candles), p: yScale.invert(pos.y) };
}

// ── 수동 구조(Structure) ─────────────────────────────────────────────────────

// 구조 꼭짓점 스냅 반경(봉).
//
// ※ 사용자 확정값 — 처음 3으로 만들었다가 "마그넷이 강하다"는 요청으로 절반인 1로 낮췄다.
//   임의로 되돌리거나 키우지 말 것. 더 약하게 원하면 0(커서가 있는 봉의 꼬리에만 스냅).
// ※ 클릭 배치(hitDetection 0.7)와 미리보기(useChartInteraction)가 **반드시 같은 값**을
//   써야 커서에 보이던 위치와 실제 찍히는 위치가 어긋나지 않는다. 호출부마다 숫자를
//   따로 넣지 말고 이 상수를 참조할 것.
export const STRUCT_SNAP_BARS = 1;

/**
 * 구조 꼭짓점용 스냅 — 커서 주변 봉 중 고가 최대(또는 저가 최소) 지점에 붙인다.
 * 구조 꼭짓점은 항상 꼬리 끝에 놓이므로 자유 좌표보다 스냅이 정확하고 빠르다.
 *
 * @param expectType "H"|"L"|null — null이면 커서가 봉의 위/아래 어디인지로 판정
 * @param windowBars 탐색 반경(봉). 드래그는 0(커서가 있는 봉에만 붙어 정확히 추종)
 */
export function snapToStructurePoint(pos, candles, xScale, yScale, expectType = null, windowBars = STRUCT_SNAP_BARS) {
  if (!candles.length) return null;
  const center = Math.max(0, Math.min(Math.round(xScale.invert(pos.x)), candles.length - 1));
  const price  = yScale.invert(pos.y);

  let type = expectType;
  if (!type) {
    const c = candles[center];
    type = price >= (c.h + c.l) / 2 ? "H" : "L";
  }

  const lo = Math.max(0, center - windowBars);
  const hi = Math.min(candles.length - 1, center + windowBars);
  let best = center;
  for (let i = lo; i <= hi; i++) {
    if (type === "H" ? candles[i].h > candles[best].h : candles[i].l < candles[best].l) best = i;
  }
  return { t: +candles[best].t, p: type === "H" ? candles[best].h : candles[best].l, type };
}

export function structureXYs(st, candles, xScale, yScale) {
  return (st.points ?? []).map(pt => ({ x: xScale(tsToIdx(pt.t, candles)), y: yScale(pt.p) }));
}

export function findHitStructure(px, py, structures, xScale, yScale, candles, threshold = 8) {
  return (structures ?? []).find(st =>
    findStructSegmentIdx(st, px, py, xScale, yScale, candles, threshold) !== -1
  );
}

// 꼭짓점 히트 → points 배열의 인덱스 (없으면 -1)
export function findHitStructPointIdx(st, px, py, xScale, yScale, candles, threshold = 10) {
  const xy = structureXYs(st, candles, xScale, yScale);
  for (let k = 0; k < xy.length; k++) {
    if (Math.hypot(px - xy[k].x, py - xy[k].y) < threshold) return k;
  }
  return -1;
}

/**
 * 기존 구조의 **양 끝** 꼭짓점 히트 → { id, fromStart }
 * 구조 모드에서 이어 그리기를 시작할 지점을 찾는 용도라 중간 꼭짓점은 보지 않는다.
 */
export function findStructEndpointHit(px, py, structures, xScale, yScale, candles, threshold = 10) {
  for (const st of structures ?? []) {
    if (st.locked || !st.points?.length) continue;
    const xy = structureXYs(st, candles, xScale, yScale);
    const a = xy[0], b = xy[xy.length - 1];
    if (Math.hypot(px - b.x, py - b.y) < threshold) return { id: st.id, fromStart: false };
    if (xy.length > 1 && Math.hypot(px - a.x, py - a.y) < threshold) return { id: st.id, fromStart: true };
  }
  return null;
}

// 선분 히트 → 그 선분의 끝점 인덱스 k (= 삽입 위치). 없으면 -1
export function findStructSegmentIdx(st, px, py, xScale, yScale, candles, threshold = 8) {
  const xy = structureXYs(st, candles, xScale, yScale);
  for (let k = 1; k < xy.length; k++) {
    if (distToSeg(px, py, xy[k - 1].x, xy[k - 1].y, xy[k].x, xy[k].y) < threshold) return k;
  }
  return -1;
}

// ── onMouseDown 히트 테스트 체인 ──────────────────────────────────────────────
export function buildHitChain(ctx) {
  const {
    pos, xScale, yScale, candles,
    lineMode, lineStart, setLineStart, addLine,
    selectedLineId, lines, dragRef,
    hasPos, hasLong, hasShort, tpsl, scaleInOrders, splitTps,
    drawing, locked, drawMode, setCurrent,
    xDomainRef,
    setSelectedBox,
    isLog,
    drawables,
    // 채널
    channelMode, channelStep, setChannelStep,
    channelPoints, setChannelPoints, channelPreview,
    channels, selectedChannelId,
    addChannel, updateChannelEndpoint, setChannelPosition, setChannelOffset,
    // 원
    circleMode, circleCenter, setCircleCenter, circlePreview,
    circles, selectedCircleId,
    addCircle, moveCircle,
    // 수동 구조
    structMode, structDraft, addStructDraftPoint, startExtendStruct, mergeStructIntoDraft,
    structures, selectedStructId, structPart, selectStructPart,
  } = ctx;

  // 다음에 찍을 꼭짓점 타입 — 직전 점의 반대 (첫 점은 커서 위치로 판정)
  const lastDraft   = structDraft?.points?.[structDraft.points.length - 1];
  const nextPtType  = lastDraft ? (lastDraft.type === "H" ? "L" : "H") : null;

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
          addChannel(channelPoints.t1, channelPoints.p1, channelPoints.t2, channelPoints.p2, offset, isLog);
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
    // 0.7. 구조 그리기 모드 — 클릭할 때마다 꼭짓점 추가 (고/저 교대, 꼬리 스냅)
    //      확정은 우클릭 또는 더블클릭, 취소는 ESC (ChartArea/useKeyboardShortcuts에서 처리)
    {
      when: structMode,
      handle() {
        // 기존 구조의 끝점을 누르면 새 점을 찍는 대신 그 구조와 이어진다.
        // 구조를 쪼개두면 deriveStructure가 각각 bias=0으로 시작해 경계 CHoCH가 유실되므로,
        // "이어 그리기"와 "두 구조 잇기" 모두 하나의 구조로 합쳐야 한다.
        const hit = findStructEndpointHit(pos.x, pos.y, structures, xScale, yScale, candles);
        if (hit) {
          if (!structDraft) { startExtendStruct(hit.id, hit.fromStart); return; }
          const already = hit.id === structDraft.extendId
                       || structDraft.mergeIds?.includes(hit.id);
          if (!already) { mergeStructIntoDraft(hit.id, hit.fromStart); return; }
        }
        const snapped = snapToStructurePoint(pos, candles, xScale, yScale, nextPtType);
        if (snapped) addStructDraftPoint(snapped);
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
      when: !!drawing && !(drawing.isLong ? hasLong : hasShort),
      handle() {
        const ePx = yScale(drawing.entry), tPx = yScale(drawing.tp), slPx = yScale(drawing.sl);
        const x1  = xScale(tsToIdx(drawing.tStart, candles)), x2 = xScale(tsToIdx(drawing.tEnd, candles));
        if (pos.x < x1-10 || pos.x > x2+10) return false;
        if (Math.abs(pos.y-slPx) < HIT) { setSelectedBox(true); clearAllSelections(drawables); dragRef.current = { type:"sl",    startY:pos.y, startSl:drawing.sl }; return true; }
        if (Math.abs(pos.y-tPx)  < HIT) { setSelectedBox(true); clearAllSelections(drawables); dragRef.current = { type:"tp",    startY:pos.y, startTp:drawing.tp }; return true; }
        if (Math.abs(pos.y-ePx)  < HIT) { setSelectedBox(true); clearAllSelections(drawables); dragRef.current = { type:"entry", startY:pos.y, startX:pos.x, startEntry:drawing.entry, startTp:drawing.tp, startSl:drawing.sl, startTStart:drawing.tStart, startTEnd:drawing.tEnd }; return true; }
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
          clearAllSelections(drawables);
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
    // 4. TP/SL 드래그 (선 선택보다 우선) — 롱/숏 각각 처리
    {
      when: hasPos && !!tpsl && pos.x >= 0 && pos.x <= 60,
      handle() {
        const longTpPx  = tpsl.long?.tp  ? yScale(tpsl.long.tp.price)  : null;
        const longSlPx  = tpsl.long?.sl  ? yScale(tpsl.long.sl.price)  : null;
        const shortTpPx = tpsl.short?.tp ? yScale(tpsl.short.tp.price) : null;
        const shortSlPx = tpsl.short?.sl ? yScale(tpsl.short.sl.price) : null;
        if (longTpPx  !== null && Math.abs(pos.y-longTpPx)  < HIT) { dragRef.current = { type:"pos_tp", side:"LONG",  startY:pos.y, startPrice:tpsl.long.tp.price  }; return true; }
        if (longSlPx  !== null && Math.abs(pos.y-longSlPx)  < HIT) { dragRef.current = { type:"pos_sl", side:"LONG",  startY:pos.y, startPrice:tpsl.long.sl.price  }; return true; }
        if (shortTpPx !== null && Math.abs(pos.y-shortTpPx) < HIT) { dragRef.current = { type:"pos_tp", side:"SHORT", startY:pos.y, startPrice:tpsl.short.tp.price }; return true; }
        if (shortSlPx !== null && Math.abs(pos.y-shortSlPx) < HIT) { dragRef.current = { type:"pos_sl", side:"SHORT", startY:pos.y, startPrice:tpsl.short.sl.price }; return true; }
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
    // 4.65 선택된 구조 편집 — 꼭짓점 드래그 + 꼭짓점/선분 부분 선택
    //      구조는 폴리라인이 x<60(TP/SL 핸들 영역)을 자주 지나므로 포지션 핸들 뒤에 둔다
    //
    //      클릭한 꼭짓점/선분은 structPart에 담기고 **Delete로 그것만 삭제**된다
    //      (예전엔 꼭짓점 Shift+클릭 즉시 삭제 — 사용자 요청으로 클릭 → Delete로 변경).
    //      삭제 의미: 꼭짓점을 지우면 양옆이 같은 타입이 되면서 normalize가 병합해
    //      "그 스윙을 없앤다"가 된다. 선분도 같은 원리(이어붙이기)로 지운다.
    //
    //      ※ 선분 중간에 점 하나를 끼우는 기능은 없다. 지그재그는 고/저가 교대라서
    //        H–L 사이에 넣는 점은 어느 타입이든 양옆 중 하나와 겹치고,
    //        normalizeStructurePoints가 병합해버려 결과적으로 아무 일도 안 일어난다.
    //        점을 늘리려면 끝점을 클릭해 이어 그리면 된다.
    {
      when: selectedStructId != null && !structMode && !drawMode,
      handle() {
        const st = (structures ?? []).find(s => s.id === selectedStructId);
        if (!st || st.locked) return false;

        // 같은 부분을 다시 누르면 선택 해제 = 구조 전체 선택 상태로 복귀.
        // 이게 있어야 부분을 고른 뒤에도 **구조 전체 삭제**로 돌아갈 수 있다.
        const isSame = (kind, idx) => structPart?.kind === kind && structPart?.idx === idx;

        const ptIdx = findHitStructPointIdx(st, pos.x, pos.y, xScale, yScale, candles);
        if (ptIdx !== -1) {
          selectStructPart?.(isSame("point", ptIdx) ? null : { kind: "point", idx: ptIdx });
          dragRef.current = {
            type: "struct_point", structId: selectedStructId,
            ptIdx, ptType: st.points[ptIdx].type,
          };
          return true;
        }

        // 몸통 클릭 = 그 선분 선택 (팬으로 넘어가지 않도록 true)
        const segIdx = findStructSegmentIdx(st, pos.x, pos.y, xScale, yScale, candles);
        if (segIdx !== -1) {
          selectStructPart?.(isSame("segment", segIdx) ? null : { kind: "segment", idx: segIdx });
          return true;
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
        // 미러 라인 시작점 핸들 → offset 보정 후 p1 이동 (평행 유지)
        if (Math.hypot(pos.x-ax2, pos.y-ay2) < 10) {
          dragRef.current = { type:"channel_mirror_ep", channelId:selectedChannelId, endpoint:"start", offset:ch.offset }; return true;
        }
        // 미러 라인 끝점 핸들 → offset2 보정 후 p2 이동 (평행 유지)
        if (Math.hypot(pos.x-bx2, pos.y-by2) < 10) {
          dragRef.current = { type:"channel_mirror_ep", channelId:selectedChannelId, endpoint:"end", offset:ch.offset2 ?? ch.offset }; return true;
        }
        // 미러 라인 중간 핸들 (양쪽 offset 동일 delta 조절)
        const midX = (ax2+bx2)/2, midY = (ay2+by2)/2;
        if (Math.hypot(pos.x-midX, pos.y-midY) < 10) {
          dragRef.current = { type:"channel_mid_offset", channelId:selectedChannelId, startY:pos.y, startOffset:ch.offset, startOffset2:ch.offset2 ?? ch.offset }; return true;
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
    // 5. 도형 선택/해제 (drawMode 중에는 실행 안 함)
    {
      when: !drawMode,
      handle() {
        const hit = findHitLine(pos.x, pos.y, lines, xScale, yScale, candles, 8, isLog);
        if (hit)   { selectDrawable(drawables, "line",    hit.id);   setSelectedBox(false); return true; }
        const hitCh = findHitChannel(pos.x, pos.y, channels ?? [], xScale, yScale, candles, 8, isLog);
        if (hitCh) { selectDrawable(drawables, "channel", hitCh.id); setSelectedBox(false); return true; }
        const hitCi = findHitCircle(pos.x, pos.y, circles ?? [], xScale, yScale, candles);
        if (hitCi) { selectDrawable(drawables, "circle",  hitCi.id); setSelectedBox(false); return true; }
        // 구조는 여러 봉에 걸친 폴리라인이라 클릭을 많이 삼키므로 맨 뒤에서 판정
        const hitSt = findHitStructure(pos.x, pos.y, structures ?? [], xScale, yScale, candles);
        if (hitSt) { selectDrawable(drawables, "structure", hitSt.id); setSelectedBox(false); return true; }
        clearAllSelections(drawables);
        return false;
      },
    },
    // 6. 팬 (기본)
    // 박스 그리기는 위 3.7에서 처리됨 (drawMode && !locked) — 여기엔 중복 분기 두지 않음
    {
      when: true,
      handle() {
        setSelectedBox(false);
        dragRef.current = { type:"pan", startX:pos.x, xDom0:[...xDomainRef.current] };
      },
    },
  ];
}
