const express = require("express");
const fs      = require("fs");
const path    = require("path");

const router = express.Router();
const DIR    = "C:\\Users\\a\\Desktop\\BTC\\ScreenShot";

// 폴더 없으면 생성
if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });

/**
 * POST /api/screenshot
 * body: { image: "data:image/png;base64,...", side: "LONG"|"SHORT", entryPrice: 95000 }
 */
router.post("/", (req, res) => {
  try {
    const { image, side, entryPrice } = req.body;
    if (!image) return res.status(400).json({ error: "image required" });

    const base64 = image.replace(/^data:image\/\w+;base64,/, "");
    const buf    = Buffer.from(base64, "base64");

    // 파일명: 2026-04-18_153022_LONG_95000.png
    const now = new Date();
    const dt  = now.toISOString().slice(0, 10);
    const tm  = now.toTimeString().slice(0, 8).replace(/:/g, "");
    const price = entryPrice ? Math.round(entryPrice) : "0";
    const filename = `${dt}_${tm}_${side || "UNKNOWN"}_${price}.png`;

    fs.writeFileSync(path.join(DIR, filename), buf);
    res.json({ ok: true, filename });
  } catch (err) {
    console.error("[screenshot]", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
