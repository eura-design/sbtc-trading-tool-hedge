import { useEffect, useRef } from "react";
import { M } from "../constants";
import { captureChart } from "../utils/captureChart";
import { api } from "../api/client";

/**
 * 포지션 진입/청산 시 차트 스크린샷을 자동 캡처하여 백엔드에 저장.
 *
 * @param {Object}  position        - 포지션 상태 (open, side, entryPrice, unrealizedPnl)
 * @param {Object}  chartActionsRef - chartActionsRef (ChartArea가 노출하는 ref)
 * @param {Array}   candles         - 캔들 데이터 배열
 */
export function useScreenshot(position, chartActionsRef, candles) {
  const prevOpenRef     = useRef(false);
  const prevPositionRef = useRef(null); // 청산 감지용 — 이전 포지션 정보 보관

  useEffect(() => {
    const wasOpen = prevOpenRef.current;
    const isOpen  = position?.open === true;

    let event = null; // "entry" | "close"

    if (!wasOpen && isOpen) {
      event = "entry";
    } else if (wasOpen && !isOpen) {
      event = "close";
    }

    // 청산 전에 이전 포지션 정보 보관 (다음 사이클에서 사용)
    if (isOpen) prevPositionRef.current = position;
    prevOpenRef.current = isOpen;

    if (!event) return;

    setTimeout(() => {
      try {
        const actions = chartActionsRef.current;
        if (!actions) return;

        const { canvasRef, volCanvasRef, rsiCanvasRef, containerRef, scalesRef } = actions;
        const scales = scalesRef?.current;
        if (!canvasRef?.current || !containerRef?.current || !scales) return;

        // 진입 시 현재 position, 청산 시 이전 position 사용
        const pos = event === "entry" ? position : prevPositionRef.current;
        if (!pos) return;

        const entryPrice = pos.entryPrice;
        const side       = pos.side?.toUpperCase() || "UNKNOWN";
        const entryIdx   = candles.length > 0 ? candles.length - 1 : 0;

        const dataUrl = captureChart({
          canvas:    canvasRef.current,
          volCanvas: volCanvasRef?.current,
          rsiCanvas: rsiCanvasRef?.current,
          container: containerRef.current,
          scales,
          entryPrice,
          side,
          entryIdx,
          M,
          event,
        });

        const tag = event === "entry" ? side : `CLOSE_${side}`;
        api("POST", "/screenshot", { image: dataUrl, side: tag, entryPrice })
          .catch(err => console.warn("[screenshot] 저장 실패:", err.message));

        if (event === "close") prevPositionRef.current = null;
      } catch (err) {
        console.warn("[screenshot] 캡처 실패:", err.message);
      }
    }, 500);
  }, [position?.open]); // eslint-disable-line react-hooks/exhaustive-deps
}
