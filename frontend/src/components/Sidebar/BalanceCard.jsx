import { Fragment } from "react";
import * as d3 from "d3";
import { useTheme } from "../../ThemeContext";
import { totalEquity } from "../../utils/equity";

// 큰 초록 숫자 **셋** — 왼쪽부터 `미실현 제외 총잔고 / 미실현 포함 총잔고 / 가용`.
// **한 줄에 나란히** 둔다 (2026-08-22 요청, 2026-08-24 셋으로 확장).
// 셋은 **같은 모양**이어야 한다 — 크기를 다르게 하면 작은 쪽이 부차적인 값으로 읽힌다
//   ⚠ 왼쪽 둘은 **포지션이 없으면 같은 숫자다** (미실현이 0이라서). 정상이다 —
//     포지션을 열면 가운데만 틱마다 움직이므로 그 차이가 곧 미실현 손익이다.
//     같다고 해서 하나로 합치지 말 것 (있다 없다 하는 칸은 폭이 출렁인다)
//   ⚠ **글자가 하나도 없다** (2026-08-22 요청) — `총자산`/`가용` 라벨, `미실현 $x` 줄,
//     끝의 `USDT`까지 전부 제거됐다. 숫자 둘과 구분자 `/`뿐이다
//     (미실현은 바로 아래 포지션 카드가 이미 보여준다 — 중복.
//      단위는 이 앱이 USDT 하나만 다루므로 적을 이유가 없었다)
//   ⚠ 소수점도 없다 (같은 날 요청) — `,.0f`. 총자산은 **틱마다 움직이는 값**이라
//     센트 두 자리가 쉴 새 없이 굴러 시선을 끌었다. 자릿수가 고정이라
//     `tabular-nums`와 함께 폭도 흔들리지 않는다
function Amount({ value, fmt, size }) {
  return (
    <span style={{ fontSize:size, fontWeight:"700", color:"#0ecb81",
      fontVariantNumeric:"tabular-nums" }}>
      {fmt(value)}
    </span>
  );
}

// ⚠ 자릿수가 늘면 **글자를 줄여서** 한 줄을 지킨다 (사이드바 폭은 고정이다).
//   안 줄이면 큰 잔고에서 숫자가 사이드바 밖으로 삐져나온다(실측)
//   ※ 숫자 셋은 **항상 같은 크기**다 — 가장 긴 것에 맞춰 셋 다 줄인다
//
// 2026-08-24: 숫자가 셋이 되면서 "길이 몇 자 이하면 몇 px" 표를 버리고 **폭을 직접 계산**한다.
// 표는 숫자가 둘일 때 손으로 맞춘 값이라, 개수가 바뀌면 통째로 다시 재야 했다.
const ROW_W  = 218;   // 사이드바 272 − 좌우 패딩 32 − 상태 점 16 − 점 앞 gap 6
const SEP_W  = 16;    // 구분자 `/` 하나 + 양옆 gap
const CHAR_W = 0.6;   // JetBrains Mono 한 글자 폭 = 0.6em (등폭이라 자릿수 × 이 값이 곧 폭)
const SIZES  = [20, 17, 15, 13, 11];   // 큰 것부터 — 들어가는 첫 값을 쓴다

function amountSize(parts) {
  const chars = parts.reduce((n, t) => n + t.length, 0);
  const avail = ROW_W - SEP_W * (parts.length - 1);
  return (SIZES.find(px => chars * CHAR_W * px <= avail) ?? SIZES[SIZES.length - 1]) + "px";
}

