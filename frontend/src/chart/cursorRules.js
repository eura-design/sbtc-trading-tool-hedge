import { HIT } from "../constants";
import { distToSeg } from "../utils/hitTest";
import { tsToIdx } from "./scales";
import { channelXYs, lineXY, findStructEndpointHit, findHitFib, fibXs, STRUCT_LIVE_HIT } from "./hitDetection";

// 구조 끝점 연결 커서 — **크기를 직접 정한 작은 + 표시** (2026-08-15 사용자 지정)
//
// ⚠ 표준 CSS 커서로는 이 요구를 만족할 수 없다. 플러스 모양은 `cell`(두껍고 큼)과
//   `crosshair`(얇음) 둘뿐인데, `crosshair`는 useChartInteraction의 setCursor가
//   `none`으로 바꿔 **앱 자체 크로스헤어만 남기므로** 끝점 신호가 사라진다.
//   그래서 SVG data URI로 직접 그린다. 크기를 바꾸려면 아래 PLUS_PX 하나만 고치면 된다.
//
// ※ 색은 흰 획 + 검은 테두리 — OS 기본 커서와 같은 방식이라 다크/라이트 양쪽에서 보인다.
//   테마 토큰을 쓰지 않는 이유: 커서는 캔들·오버레이 위 어디에나 놓이므로
//   배경색을 특정할 수 없다 (테마가 아니라 대비로 해결해야 한다)
const PLUS_PX = 13;                       // cell(약 20px)보다 확실히 작게
const PLUS_MID = PLUS_PX / 2;
const PLUS_PAD = 1.5;                     // 획 끝이 잘리지 않도록 여백
const PLUS_SVG =
  `<svg xmlns="http://www.w3.org/2000/svg" width="${PLUS_PX}" height="${PLUS_PX}" viewBox="0 0 ${PLUS_PX} ${PLUS_PX}">` +
  `<g stroke-linecap="round" fill="none">` +
  `<path d="M${PLUS_MID} ${PLUS_PAD}V${PLUS_PX - PLUS_PAD}M${PLUS_PAD} ${PLUS_MID}H${PLUS_PX - PLUS_PAD}" stroke="#000" stroke-width="3" opacity="0.55"/>` +
  `<path d="M${PLUS_MID} ${PLUS_PAD}V${PLUS_PX - PLUS_PAD}M${PLUS_PAD} ${PLUS_MID}H${PLUS_PX - PLUS_PAD}" stroke="#fff" stroke-width="1.5"/>` +
  `</g></svg>`;
// 핫스팟은 정중앙 픽셀 — 십자의 교차점이 곧 "이어 붙을 지점"이라 어긋나면 안 된다.
// (핫스팟은 정수 픽셀 인덱스라 13px이면 0~12의 한가운데인 6이다. round(6.5)=7이 아니다)
// 뒤의 `cell`은 data URI를 못 읽는 환경용 폴백이다
const PLUS_HOTSPOT = Math.floor(PLUS_PX / 2);
const STRUCT_LINK_CURSOR =
  `url("data:image/svg+xml,${encodeURIComponent(PLUS_SVG)}") ${PLUS_HOTSPOT} ${PLUS_HOTSPOT}, cell`;

