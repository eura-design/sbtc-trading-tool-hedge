import { useState, useEffect, useMemo, useRef } from "react";
import { BN_PUBLIC } from "../constants";

// 펀딩비 + 공포·탐욕 지수
//
// ── 리플레이에서도 **과거 값**을 보여준다 ────────────────────────────────
// 2024년을 재생하는 중에 오늘의 펀딩비·심리 지표가 뜨면 그것 자체가 미래 정보다.
// 다행히 둘 다 이력 API가 있다 (실측):
//   · 펀딩비  /fapi/v1/fundingRate — 8시간마다 1건, 상장일까지
//   · 공포탐욕 api.alternative.me/fng — 하루 1건, **2018-02-01부터** (상장보다 앞선다)
// 그래서 리플레이에서 숨겨야 할 항목은 없다.

const FG_URL = "https://api.alternative.me/fng/";
const DAY = 86_400_000;

const pad = (n) => String(n).padStart(2, "0");

function fmtCountdown(ms) {
  if (ms == null || ms <= 0) return "00:00:00";
  return `${pad(Math.floor(ms / 3_600_000))}:${pad(Math.floor((ms % 3_600_000) / 60_000))}:${pad(Math.floor((ms % 60_000) / 1_000))}`;
}

/** 시각이 t 이하인 마지막 원소 (오름차순 배열) */
function lastAtOrBefore(arr, t, key) {
  let lo = 0, hi = arr.length - 1, found = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid][key] <= t) { found = arr[mid]; lo = mid + 1; }
    else hi = mid - 1;
  }
  return found;
}

// 펀딩 정산 간격 — BTCUSDT 무기한은 8시간 고정(00:00 / 08:00 / 16:00 UTC)
const FUNDING_INTERVAL = 8 * 3_600_000;

/**
 * 정산 시각이 이미 지났으면 **다음 정산 시각으로 굴린다** (2026-08-26에 고친 버그).
 *
 * `nextFundingTime`은 60초 폴링으로만 갱신된다. 그래서 카운트다운이 0에 닿은 뒤
 * **다음 폴링이 올 때까지 화면이 `00:00:00`에 멈춰 있었다** — 폴링 주기 중 어디서
 * 0이 되느냐에 따라 0~60초. 사용자가 10~20초로 관찰한 것이 이것이다.
 *
 * 거래소에 다시 묻지 않고 화면에서 굴린다 — 간격이 8시간 고정이라 계산으로 정확하고,
 * 정산 직후는 조회가 몰리는 시점이라 요청을 하나 더 얹을 이유가 없다.
 * ⚠ **반복문으로 더하지 말 것** — 값이 이상하면(0·NaN) 영영 도는 자리가 된다. 나눗셈으로 한 번에.
 * ※ 폴링이 곧 진짜 값을 물어오므로 이건 그 사이를 메우는 것이다. 어긋나도 1분 안에 맞춰진다.
 */
function rollForward(t, now) {
  if (!Number.isFinite(t) || t > now) return t;
  return t + Math.floor((now - t) / FUNDING_INTERVAL + 1) * FUNDING_INTERVAL;
}

