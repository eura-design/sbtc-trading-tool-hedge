// 측정 박스(사각형) 계산 — 순수 함수, **import 없음**
//
// pivotLevels.js·fib.js·entryPath.js와 같은 이유로 의존성 0이다: 화면에 뜨는 숫자가
// 곧 이 도형의 존재 이유라, 실제 값으로 node에서 바로 검산할 수 있어야 한다.
// (픽셀 좌표 계산은 tsToIdx가 필요해 hitDetection.js에 있다 — fibXs와 같은 방침)
//
// ── 무엇을 보여주나 (2026-08-26 사용자 확정) ────────────────────────────────
//   +3.42%      ← 등락률.  시작 모서리 → 끝 모서리
//   $2,150      ← 가격 차이 (부호 없음 — 방향은 위 %가 이미 말한다)
//   12시간       ← 기간
// 세 줄을 나란히 두는 이유: %만으로는 "얼마나 빨리"가 빠지고, 기간만으로는
// "얼마나 크게"가 빠진다.
//
// ⚠ **봉 수는 넣지 않는다** (2026-08-27 사용자 지정 — 넣었다가 뺐다).
//   같은 구간인데 타임프레임을 바꿀 때마다 숫자가 달라져(38일 = 1d 38봉 = 4h 228봉)
//   기간과 나란히 있으면 어느 쪽이 이 구간의 크기인지 헷갈린다.
//   되살릴 거면 봉 인덱스(i1/i2)를 다시 받아야 한다 — 기간 ÷ 봉 간격으로 계산하면
//   월봉에서 어긋난다(달마다 길이가 다르다)

/**
 * @param p1,p2 시작 가격 → 끝 가격 (드래그 시작 모서리가 p1이다 — 부호의 기준)
 * @param t1,t2 시작·끝 시각(ms)
 */
export function measureStats({ p1, p2, t1, t2 }) {
  return {
    pct:  p1 ? (p2 - p1) / p1 * 100 : 0,
    diff: p2 - p1,
    ms:   Math.abs(t2 - t1),
    up:   p2 >= p1,
  };
}

/**
 * 기간을 사람이 읽는 말로. 가장 큰 단위 둘까지만 — `3일 4시간 12분`은 길기만 하다.
 * ※ 주·달 단위는 쓰지 않는다. "2주"는 14일인지 15일인지가 사람마다 다르게 읽힌다
 */
export function fmtDuration(ms) {
  const min = Math.round(Math.abs(ms) / 60000);
  if (min < 60) return `${min}분`;
  const h = Math.floor(min / 60), m = min % 60;
  if (h < 24) return m ? `${h}시간 ${m}분` : `${h}시간`;
  const d = Math.floor(h / 24), hh = h % 24;
  return hh ? `${d}일 ${hh}시간` : `${d}일`;
}

/**
 * 가격 차이 표기. BTC는 만 단위라 보통 소수점이 필요 없지만, 아주 짧은 구간이면
 * `$0`으로 뭉개진다 → 10달러 미만일 때만 소수 둘째 자리까지 보여준다
 */
export function fmtPriceDiff(diff) {
  const v = Math.abs(diff);
  const s = v < 10 ? v.toFixed(2) : Math.round(v).toLocaleString("en-US");
  return `$${s}`;
}

// ⚠ 음수 부호는 **ASCII 하이픈**이다. `−`(U+2212)는 이 앱 폰트 스택(JetBrains Mono)에
// 없어서 OS 폴백 폰트가 그리고, 그 한 글자만 폭·높이가 달라진다
// (ReplayBar 일시정지 글리프와 같은 원인)
export function fmtPct(pct) {
  return `${pct >= 0 ? "+" : "-"}${Math.abs(pct).toFixed(2)}%`;
}
