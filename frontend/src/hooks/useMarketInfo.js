import { useState, useEffect } from "react";
import { BN_PUBLIC } from "../constants";

function useFundingCountdown(nextFundingTime) {
  const [text, setText] = useState("");
  useEffect(() => {
    if (!nextFundingTime) return;
    const tick = () => {
      const ms = nextFundingTime - Date.now();
      if (ms <= 0) { setText("00:00:00"); return; }
      const h = Math.floor(ms / 3_600_000);
      const m = Math.floor((ms % 3_600_000) / 60_000);
      const s = Math.floor((ms % 60_000) / 1_000);
      setText(`${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [nextFundingTime]);
  return text;
}

export function useMarketInfo() {
  const [fundingRate, setFundingRate]       = useState(null);
  const [nextFundingTime, setNextFundingTime] = useState(null);
  const [fearGreed, setFearGreed]           = useState(null);

  // 펀딩비 — 1분 폴링
  useEffect(() => {
    const fetchFunding = async () => {
      try {
        const r = await fetch(`${BN_PUBLIC}/fapi/v1/premiumIndex?symbol=BTCUSDT`);
        const d = await r.json();
        const rate = parseFloat(d.lastFundingRate);
        if (!isNaN(rate)) {
          setFundingRate(rate * 100);
          setNextFundingTime(d.nextFundingTime);
        }
      } catch (e) { console.error("[useMarketInfo] funding 실패", e); }
    };
    fetchFunding();
    const id = setInterval(fetchFunding, 60_000);
    return () => clearInterval(id);
  }, []);

  // 공포탐욕지수 — 1시간 폴링
  useEffect(() => {
    const fetchFG = async () => {
      try {
        const r = await fetch("https://api.alternative.me/fng/?limit=1");
        const d = await r.json();
        const item = d.data?.[0];
        if (item) setFearGreed({ value: Number(item.value), label: item.value_classification });
      } catch (e) { console.error("[useMarketInfo] FGI 실패", e); }
    };
    fetchFG();
    const id = setInterval(fetchFG, 3_600_000);
    return () => clearInterval(id);
  }, []);

  const fundingCountdown = useFundingCountdown(nextFundingTime);

  return { fundingRate, fundingCountdown, fearGreed };
}
