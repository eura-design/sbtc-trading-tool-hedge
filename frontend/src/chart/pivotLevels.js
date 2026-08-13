/**
 * Pivot Levels — 스윙 피벗을 가격대로 뭉쳐 만드는 지지/저항 라인.
 *
 * 이 앱의 **유일한 지지/저항 지표**다. 예전에는 KDE 밀도 기반 `S/R Levels`(백엔드
 * `기타/KDE.py`를 15분 주기로 실행)가 있었지만 2026-08-13에 지표·백엔드 서비스·
 * 파이썬 스크립트까지 **전부 제거**하고 이걸로 대체했다. 되살리지 말 것 —
 * 사용자가 "마음에 안 든다"며 직접 제거를 요청했다.
 *
 * 근거가 다르다: 밀도는 "오래 머문 구간", 피벗은 "부딪히고 돌아선 지점"이다.
 * 여기는 후자만 본다 — 화면에 보이는 스윙 고/저점이 곧 레벨의 근거라 눈으로 검산된다.
 *
 * ── 멀티 타임프레임 (2026-08-13 사용자 요청) ──────────────────────────────────
 * 레벨은 **차트 TF와 무관하게** 사용자가 고른 TF들(`pivot.tfs`)에서 계산돼 전 프레임에
 * 똑같이 뜬다. 5m 차트를 보든 1d 차트를 보든 "1h·4h·1d 지지/저항"이 같은 가격에 있다.
 * - 그래서 좌표가 **timestamp**다 (`firstT`) — 봉 인덱스는 TF마다 다른 값이다
 * - 각 TF의 캔들은 `usePivotLevels`가 Binance REST로 따로 받아 온다 (차트 캔들과 별개)
 * - 겹치는 레벨은 상위 TF만 남긴다 — `combineTfLevels` 참고
 *
 * ── 설계 원칙 (심플하게 유지할 것) ────────────────────────────────────────────
 * [P1] 노브는 4개뿐이고 **전부 단조롭다** — 올리면 레벨이 줄거나(피벗 감지·병합 폭·
 *      최소 터치) 표시만 늘어난다(표시 개수). 제거된 S/R은 6개가 서로 상쇄돼
 *      (늘리는 노브 3 + 줄이는 노브 3) 사용자가 방향을 못 잡았다. 노브를 더 붙일 때는
 *      방향이 한쪽으로만 움직이는지 먼저 확인할 것.
 * [P2] 숫자 라벨을 붙이지 않는다. 강도는 선 진하기, 방향은 색으로만.
 *      (S/R 시절 밀도 % 라벨을 "가격축 옆이 지저분하다"고 뺐던 것과 같은 이유)
 * [P3] 레벨은 **처음 만들어진 봉에서 시작**해 오른쪽 끝까지 간다. 전 구간 가로선으로
 *      깔면 그 레벨이 언제 생긴 건지 알 수 없고, 화면 왼쪽이 선으로 덮인다.
 * [P4] 돌파된 레벨을 지우지 않는다 — 현재가 기준으로 지지↔저항 **역할만 바뀐다**.
 *      뚫린 저항이 지지가 되는 게 실제 동작이고, 지우면 그 정보가 사라진다.
 */

// 병합 폭 기준이 되는 변동성 — 최근 period 봉의 평균 레인지(h-l).
// 전 구간 평균이 아니라 최근값을 쓴다: 지금 시세의 폭으로 묶어야 화면에서 자연스럽다.
function recentAvgRange(candles, period) {
  const start = Math.max(0, candles.length - period);
  let sum = 0, cnt = 0;
  for (let i = start; i < candles.length; i++) { sum += candles[i].h - candles[i].l; cnt++; }
  return cnt > 0 ? sum / cnt : 0;
}

const ATR_PERIOD = 100;

/**
 * @param candles [{ o,h,l,c }]
 * @param params  { pivot_bars, merge_atr, min_touch, top_n, lookback }
 * @returns [{ price, touches, firstIdx, lastIdx, type: "sup"|"res" }] — 가격 오름차순
 */
