// 지그재그 레그의 **피크 거래량** — 순수 함수
//
// [LV1] 비교 대상은 "이전 상승 레그의 피크 vs 이번 상승 레그의 피크"다.
//   상승인데 피크가 줄었으면 동력 약화(다이버전스) 신호로 읽는다.
//   ※ 예전에 x축을 손으로 드래그해 구간을 잡는 도구로 만들었다가 **폐기**했다 —
//     비교할 때마다 레그를 두 개씩 직접 그려야 해서 실제로 안 쓰게 된다는 피드백.
//     지그재그가 이미 레그를 계산하고 있으므로 hover에 얹는 쪽이 맞다. 되돌리지 말 것.
//
// [LV2] **합계가 아니라 최대값이다** (사용자 확정 — "피크치만 비교하고 싶어").
//   합계로 되돌리지 말 것. 합계는 레그 길이에 휘둘린다: 2봉짜리 레그와 12봉짜리 레그를
//   총합으로 비교하면 사실상 "어느 쪽이 오래 걸렸나"를 재게 된다.
//   피크는 봉 하나의 값이라 **길이와 무관**하고, "가장 센 한 방이 얼마였나"를 바로 답한다.
//   (실측: 봉 수와의 상관계수가 합계 0.76 → 피크 0.26.
//    그래서 라벨에 봉 수를 병기하던 안전장치도 필요 없어져 뺐다)
//
// [LV3] 레그의 봉 범위는 **(i1, i2]** — 시작 꼭짓점 봉은 제외, 끝 꼭짓점 봉은 포함.
//   시작 봉은 직전 레그의 끝 봉이라, 포함하면 이웃한 두 레그가 같은 봉을 공유해
//   같은 피크가 양쪽에 잡힐 수 있다. 레그끼리 비교하는 게 목적이라 겹침이 없어야 한다.

/**
 * 레그 (i1, i2] 구간의 피크 — **캔들 색 기준** 하나만 낸다.
 *
 * [LV4] 피크 하나만 내면 그게 양봉인지 음봉인지 알 수 없어서 해석이 안 된다
 *   (사용자 지적). 그래서 방향별로 나눠 둘 다 낸다.
 *   봉 하나는 양봉이거나 음봉이라 **둘 중 한쪽에만** 들어간다.
 *   ※ 해당 봉이 아예 없는 레그가 있다(짧은 레그). 그때 그쪽은 null이고
 *     라벨에서도 빠진다 — 0으로 채우면 "피크가 0"으로 읽혀서 틀린 말이 된다.
 *
 * [LV5] **테이커(체결 주체) 기준은 없다** — 2026-08-13 사용자 요청으로 제거.
 *   한때 캔들 기준과 나란히 두 줄로 보여주며 어느 쪽이 쓸모 있는지 비교했고,
 *   결론은 캔들 기준만 남긴다였다. 다시 넣지 말 것.
 *   (되살리려면 useCandles의 `bv` 파싱 — klines k[9] / WebSocket k.V — 부터 필요하다.
 *    그것도 같이 지웠다)
 *
 * [LV6] 계산은 **양쪽 다 하지만** 화면에는 레그 방향에 맞는 쪽만 뜬다
 *   (상승 레그 → up, 하락 레그 → dn). 고르는 곳은 useChartInteraction.
 *   여기서 미리 걸러내지 말 것 — 이 함수는 순수 계산이고 무엇을 보여줄지는 표시 정책이다.
 *   반대쪽도 값 자체는 의미가 있어(상승 레그 안의 최대 되돌림 봉) 언제든 다시 켤 수 있게 둔다.
 *
 * @param candles candlesRef.current 권장 (진행 중 봉 반영)
 * @returns { bars, up, dn } | null   (각 peak은 { peak, idx } | null)
 */
export function legPeakVolume(candles, i1, i2) {
  if (!candles?.length) return null;
  const a = Math.round(Math.min(i1, i2));
  const b = Math.round(Math.max(i1, i2));
  const lo = Math.max(0, a + 1);                    // [LV3] 시작 봉 제외
  const hi = Math.min(candles.length - 1, b);
  if (hi < lo) return null;

  let up = null, dn = null;
  const bump = (cur, v, i) => (cur === null || v > cur.peak) ? { peak: v, idx: i } : cur;

  for (let i = lo; i <= hi; i++) {
    const c = candles[i];
    if (c.c >= c.o) up = bump(up, c.v, i);
    else            dn = bump(dn, c.v, i);
  }
  return { bars: hi - lo + 1, up, dn };
}

/** 거래량 축약 — 2.41K / 138 / 1.05M (BTC 단위) */
export function fmtVol(v) {
  const a = Math.abs(v);
  if (a >= 1_000_000) return (v / 1_000_000).toFixed(2) + "M";
  if (a >= 1_000)     return (v / 1_000).toFixed(1) + "K";
  if (a >= 100)       return v.toFixed(0);
  return v.toFixed(1);
}

/**
 * 직전 동일방향 레그 대비 증감률(%). 없거나 0이면 null.
 *
 * 지그재그는 상승·하락이 **반드시 교대**하므로 "직전 동일방향 레그" = 두 칸 앞이다.
 * 방향을 따로 판정할 필요가 없다 (그래서 이 비교가 공짜로 정확하다).
 */
export function volChangePct(cur, prev) {
  if (prev == null || prev <= 0) return null;
  return ((cur - prev) / prev) * 100;
}