// 플랜 박스 둘 중 실제로 있는 것만 (롱·숏 각각 하나 — store/uiSlice.js)
const boxes = (drawings) => [drawings?.long, drawings?.short].filter(Boolean);

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
    test: ({ splitTps, partialSls, pos, yScale }) => {
      if (pos.x < 0 || pos.x > 60) return false;
      return (splitTps ?? []).some(o => Math.abs(pos.y - yScale(o.price)) < HIT)
          || (partialSls ?? []).some(o => Math.abs(pos.y - yScale(o.price)) < HIT);
    },
    cursor: "ns-resize",
  },
  // ⚠ 플랜 박스는 롱·숏 **둘 다** 훑는다 (2026-08-19). 하나만 보면 다른 쪽 박스
  //   위에서 커서가 안 바뀌어 "이건 못 잡는 선인가" 싶어진다.
  //   순서(`boxes`)는 hitDetection의 boxOrder와 달리 굳이 선택을 우선하지 않는다 —
  //   커서 모양은 어느 박스를 집든 같아서 구분할 이유가 없다
  {
    test: ({ drawings, pos, xScale, yScale, candles }) =>
      boxes(drawings).some(d => {
        const ePx = yScale(d.entry);
        const x1  = xScale(tsToIdx(d.tStart, candles)), x2 = xScale(tsToIdx(d.tEnd, candles));
        return pos.x >= x1-10 && pos.x <= x2+10 && Math.abs(pos.y-ePx) < HIT;
      }),
    cursor: "move",
  },
  {
    test: ({ drawings, pos, xScale, yScale, candles }) =>
      boxes(drawings).some(d => {
        const tPx = yScale(d.tp), slPx = yScale(d.sl);
        const x1  = xScale(tsToIdx(d.tStart, candles)), x2 = xScale(tsToIdx(d.tEnd, candles));
        return pos.x >= x1-10 && pos.x <= x2+10 &&
              (Math.abs(pos.y-tPx)<HIT || Math.abs(pos.y-slPx)<HIT);
      }),
    cursor: "ns-resize",
  },
  // 박스 좌우 모서리 — 폭 조절 (가로선 규칙보다 뒤에 둬야 꼭짓점에서 가격 이동이 이긴다)
  {
    test: ({ drawings, pos, xScale, yScale, candles }) =>
      boxes(drawings).some(d => {
        const yLo = Math.min(yScale(d.tp), yScale(d.sl));
        const yHi = Math.max(yScale(d.tp), yScale(d.sl));
        if (pos.y < yLo - HIT || pos.y > yHi + HIT) return false;
        const iw = xScale.range()[1];
        return [d.tStart, d.tEnd].some(t => {
          const ex = xScale(tsToIdx(t, candles));
          return ex >= 0 && ex <= iw && Math.abs(pos.x - ex) < HIT;
        });
      }),
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
    test: ({ selectedFibId, fibs, pos, xScale, yScale, candles, isLog }) => {
      if (selectedFibId == null || !fibs?.length) return false;
      const fb = fibs.find(f => f.id === selectedFibId);
      if (!fb) return false;
      const { xa, xb } = fibXs(fb, candles, xScale);
      if (Math.hypot(pos.x - xa, pos.y - yScale(fb.p1)) < 10) return false;
      if (Math.hypot(pos.x - xb, pos.y - yScale(fb.p2)) < 10) return false;
      return !!findHitFib(pos.x, pos.y, [fb], xScale, yScale, candles, isLog);
    },
    cursor: "move",
  },
  // 진행 중 레그(점선)의 끝점 위 — 누르면 그 자리가 꼭짓점으로 확정된다
  // (구조 모드 밖에서만. 모드 안에서는 클릭이 이미 꼭짓점 추가라 뜻이 겹친다)
  {
    test: ({ structMode, structLive, pos, xScale, yScale, candles }) => {
      if (structMode || !structLive?.ownerId) return false;
      const x = xScale(tsToIdx(structLive.t2, candles));
      const y = yScale(structLive.p2);
      return Math.hypot(pos.x - x, pos.y - y) <= STRUCT_LIVE_HIT;
    },
    // 구조 모드의 끝점 이어붙이기와 **같은 커서**다 (2026-08-15 사용자 지정).
    // 하는 일이 같기 때문 — "여기를 누르면 구조에 이어 붙는다".
    // 손가락(pointer)으로 바꾸지 말 것: 같은 동작인데 커서만 달라 보인다
    cursor: STRUCT_LINK_CURSOR,
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
    // ⚠ `cell`(두꺼운 십자)로 되돌리지 말 것 — 크다는 이유로 사용자가 바꾼 값이다.
    //   `alias`(화살표+링크)도 한 번 거쳤다가 "+ 모양이 낫다"고 되돌아왔다.
    //   지금은 위 STRUCT_LINK_CURSOR — 같은 십자인데 13px로 줄인 것이다
    cursor: STRUCT_LINK_CURSOR,
  },
  // ⚠ 구조 선택 시 **꼭짓점 위 커서 규칙은 없다** (2026-08-15 사용자 요청으로 제거).
  //   예전엔 `move`(4방향 화살표)를 띄웠는데 필요 없다고 해서 뺐다.
  //   ※ 커서 힌트만 없앤 것이다 — 꼭짓점 드래그·선택은 그대로다
  //     (판정은 hitDetection의 buildHitChain이 따로 갖는다). 되살리려면
  //     findHitStructPointIdx로 규칙을 다시 만들면 되지만, 먼저 사용자에게 확인할 것
];

export function getCursor(ctx) {
  for (const rule of CURSOR_RULES) {
    if (rule.test(ctx)) return rule.cursor;
  }
  return null;
}