function useFundingCountdown(nextFundingTime, nowOverride) {
  const [text, setText] = useState("");
  useEffect(() => {
    // ⚠ 리플레이는 **재생 시각** 기준이라 타이머가 필요 없다 — 아래에서 직접 만든다.
    //   벽시계 1초 타이머를 돌리면 일시정지 중에도 카운트다운만 혼자 줄어든다
    if (!nextFundingTime || nowOverride != null) return;
    const tick = () => {
      const now = Date.now();
      setText(fmtCountdown(rollForward(nextFundingTime, now) - now));
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [nextFundingTime, nowOverride]);

  if (!nextFundingTime) return "";
  if (nowOverride != null) return fmtCountdown(nextFundingTime - nowOverride);
  return text;
}

/**
 * @param replayNowMs 리플레이 재생 시각. null이면 실거래(현재 값 폴링).
 */
export function useMarketInfo(replayNowMs = null) {
  const replay = replayNowMs != null;

  // ── 실거래 ──────────────────────────────────────────────────────────────
  const [live, setLive] = useState({ rate: null, next: null });
  const [liveFg, setLiveFg] = useState(null);

  useEffect(() => {
    if (replay) return;
    let alive = true;
    const fetchFunding = async () => {
      try {
        const r = await fetch(`${BN_PUBLIC}/fapi/v1/premiumIndex?symbol=BTCUSDT`);
        const d = await r.json();
        const rate = parseFloat(d.lastFundingRate);
        if (alive && !isNaN(rate)) setLive({ rate: rate * 100, next: d.nextFundingTime });
      } catch (e) { console.error("[useMarketInfo] funding 실패", e); }
    };
    fetchFunding();
    const id = setInterval(fetchFunding, 60_000);
    return () => { alive = false; clearInterval(id); };
  }, [replay]);

  useEffect(() => {
    if (replay) return;
    let alive = true;
    const fetchFG = async () => {
      try {
        const r = await fetch(`${FG_URL}?limit=1`);
        const item = (await r.json()).data?.[0];
        if (alive && item) setLiveFg({ value: Number(item.value), label: item.value_classification });
      } catch (e) { console.error("[useMarketInfo] FGI 실패", e); }
    };
    fetchFG();
    const id = setInterval(fetchFG, 3_600_000);
    return () => { alive = false; clearInterval(id); };
  }, [replay]);

  // ── 리플레이: 이력을 받아 두고 재생 시각으로 찾아 쓴다 ──────────────────
  const [fundHist, setFundHist] = useState([]);   // [{ time, rate }] 오름차순
  const [fgHist, setFgHist]     = useState([]);   // [{ time, value, label }] 오름차순
  const fundRangeRef = useRef(null);              // 받아 둔 구간 { from, to }

  // ⚠ deps를 **날짜 단위**로 줄인다. replayNowMs를 그대로 넣으면 틱마다
  //   effect가 돌아 매번 이력을 다시 받는다
  const replayDay = replay ? Math.floor(replayNowMs / DAY) : null;

  useEffect(() => {
    if (!replay) return;
    const now = replayDay * DAY;
    const loaded = fundRangeRef.current;
    // 남은 구간이 3일 미만이면 다음 덩어리를 받는다 (1000건 ≈ 333일)
    if (loaded && now >= loaded.from && now < loaded.to - 3 * DAY) return;

    const ac = new AbortController();
    const from = now - DAY;
    (async () => {
      try {
        const r = await fetch(
          `${BN_PUBLIC}/fapi/v1/fundingRate?symbol=BTCUSDT&startTime=${from}&limit=1000`,
          { signal: ac.signal },
        );
        if (!r.ok) return;
        const rows = await r.json();
        if (!Array.isArray(rows) || !rows.length) return;
        const list = rows.map(k => ({ time: +k.fundingTime, rate: +k.fundingRate * 100 }));
        fundRangeRef.current = { from, to: list[list.length - 1].time };
        setFundHist(list);
      } catch (e) { if (e.name !== "AbortError") console.error("[useMarketInfo] funding 이력 실패", e); }
    })();
    return () => ac.abort();
  }, [replay, replayDay]);

  // 공포탐욕은 하루 1건이라 세션 전체를 한 번에 받는다 (오늘까지의 일수 + 여유)
  const fgLoadedRef = useRef(false);
  useEffect(() => {
    if (!replay || fgLoadedRef.current) return;
    fgLoadedRef.current = true;
    const ac = new AbortController();
    (async () => {
      try {
        const days = Math.ceil((Date.now() - replayNowMs) / DAY) + 10;
        const r = await fetch(`${FG_URL}?limit=${Math.max(days, 2)}`, { signal: ac.signal });
        if (!r.ok) return;
        const rows = (await r.json()).data ?? [];
        // 응답은 최신순 — 이진 탐색을 쓰려면 오름차순이어야 한다
        setFgHist(rows
          .map(d => ({ time: +d.timestamp * 1000, value: Number(d.value), label: d.value_classification }))
          .sort((a, b) => a.time - b.time));
      } catch (e) { if (e.name !== "AbortError") console.error("[useMarketInfo] FGI 이력 실패", e); }
    })();
    return () => ac.abort();
  }, [replay]); // eslint-disable-line react-hooks/exhaustive-deps

  // 리플레이를 나가면 다음 세션에서 다시 받도록 되돌린다.
  // **ref만 비운다** — 배열까지 setState로 지우면 리렌더가 한 번 더 돌고,
  // 어차피 아래 조회가 신선도를 직접 확인하므로 남아 있어도 잘못 쓰이지 않는다
  useEffect(() => {
    if (replay) return;
    fgLoadedRef.current = false;
    fundRangeRef.current = null;
  }, [replay]);

  // ── 지금 보여줄 값 ──────────────────────────────────────────────────────
  // ⚠ 찾은 값이 **재생 시각과 같은 시대인지** 확인한다.
  //   구간을 바꿔 새 세션을 시작하면 이전 세션 이력이 잠깐 남아 있는데,
  //   그대로 쓰면 엉뚱한 시기의 값이 뜬다. 펀딩비는 8시간, 지수는 하루 간격이라
  //   그보다 오래된 항목은 "아직 못 받았다"로 본다
  const FUND_MAX_AGE = 9 * 3_600_000;
  const FG_MAX_AGE   = 2 * DAY;

  const funding = useMemo(() => {
    if (!replay) return live;
    const cur = lastAtOrBefore(fundHist, replayNowMs, "time");
    if (!cur || replayNowMs - cur.time > FUND_MAX_AGE) return { rate: null, next: null };
    // 다음 정산 시각은 이력의 다음 항목이 정확하다 (8시간 간격 가정보다 안전)
    const nextEntry = fundHist.find(f => f.time > replayNowMs);
    return { rate: cur.rate, next: nextEntry ? nextEntry.time : cur.time + 8 * 3_600_000 };
  }, [replay, live, fundHist, replayNowMs, FUND_MAX_AGE]);

  const fearGreed = useMemo(() => {
    if (!replay) return liveFg;
    const cur = lastAtOrBefore(fgHist, replayNowMs, "time");
    if (!cur || replayNowMs - cur.time > FG_MAX_AGE) return null;
    return { value: cur.value, label: cur.label };
  }, [replay, liveFg, fgHist, replayNowMs, FG_MAX_AGE]);

  const fundingCountdown = useFundingCountdown(funding.next, replay ? replayNowMs : null);

  return { fundingRate: funding.rate, fundingCountdown, fearGreed };
}
