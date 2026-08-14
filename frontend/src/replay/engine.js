// 리플레이 엔진 — 커서 하나로 "지금 몇 시인가"를 정하고 캔들 배열을 만들어 준다
//
// 훅이 아니라 순수 클래스인 이유는 structureZigzag.js와 같다: 배열을 이어붙이는
// 규칙이 까다로워서(확정봉 전환·시크 시 identity 교체) node에서 검산할 수 있어야 한다.
//
// ── 구조 ─────────────────────────────────────────────────────────────────
//   display : 표시 TF SoA. [워밍업 시작, 끝) — 워밍업 구간은 처음부터 다 보인다
//   drive   : 구동 TF SoA. [리플레이 시작, 끝) — 워밍업 구간은 필요 없다
//   cursor  : 소비한 구동 봉 수. cursor=0이면 리플레이 시작 직전이다
//
// 화면에 올라가는 배열 = 확정된 표시봉들 + **진행 중 봉 1개**.
// 진행 중 봉은 그 봉에 속한 구동 봉들을 실시간 집계한 값이다:
//   o = 첫 구동봉의 시가 / h = 최고가 / l = 최저가 / c = 마지막 구동봉의 종가 / v = 합
// 구동 봉을 전부 소비하면 이 값은 실제 표시봉과 정확히 일치한다(검산됨).
//
// ── 배열 identity 규칙 (중요) ────────────────────────────────────────────
// 재생 중에는 **같은 배열을 in-place로** 갱신한다. structureZigzag는 초기화 조건이
// `_st.arr !== candles`(identity 비교, structureZigzag.js:315)라, 배열을 유지해야
// forward-only 누적이 이어지고 CHoCH가 깜빡이지 않는다.
// 반대로 **시크할 때는 새 배열을 만든다** — 과거로 되감으면 누적 상태를 버려야 하는데,
// 그 identity 교체가 곧 리셋 신호다. 별도 리셋 API가 필요 없는 이유다.
//
// ── 배열을 잘라내지 않는다(shift 없음) ───────────────────────────────────
// useCandles는 3100봉을 넘으면 앞을 버린다(useCandles.js:41). 여기서는 안 버린다.
// candles[0]이 바뀌면 그것도 ZZ 초기화 조건이라, 봉마다 shift하면 매 봉 전체
// 재계산이 돌아 리플레이가 느려지고 CHoCH가 재생 중에 사라졌다 나타난다.
// 리플레이는 구간이 처음부터 정해져 있어 무한히 자라지 않으므로 버릴 이유가 없다.

import { indexOfTime, candleAt, soaToCandles } from "./soa.js";
import { tfMs } from "./timeframes.js";

export class ReplayEngine {
  /**
   * @param display        표시 TF SoA (워밍업 포함)
   * @param drive          구동 TF SoA (리플레이 구간만)
   * @param replayStartMs  리플레이 시작 시각 — **표시 TF 봉 경계에 정렬돼 있어야 한다**
   */
  constructor({ tf, driveTf, display, drive, replayStartMs }) {
    this.tf = tf;
    this.driveTf = driveTf;
    this.display = display;
    this.drive = drive;
    this.driveMs = tfMs(driveTf);
    this.displayMs = tfMs(tf);
    this.replayStartMs = replayStartMs;

    // ⚠ 정렬이 어긋나면 진행 중 봉의 시가가 틀린다. 리플레이 시작이 표시봉 한가운데면
    //   그 봉의 앞부분 구동 데이터가 없어서, 집계 시가가 실제 시가와 달라진다.
    const di = indexOfTime(display, replayStartMs);
    if (display.n && (di >= display.n || display.t[di] !== replayStartMs)) {
      throw new Error("replayStartMs가 표시 TF 봉 경계에 정렬되지 않았습니다");
    }

    this.cursor = 0;
    this.candles = [];
    this._closedInArr = 0;
    this._hasForming = false;
    this.rebuild();
  }

  get total()    { return this.drive.n; }
  get atEnd()    { return this.cursor >= this.drive.n; }
  get progress() { return this.drive.n ? this.cursor / this.drive.n : 1; }

  /** 시뮬레이션 상의 현재 시각 = 마지막으로 소비한 구동 봉의 마감 시각 */
  get nowMs() {
    if (this.cursor === 0) return this.replayStartMs;
    // 다음 구동 봉의 시가 = 직전 봉의 정확한 마감. 1M처럼 길이가 불규칙한 TF에서도 맞다
    return this.cursor < this.drive.n
      ? this.drive.t[this.cursor]
      : this.drive.t[this.cursor - 1] + this.driveMs;
  }

