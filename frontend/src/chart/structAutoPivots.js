// 커스텀 구조 자동 이어그리기 — **내가 찍은 마지막 꼭짓점 이후를 자동으로 찾아준다**
// (2026-08-26 사용자 요청)
//
// 손으로 찍은 꼭짓점 뒤에 자동으로 찾은 꼭짓점을 이어 붙인다. 화면에는 하늘색 점선으로
// 그려지고(= 아직 확정 아님), 끝점을 클릭하면 그 점들이 통째로 구조에 들어간다.
// 확정되면 그 뒤부터 다시 자동으로 찾는다 — 이 반복이 이 기능의 전부다.
//
// ── 왜 자동 ZZ 지표를 그대로 쓰지 않는가 ────────────────────────────────────
// 지표(chart/structureZigzag.js)는 **화면 전체에 상태가 하나뿐인 forward-only 누적기**라
// "이 구조의 마지막 점 이후만" 같은 부분 구간을 따로 굴릴 수 없다. 게다가 지표는
// 지표대로 계속 돌아야 한다(사용자 확정: 자동 지표 동작은 건드리지 않는다).
// 그래서 **판정 규칙만** chart/zigzagPivots.js에서 나눠 쓰고, 여기서는 꼭짓점만 뽑는다.
//
// ── CHoCH를 여기서 계산하지 않는 이유 ───────────────────────────────────────
// 뽑은 꼭짓점을 사용자 꼭짓점 뒤에 붙여 deriveStructure에 넘기면 CHoCH·지그재그·진행 중
// 레그가 전부 따라온다. 커스텀 구조는 원래 "꼭짓점 목록만 주면 나머지는 알아서"이므로
// 여기서 CHoCH를 다시 만들면 판정이 두 벌이 된다.
//
// ── 사용자가 찍은 점은 절대 건드리지 않는다 ─────────────────────────────────
// 자동 ZZ에는 "같은 방향 꼭짓점이 갱신되면 기존 점을 연장"하는 분기가 있는데, 그 대상이
// **사용자가 찍은 마지막 점**이면 적용하지 않는다(`out.length` 가드). 적용하면 내가 찍어둔
// 자리가 말없이 옮겨간다 — 손으로 그린 구조에서 가장 하면 안 되는 일이다.
// 자동으로 찾은 점끼리는 그대로 연장한다(지표와 같은 동작).

import {
  resolveZzParams, wilderATR, pivotAt, passesNoiseFilter,
} from "./zigzagPivots.js";   // ⚠ `.js`를 빼지 말 것 — node가 못 읽어
                              //   tests/structAutoMirror.test.js가 통째로 죽는다

/**
 * 이 구조의 자동 이어그리기 설정 — **읽기 경로는 여기 하나뿐이다**
 * (`fibLevelsOf`와 같은 규칙). 팝업 슬라이더·렌더가 같은 값을 봐야 한다.
 *
 * 저장은 `structures[].autoParams`(구조마다, localStorage). 없으면 기본값으로 떨어진다 —
 * 기본값은 `zigzagPivots.resolveZzParams` 하나가 정하므로 **자동 구조 지표와 처음 값이 같다**
 * (2026-08-26 사용자 지정: 시작 값은 그대로 두되, 이후로는 서로 영향을 주지 않는다).
 */
export const structAutoParamsOf = st => resolveZzParams(st?.autoParams);

/** 이 구조가 자동 이어그리기를 쓰는가 — **기본 OFF**(true일 때만 ON, 2026-08-26 사용자 지정) */
export const structAutoOn = st => st?.autoZz === true;

/**
 * 마지막 꼭짓점 이후 구간에서 자동으로 찾은 꼭짓점.
 *
 * @param points  사용자 꼭짓점 [{ t, p, type }] — 시간순, 고/저 교대(normalize 완료 가정)
 * @param candles **candlesRef.current**를 넘길 것. React candles state는 봉마감 때만
 *                갱신돼서 마지막 봉이 낡아 있다 (deriveStructure [5]와 같은 이유)
 * @param params  **그 구조의** 설정(`structures[].autoParams`). 자동 구조 지표의 설정과
 *                공유하지 않는다 — 구조마다 다른 값을 쓸 수 있어야 한다는 게 요구사항이다
 *                (2026-08-26 사용자 확정). 없으면 지표와 같은 기본값으로 떨어진다
 * @returns [{ t, p, type }] — 시간순, 첫 점은 사용자 마지막 점과 반대 타입.
 *          **전부 자동 ZZ와 같은 판정을 거친 꼭짓점이다.** 종류가 하나뿐이라 부르는 쪽은
 *          원소를 구분할 필요가 없다 (구분해야 할 일이 생기면 그건 설계가 어긋난 것이다)
 */
