const DAY = 86400000;

// 달 단위 봉인가 — 이 시스템의 타임프레임은 주봉(7일) 다음이 바로 월봉이라
// 그 사이 어딘가를 자르면 둘이 갈린다 (27일 = 가장 짧은 달 28일보다 살짝 아래).
const isMonthlyStep = (interval) => interval >= 27 * DAY;

// 월봉 외삽 — **달력을 따라간다** (2026-08-24).
//
// ⚠ `+ n * interval`로 하면 안 된다. 달은 28~31일로 제각각인데 첫 두 봉의 간격(30일)을
//   모든 달에 곱하게 되어 **한 칸마다 하루씩 밀린다**. 게다가 월봉 라벨은 `연/월`만
//   보여주므로, 며칠 밀린 것이 결국 **달 이름 하나 차이**로 나타난다 —
//   마지막 봉이 8월이면 그 오른쪽 빈 칸도 `2026/08`로 떠서 8월이 두 번 있는 것처럼 보였다
//   (실측 2026-08-24: 오른쪽 6칸 전부 한 달씩 뒤처졌다).
// ※ 바이낸스 월봉은 항상 **그 달 1일 00:00 UTC**에 열린다 → 일/시각을 그대로 못박는다.
export function addMonthsUTC(ts, n) {
  const d = new Date(ts);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1);
}

// 캔들 인덱스 → 타임스탬프 변환 (미래 및 과거 영역 외삽 포함)
//
// ⚠ **캔들이 있는 구간은 계산하지 않는다** — 그 봉이 들고 있는 시각을 그대로 꺼내 쓴다.
//   그래서 과거·현재는 어떤 타임프레임에서도 정확하다 (실측: 5m~1M 전부 오차 0).
//   아래 외삽은 **캔들이 없는 빈 공간 전용**이다
export function idxToTimestamp(rawIdx, candles) {
  const lastIdx = candles.length - 1;
  if (lastIdx < 0) return 0;

  if (candles.length >= 2) {
    const t0 = +candles[0].t;
    const t1 = +candles[1].t;
    const interval = t1 - t0;
    const monthly  = isMonthlyStep(interval);

    if (rawIdx > lastIdx) {
      const di = Math.round(rawIdx) - lastIdx;
      const tLast = +candles[lastIdx].t;
      return monthly ? addMonthsUTC(tLast, di) : tLast + di * interval;
    }
    if (rawIdx < 0) {
      const di = Math.round(rawIdx);
      return monthly ? addMonthsUTC(t0, di) : t0 + di * interval;
    }
  }

  const idx = Math.max(0, Math.min(Math.round(rawIdx), lastIdx));
  return +candles[idx].t;
}

// 캔들 간격(ms) 계산
export function getCandleMs(candles) {
  return candles.length > 1 ? +candles[1].t - +candles[0].t : 3600000;
}