  /**
   * 현재가 — liveClose에 그대로 넣는다.
   *
   * ⚠ 커서 0(재생 시작 직전)에서도 **null을 돌려주면 안 된다.** 그러면 화면이
   *   liveClose에 남아 있던 **오늘 시세**를 계속 쓴다. 실제로 2026-05 구간을
   *   띄워 놓고 방금 진입한 포지션의 미실현이 −$2,104로 찍혔다(오늘 가격과의 차이).
   *   재생 전 시점의 현재가 = 직전 확정봉의 종가다.
   */
  get price() {
    if (this.cursor > 0) return this.drive.c[this.cursor - 1];
    const n = this.closedCount();
    return n > 0 ? this.display.c[n - 1] : null;
  }

  /** 완전히 마감된 표시봉 수 */
  closedCount() {
    const n = this.display.n;
    if (!n) return 0;
    const now = this.nowMs;

    // nowMs 이하에 시작한 봉 수. 봉 i의 마감 = 봉 i+1의 시가이므로,
    // 그중 마지막(k−1)만 아직 진행 중이고 나머지는 확정이다
    const k = indexOfTime(this.display, now + 1);

    // ⚠ 마지막 봉만 예외 — 뒤에 봉이 없어 마감 시각을 길이로 판정해야 한다.
    //   이걸 빼면 재생이 끝까지 가도 마지막 봉이 영원히 "진행 중"으로 남아
    //   확정 전환이 한 번 누락된다 (실측: 72봉 구간에서 마감 이벤트 71회).
    if (k === n && this.display.t[n - 1] + this.displayMs <= now) return n;
    return Math.max(0, k - 1);
  }

  /**
   * 진행 중 표시봉 — 그 봉에 속한 구동 봉들의 집계. 아직 틱이 없으면 null.
   * (직전 봉이 막 마감된 순간이 그렇다)
   */
  formingBar() {
    const di = this.closedCount();
    if (di >= this.display.n) return null;

    const barOpen = this.display.t[di];
    const a = indexOfTime(this.drive, barOpen);
    const b = this.cursor;
    if (b <= a) return null;

    const d = this.drive;
    let h = d.h[a], l = d.l[a], v = 0;
    for (let i = a; i < b; i++) {
      if (d.h[i] > h) h = d.h[i];
      if (d.l[i] < l) l = d.l[i];
      v += d.v[i];
    }
    return { t: new Date(barOpen), o: d.o[a], h, l, c: d.c[b - 1], v };
  }

  /** 커서 이동 (재생·한 틱씩). 배열 identity는 유지된다 */
  step(n = 1) {
    const next = Math.max(0, Math.min(this.cursor + n, this.drive.n));
    if (next === this.cursor) return { moved: false, barClosed: false };
    // 뒤로 가는 건 시크다 — 누적 상태를 버려야 하므로 배열을 새로 만든다
    if (next < this.cursor) { this.cursor = next; this.rebuild(); return { moved: true, barClosed: true }; }
    this.cursor = next;
    return { moved: true, barClosed: this._sync() };
  }

  /** 표시봉 하나가 마감될 때까지 전진 */
  stepBar() {
    const from = this.closedCount();
    let guard = 0;
    while (!this.atEnd && this.closedCount() === from) {
      this.step(1);
      if (++guard > 100_000) break;
    }
    return { moved: guard > 0, barClosed: true };
  }

  seek(driveIdx) {
    const next = Math.max(0, Math.min(Math.round(driveIdx), this.drive.n));
    if (next === this.cursor) return;
    this.cursor = next;
    this.rebuild();
  }

  seekTime(ms) { this.seek(indexOfTime(this.drive, ms)); }
  seekProgress(p) { this.seek(p * this.drive.n); }

  /**
   * 배열을 통째로 새로 만든다 — **identity가 바뀌므로 ZZ 누적 상태가 리셋된다**.
   * 시크 전용이다. 재생 중에 부르면 매 틱 CHoCH가 전부 재계산돼 깜빡인다.
   */
  rebuild() {
    const closed = this.closedCount();
    this.candles = soaToCandles(this.display, 0, closed);
    this._closedInArr = closed;
    this._hasForming = false;
    const f = this.formingBar();
    if (f) { this.candles.push(f); this._hasForming = true; }
    return this.candles;
  }

  /** 전진분만 배열에 반영 (in-place). 표시봉이 마감됐으면 true */
  _sync() {
    const arr = this.candles;
    const closed = this.closedCount();
    let barClosed = false;

    if (closed > this._closedInArr) {
      // 진행 중이던 봉은 집계값이므로 버리고 **실제 표시봉 값**으로 다시 넣는다.
      // (집계와 일치하는 게 정상이지만, 원본이 있는데 파생값을 남길 이유가 없다)
      if (this._hasForming) { arr.pop(); this._hasForming = false; }
      for (let i = this._closedInArr; i < closed; i++) arr.push(candleAt(this.display, i));
      this._closedInArr = closed;
      barClosed = true;
    }

    const f = this.formingBar();
    if (f) {
      if (this._hasForming) arr[arr.length - 1] = f;
      else { arr.push(f); this._hasForming = true; }
    } else if (this._hasForming) {
      arr.pop();
      this._hasForming = false;
    }
    return barClosed;
  }
}