export function computePivotLevels(candles, params = {}) {
  const pivot_bars = params.pivot_bars ?? 8;
  const merge_atr  = params.merge_atr  ?? 0.5;
  const min_touch  = params.min_touch  ?? 2;
  const top_n      = params.top_n      ?? 3;
  // lookback은 UI에 없다 (숨김) — 화면 캔들 수(1500)를 다 훑으면 몇 달 전 레벨까지
  // 후보가 된다. 이 지표가 답하려는 건 "최근 구간에서 반응한 지점"이다.
  const lookback   = params.lookback   ?? 600;

  if (candles.length < pivot_bars * 2 + 5) return [];

  const atr = recentAvgRange(candles, ATR_PERIOD);
  if (!(atr > 0)) return [];
  const half = (atr * merge_atr) / 2;   // 한 레벨로 묶는 반경

  // ── 1. 스윙 피벗 ────────────────────────────────────────────────────────────
  // 좌우 pivot_bars 봉보다 확실히 높은 고가 / 낮은 저가. 오른쪽 확인봉이 필요하므로
  // 마지막 pivot_bars 봉에서는 피벗이 나오지 않는다 (repaint 없음의 대가).
  const scanFrom = Math.max(pivot_bars, candles.length - lookback);
  const pivots = [];
  for (let i = scanFrom; i < candles.length - pivot_bars; i++) {
    let isHigh = true, isLow = true;
    for (let j = 1; j <= pivot_bars; j++) {
      if (candles[i].h <= candles[i - j].h || candles[i].h <= candles[i + j].h) isHigh = false;
      if (candles[i].l >= candles[i - j].l || candles[i].l >= candles[i + j].l) isLow  = false;
      if (!isHigh && !isLow) break;
    }
    if (isHigh) pivots.push({ i, p: candles[i].h });
    if (isLow)  pivots.push({ i, p: candles[i].l });
  }
  if (!pivots.length) return [];

  // ── 2. 가격대로 묶기 ────────────────────────────────────────────────────────
  // 정렬 후 순서대로 자르지 않고 **가장 붐비는 가격을 먼저 집는다**(greedy).
  // 순서대로 자르면 경계가 임의로 정해져, 한 덩어리로 보이는 피벗들이 둘로 쪼개진다.
  //
  // 고점 피벗과 저점 피벗을 섞어서 센다 — 저항이었다가 지지로 쓰인 자리(flip)가
  // 가장 강한 레벨이고, 나눠 세면 그게 각각 약한 레벨 둘로 보인다.
  let pool = pivots;
  const raw = [];
  while (pool.length) {
    let seed = null, seedCnt = -1, seedLast = -1;
    for (const s of pool) {
      let cnt = 0, last = -1;
      for (const q of pool) if (Math.abs(q.p - s.p) <= half) { cnt++; if (q.i > last) last = q.i; }
      // 동수면 더 최근에 반응한 쪽을 중심으로 — 옛 피벗에 레벨이 끌려가지 않게
      if (cnt > seedCnt || (cnt === seedCnt && last > seedLast)) { seed = s; seedCnt = cnt; seedLast = last; }
    }

    const members = [], rest = [];
    for (const q of pool) (Math.abs(q.p - seed.p) <= half ? members : rest).push(q);

    let sum = 0, firstIdx = Infinity, lastIdx = -1;
    for (const m of members) {
      sum += m.p;
      if (m.i < firstIdx) firstIdx = m.i;
      if (m.i > lastIdx)  lastIdx  = m.i;
    }
    // ⚠ 좌표는 **인덱스가 아니라 timestamp**로 내보낸다 — 이 레벨은 다른 TF 차트 위에도
    //   그려지고(멀티 TF), 거기선 봉 인덱스가 완전히 다른 값이다 (수동 구조와 같은 이유).
    //   화면 인덱스 변환은 렌더러가 `tsToIdx`로 한다
    raw.push({
      price: sum / members.length, touches: members.length,
      firstT: +candles[firstIdx].t, lastT: +candles[lastIdx].t,
      tol: half * 2,   // 이 TF에서 "같은 레벨"로 쳤을 폭 — TF 간 중복 제거에 쓴다
    });
    pool = rest;
  }

  // ── 3. 필터 + 현재가 기준 분류 ──────────────────────────────────────────────
  const kept = raw.filter(l => l.touches >= min_touch);
  const price = candles[candles.length - 1].c;

  // [P4] 돌파 여부로 지우지 않는다 — 현재가 위면 저항, 아래면 지지로 역할만 바뀐다.
  // 표시는 현재가에서 **가까운 순**으로 위·아래 각각 top_n개. 멀리 있는 레벨은
  // 지금 거래에 쓸 일이 없고, 화면만 덮는다.
  const res = kept.filter(l => l.price >  price).sort((a, b) => a.price - b.price).slice(0, top_n);
  const sup = kept.filter(l => l.price <= price).sort((a, b) => b.price - a.price).slice(0, top_n);

  return [
    ...sup.map(l => ({ ...l, type: "sup" })),
    ...res.map(l => ({ ...l, type: "res" })),
  ].sort((a, b) => a.price - b.price);
}

/**
 * 여러 타임프레임의 레벨을 한 화면용 목록으로 합친다 (멀티 TF, 2026-08-13 사용자 요청).
 *
 * @param perTf [{ tf, tfMs, levels }] — computePivotLevels 결과를 TF별로
 * @returns 각 레벨에 `tf`가 붙은 평평한 배열
 *
 * ⚠ **겹치면 상위 TF만 남긴다.** 1h와 4h가 사실상 같은 가격을 짚는 일이 흔한데,
 *   그대로 두면 몇 픽셀 차이로 선 두 개 + 라벨 두 개가 겹쳐 읽을 수 없게 된다.
 *   기준은 **하위 TF 자신의 병합 폭(tol)** — "이 정도 거리면 애초에 같은 레벨로
 *   묶였을 값"이므로 TF가 달라졌다고 따로 그릴 이유가 없다.
 *   상위 TF를 남기는 건 그쪽이 더 무거운 레벨이기 때문이다.
 */
export function combineTfLevels(perTf) {
  const out = [];
  // 큰 TF부터 — 먼저 자리를 잡은 쪽이 이긴다
  for (const { tf, levels } of [...perTf].sort((a, b) => b.tfMs - a.tfMs)) {
    for (const lv of levels) {
      if (out.some(k => Math.abs(k.price - lv.price) <= lv.tol)) continue;
      out.push({ ...lv, tf });
    }
  }
  return out.sort((a, b) => a.price - b.price);
}
