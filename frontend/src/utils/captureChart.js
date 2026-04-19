/**
 * 차트 캔버스를 합성하고 진입/청산 마커를 그린 뒤 base64 PNG로 반환.
 *
 * @param {Object} opts
 * @param {HTMLCanvasElement} opts.canvas      - 메인 캔들 캔버스
 * @param {HTMLCanvasElement} [opts.volCanvas] - 거래량 캔버스
 * @param {HTMLCanvasElement} [opts.rsiCanvas] - RSI 캔버스
 * @param {HTMLDivElement}    opts.container   - chartContainerRef (전체 크기 참조)
 * @param {Object}            opts.scales      - { xScale, yScale }
 * @param {number}            opts.entryPrice  - 진입 가격
 * @param {string}            opts.side        - "LONG" | "SHORT"
 * @param {number}            opts.entryIdx    - 마커 캔들 인덱스 (xScale 기준)
 * @param {Object}            opts.M           - 차트 마진 { top, right, bottom, left }
 * @param {string}            [opts.event]     - "entry" | "close"
 * @returns {string} data:image/png;base64,...
 */
export function captureChart({ canvas, volCanvas, rsiCanvas, container, scales, entryPrice, side, entryIdx, M, event = "entry" }) {
  const W = container.offsetWidth;
  const H = container.offsetHeight;
  const dpr = window.devicePixelRatio || 1;

  const off = document.createElement("canvas");
  off.width  = W * dpr;
  off.height = H * dpr;
  const ctx = off.getContext("2d");
  ctx.scale(dpr, dpr);

  // 배경
  ctx.fillStyle = "#0d1117";
  ctx.fillRect(0, 0, W, H);

  // 메인 캔버스
  if (canvas) ctx.drawImage(canvas, 0, 0, W, canvas.height / dpr);

  // 거래량 캔버스
  if (volCanvas && volCanvas.width > 0) {
    const top = parseFloat(volCanvas.parentElement ? volCanvas.style.top : 0) || 0;
    ctx.drawImage(volCanvas, 0, top, W, volCanvas.height / dpr);
  }

  // RSI 캔버스
  if (rsiCanvas && rsiCanvas.width > 0) {
    const top = parseFloat(rsiCanvas.style.top) || 0;
    ctx.drawImage(rsiCanvas, 0, top, W, rsiCanvas.height / dpr);
  }

  // 마커 그리기
  if (scales?.xScale && scales?.yScale && entryPrice != null) {
    const px = scales.xScale(entryIdx) + M.left;
    const py = scales.yScale(entryPrice) + M.top;
    const isLong = side === "LONG";
    const isClose = event === "close";

    // 진입: 초록(롱)/빨강(숏), 청산: 흰색
    const color = isClose ? "#ffffff" : (isLong ? "#0ecb81" : "#f6465d");

    const sz = 10;
    ctx.save();
    ctx.fillStyle = color;
    ctx.strokeStyle = isClose ? "#888" : "#fff";
    ctx.lineWidth = 1.5;

    if (isClose) {
      // 청산 마커: X 표시
      ctx.beginPath();
      ctx.moveTo(px - sz * 0.6, py - sz * 0.6);
      ctx.lineTo(px + sz * 0.6, py + sz * 0.6);
      ctx.moveTo(px + sz * 0.6, py - sz * 0.6);
      ctx.lineTo(px - sz * 0.6, py + sz * 0.6);
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.5;
      ctx.stroke();
    } else {
      // 진입 마커: 삼각형 (롱=위 화살표, 숏=아래 화살표)
      ctx.beginPath();
      if (isLong) {
        ctx.moveTo(px, py - sz);
        ctx.lineTo(px - sz * 0.7, py + sz * 0.5);
        ctx.lineTo(px + sz * 0.7, py + sz * 0.5);
      } else {
        ctx.moveTo(px, py + sz);
        ctx.lineTo(px - sz * 0.7, py - sz * 0.5);
        ctx.lineTo(px + sz * 0.7, py - sz * 0.5);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }

    // 라벨
    const prefix = isClose ? "CLOSE" : side;
    const label = `${prefix} ${entryPrice.toLocaleString()}`;
    ctx.font = "bold 11px monospace";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    const labelX = px + sz + 4;
    const tw = ctx.measureText(label).width;
    ctx.fillStyle = "#0d1117cc";
    ctx.fillRect(labelX - 2, py - 8, tw + 4, 16);
    ctx.fillStyle = color;
    ctx.fillText(label, labelX, py);

    ctx.restore();
  }

  return off.toDataURL("image/png");
}