export function BalanceCard({ balance, position, lastPrice, error, online, exchangeDown }) {
  const { theme } = useTheme();
  // 음수는 `-$1,234` — 부호가 `$` 앞이다 (PositionCard 주석 참고)
  const fmt = p => `${p < 0 ? "-" : ""}$${d3.format(",.0f")(Math.abs(p))}`;

  // 백엔드 상태 점 — 줄 **오른쪽 끝**에 둔다 (2026-08-23 사용자 요청).
  //   ⚠ **새로고침(⟳) 버튼은 같은 날 제거됐다.** 잔고는 계좌에 변화가 있으면 3초 안에,
  //     아무 일 없으면 60초마다 저절로 갱신돼서 손으로 누를 일이 없었다.
  //     되살리려면 `onRefetch`(= SidebarPanel의 `_refetchBal`)를 다시 넘겨야 한다
  //   ⚠ 점을 숫자 옆에 두지 말 것 — 거기 두면 `amountSize()`가 글자를 줄여도
  //     자릿수가 커질 때 숫자와 함께 밀린다. 오른쪽 끝에 붙여야 자릿수와 무관해진다
  //   ⚠ 크기·박동은 `index.css`의 `.health-dot`이 갖는다 — **색만 여기서 준다**
  //     (css는 `currentColor`만 쓰므로 글로우가 저절로 따라온다)
  //   ⚠ 이 점은 **알림일 뿐 안전장치가 아니다.** 주문을 막지 않는다 —
  //     쌓인 요청을 실제로 막는 건 backend/server.js의 멈춤 감지다
  //   ⚠ 16×16 칸 안에 넣는다 — 없앤 `⟳` 버튼과 **같은 자리·같은 폭**이라
  //     다른 카드의 아이콘들과 오른쪽 끝이 맞는다 (점만 두면 몇 px 안쪽으로 들어간다)
  //   ⚠ **색이 세 가지다** (2026-09-04 사용자 요청).
  //     초록 = 정상 / 빨강 = 백엔드가 응답하지 않음 / 주황 = 백엔드는 응답하는데
  //     **바이낸스에 못 닿는 중**이다. 셋째를 빨강에 합치지 말 것 — 대처가 다르다:
  //     빨강은 `server.js`를 다시 켜는 것이고, 주황은 인터넷이 돌아오기를 기다리는 것이다.
  //     주황인 동안 `watchAccount`가 계좌를 못 보므로 **무방비 경보도 못 뜬다**
  //     (실측 2026-08-27 05:11~06:39, 1시간 28분).
  //   ⚠ 박동(`.health-dot`의 `off`)은 빨강에만 붙인다 — 주황까지 깜빡이면
  //     둘을 눈으로 못 가른다
  const dotColor = !online ? "#f6465d" : exchangeDown ? "#f0b90b" : "#0ecb81";
  const dotTitle = !online ? "백엔드 응답 없음 — 재시작이 필요합니다"
                 : exchangeDown ? "바이낸스에 닿지 못하는 중 — 계좌 감시가 멈춰 있습니다"
                 : "백엔드 정상";
  const healthDot = online === undefined ? null : (
    <span style={{ width:"16px", height:"16px", display:"flex", flex:"none",
      alignItems:"center", justifyContent:"center", alignSelf:"center" }}
      title={dotTitle}>
      <span className={`health-dot${online ? "" : " off"}`}
        style={{ color: dotColor }} />
    </span>
  );

  // ⚠ **점이 빨개지면 곧바로 같이 띄운다** (2026-08-23 사용자 요청).
  //   `error`만 보면 잔고 조회가 실패할 때까지(최대 60초) 기다려야 해서,
  //   점은 이미 빨간데 문구는 한참 뒤에 떴다 — 두 표시가 따로 놀았다.
  //   점(`useHealth`)은 10초마다 확인하므로 이쪽이 늘 먼저 안다
  // ⚠ **어느 갈래로 빠지든 점을 함께 그린다.** 예전엔 이 줄에 점이 없어서
  //   문구가 뜨는 순간 점이 통째로 사라졌다 (사용자 신고)
  if (error || online === false) return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
      <span style={{ fontSize:"12px", color:"#f6465d" }}>⚠ server.js 실행 확인</span>
      {healthDot}
    </div>
  );

  if (!balance) return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
      <span style={{ fontSize:"12px", color:theme.textFaint }}>잔고 로딩중...</span>
      {healthDot}
    </div>
  );

  // ⚠ 폴링으로 들어온 `crossUnPnl`을 쓰지 않는다 — 그건 갱신 주기마다 계단처럼 뛴다.
  //   `lastPrice`로 매 틱 다시 계산해야 "포지션이 있으면 실시간으로 움직인다"가 성립한다.
  //   포지션이 없으면 미실현이 0이라 지갑 잔고 그대로 = 가만히 있는다 (요구사항)
  //   식은 `utils/equity.js` 하나가 갖는다 — PositionCard의 `미실현`과 같은 값에서 나와야 한다
  const equity = totalEquity(balance.walletBalance, position, lastPrice);
  // 왼쪽부터 미실현 **제외** / **포함** / 가용 (2026-08-24 사용자 지정 순서).
  // 제외분(walletBalance)은 거래소가 준 값 그대로라 틱마다 움직이지 않는다 —
  // 가만히 있는 값 옆에서 가운데만 뛰므로 그 차이가 미실현 손익으로 읽힌다
  const values = [balance.walletBalance, equity, balance.availableBalance];
  const texts  = values.map(fmt);
  const size   = amountSize(texts);

  return (
    <div style={{ display:"flex", alignItems:"baseline", justifyContent:"space-between", gap:"6px" }}>
      <div style={{ display:"flex", alignItems:"baseline", gap:"5px", minWidth:0 }}>
        {/* ⚠ 감싸는 요소 없이 **Fragment**로 펼친다 — div로 묶으면 그 자체가 flex 아이템이
            되어 숫자와 구분자 사이 gap(5px)이 사라진다 */}
        {values.map((v, i) => (
          <Fragment key={i}>
            {/* 구분자 — 라벨이 없으니 숫자끼리 붙어 하나로 읽히면 안 된다.
                흐린 색으로 두어 숫자보다 뒤로 물러나게 한다 */}
            {i > 0 && <span style={{ fontSize:"15px", color:theme.textFaint }}>/</span>}
            <Amount value={v} fmt={fmt} size={size} />
          </Fragment>
        ))}
      </div>
      {healthDot}
    </div>
  );
}
