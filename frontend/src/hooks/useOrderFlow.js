import { useStore } from "../store";
import { useShallow } from "zustand/react/shallow";

/**
 * 주문 관련 액션을 스토어에서 가져오는 훅.
 * 모든 로직은 store/index.js에 정의되어 있음.
 */
export function useOrderFlow() {
  return useStore(useShallow(s => ({
    openConfirm:   s.openConfirm,
    executeOrder:  s.executeOrder,
    saveTpsl:      s.saveTpsl,
    deleteBox:     s.deleteBox,
    closePosition: s.closePosition,
    swapPosition:  s.swapPosition,
    scaleIn:       s.scaleIn,
    cancelScaleIn: s.cancelScaleIn,
    moveScaleIn:   s.moveScaleIn,
    addSplitTp:    s.addSplitTp,
    cancelSplitTp: s.cancelSplitTp,
    moveSplitTp:   s.moveSplitTp,
  })));
}