export function autoPivotsAfter(points, candles, params = {}) {
  if (!points?.length || !candles?.length) return [];
  const p = resolveZzParams(params);

  const lastPt = points[points.length - 1];

  // 마지막 꼭짓점이 놓인 봉 — deriveStructure.mapPivotIndices와 같은 규칙(전진 스캔).
  // 로드 범위보다 과거에 그린 구조는 0으로 떨어져 로드 구간 전체가 대상이 된다.
  // 그게 맞다 — 그 구조도 "마지막 점 이후"가 로드 구간 전체이기 때문이다.
  let lastIdx = 0;
  while (lastIdx < candles.length - 1 && +candles[lastIdx].t < lastPt.t) lastIdx++;

  // ⚠ **진행 중 봉(마지막 봉)도 훑는다** (2026-09-09 사용자 요청으로 변경).
  //   자동 ZZ의 step()이 진행 중 봉을 그대로 처리하므로, 여기서만 빼면 같은 자리에서
  //   답이 갈린다. 실측(BTCUSDT 4시간, 진행 중 봉 위치와 사용자 마지막 점 위치를 바꿔가며
  //   429가지): 빼고 돌리면 **387가지가 자동 ZZ와 달랐고**, 넣으면 429가지가 전부 같았다.
  //   되돌리지 말 것 — 되돌리면 재발하는 증상은 이렇다. 진행 중 봉이 같은 방향으로
  //   새 극값을 만들 때 자동 ZZ는 마지막 꼭짓점을 그 자리까지 연장해 CHoCH를 찍는데,
  //   이 함수는 한 봉 전 값에 꼭짓점을 확정해 버려 **그 돌파가 구조에 들어오지 않는다.**
  //   화면뿐 아니라 알림도 같이 늦는다 — `useChochAlert.evalStruct`가 이 함수를 부른다.
  //   ※ 대신 남는 것: 진행 중 봉은 ATR이 매 틱 커져 노이즈 필터 문턱도 같이 올라간다.
  //     그래서 봉 초반에 그려진 꼭짓점이 같은 봉 후반에 탈락해 사라질 수 있다.
  //     자동 ZZ는 한 번 찍은 것을 지우지 않아(forward-only) 이 일이 없고, 이 함수는
  //     매 틱 전체를 다시 뽑아야 꼭짓점 편집이 바로 반영되므로 그 방어를 쓸 수 없다.
  //     실측 빈도: 진행 중 봉에 새 꼭짓점이 붙은 722건 중, 그 봉이 반대쪽으로 2% 더
  //     움직였다고 가정했을 때 사라진 것은 4건. 드물어서 그대로 두기로 했다(사용자 판단).
  const end        = candles.length - 1;   // 피벗을 찾는 마지막 봉 (진행 중 봉 포함)
  const scanFrom   = Math.max(lastIdx, p.left_bars);

  // 훑을 봉이 있고 필터가 켜져 있을 때만 ATR을 만든다 (전 구간 계산이라 공짜는 아니다)
  const atr = (p.use_filter && scanFrom <= end) ? wilderATR(candles, p.atr_period) : null;

  const out = [];
  let lastType = lastPt.type === "H" ? 1 : -1;   // 1 = High, -1 = Low
  let lastP    = lastPt.p;

  const passes = (price, i) => passesNoiseFilter(
    price, lastP, () => atr?.[i], p.atr_mult, p.use_filter);

  // 고점 먼저, 저점 나중 — 자동 ZZ의 step()과 같은 순서를 지킬 것.
  // 한 봉이 둘 다 피벗일 수 있어서, 순서를 바꾸면 잡히는 꼭짓점이 달라진다.
  //
  // ⚠ **기준점이 놓인 봉(lastIdx)부터 본다 — `lastIdx + 1`이 아니다.**
  //   한 봉이 고점 피벗이면서 저점 피벗이기도 할 수 있는데(큰 바깥 봉), 그 봉을
  //   건너뛰면 **반대쪽 꼭짓점이 통째로 사라진다.** 자동 ZZ도 한 봉에서 두 분기를
  //   다 본다 — 규칙을 나눠 쓰는 이상 여기서만 다르면 안 된다.
  //   실측(node): 확정 지점 359곳 중 7곳이 이 경우였고, 그때 **점을 확정하는 순간
  //   바로 다음 점이 말없이 사라졌다** — 확정하면 그 뒤는 다시 자동으로 계산되는데,
  //   기준점이 그 봉으로 옮겨오면서 같은 봉의 반대쪽을 못 보게 되기 때문이다.
  //
  // ⚠ 대신 그 봉에서는 **기준점의 분기와 그보다 앞선 분기를 다시 보지 않는다**
  //   (`atAnchor`). 한 봉 안의 순서가 고점 → 저점이므로:
  //     · 기준점이 고점(H)이면 그 봉에 남은 것은 저점 분기뿐이다
  //     · 기준점이 저점(L)이면 고점 분기는 그 앞에 이미 지나갔으므로 남은 게 없다
  //   빼먹으면 반대로 **점이 늘어난다** — 기준점 앞 분기를 한 번 더 평가하게 되어,
  //   확정할 때마다 없던 꼭짓점이 생긴다 (실측: 359곳 중 8곳에서 2개씩 더 나왔다)
  for (let i = scanFrom; i <= end; i++) {
    const { ph, pl } = pivotAt(candles, i, p.left_bars);
    if (ph === null && pl === null) continue;
    const atAnchor = i === lastIdx;

    if (ph !== null && !atAnchor) {
      if (lastType !== 1) {
        if (passes(ph, i)) {
          out.push({ t: +candles[i].t, p: ph, type: "H" });
          lastType = 1; lastP = ph;
        }
      } else if (out.length && ph > lastP) {
        // 같은 방향 갱신 → 자동으로 찾은 마지막 점을 연장 (사용자 점은 제외 — 위 주석)
        const q = out[out.length - 1];
        q.t = +candles[i].t; q.p = ph; lastP = ph;
      }
    }

    if (pl !== null && !(atAnchor && lastPt.type === "L")) {
      if (lastType !== -1) {
        if (passes(pl, i)) {
          out.push({ t: +candles[i].t, p: pl, type: "L" });
          lastType = -1; lastP = pl;
        }
      } else if (out.length && pl < lastP) {
        const q = out[out.length - 1];
        q.t = +candles[i].t; q.p = pl; lastP = pl;
      }
    }
  }

  // ⚠ **여기서 "잠정 꼭짓점"을 붙이지 말 것** (2026-09-09 사용자 요청으로 제거).
  //   2026-08-26부터 맨 끝에 점을 하나 더 붙여 점선이 늘 현재 봉까지 닿게 했었다.
  //   그 점은 피벗 판정도 노이즈 필터도 거치지 않고 **직전 점과 반대 타입으로 고정**돼
  //   붙었는데, 자동 ZZ에는 없는 점이라 이것 하나로 두 지표의 답이 갈렸다:
  //     · `deriveStructure`가 이 점도 다른 점과 똑같이 취급한다 → 이 점이 구조 저점을
  //       깨면 자동 ZZ에는 없는 CHoCH가 찍힌다
  //     · 타입이 반대로 고정돼 있어, 진행 중 봉이 **같은 방향**으로 새 극값을 만들어도
  //       그 값이 구조에 들어오지 못한다 (자동 ZZ는 마지막 꼭짓점을 그 자리까지 연장한다)
  //   지금은 위 루프가 진행 중 봉까지 훑으므로 그 틈 자체가 없다.
  //   ※ 그래서 **점선은 자동 ZZ의 선이 끝나는 자리에서 같이 끝난다** — 현재 봉에 닿을
  //     때도 있고 아닐 때도 있다. 실측(BTCUSDT 4시간 700회): 자동 ZZ의 마지막 꼭짓점이
  //     현재 봉에 놓인 경우가 361회(52%), 앞 봉에 놓인 경우가 339회(중앙값 2봉 전,
  //     최대 11봉 전)다. **"현재 봉까지 닿아야 한다"는 규칙을 다시 만들지 말 것** —
  //     그 규칙이 곧 위에 적은 어긋남이다.

  return out;
}
