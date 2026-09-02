// GET /api/symbols — 거래 가능한 USDT 무기한 목록 (화면 심볼 선택기용)
//
// 호가·수량 단위를 같이 내려준다. 프론트가 수량을 계산할 때 그 값이 필요하고,
// 백엔드와 **같은 출처**를 봐야 미리보기와 실주문이 어긋나지 않는다
// (splitLevels의 "미리보기와 실주문이 같은 함수를 본다"와 같은 이유).
const express = require("express");
const symbolInfo = require("../services/symbolInfo");

const router = express.Router();

router.get("/", (req, res) => {
  const list = symbolInfo.listTradable();
  // 아직 못 받았으면 SEED뿐이라 목록이 1개다 — 그걸 "이게 전부"로 보이게 두지 않는다
  res.json({ symbols: list, stale: symbolInfo.isStale(), count: list.length });
});

module.exports = router;
