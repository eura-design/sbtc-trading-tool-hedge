import * as d3 from "d3";
import { useTheme } from "../../ThemeContext";
import { totalEquity } from "../../utils/equity";
import { iconBtn } from "../sidebarBtn";

// 큰 초록 숫자 — 왼쪽이 총자산, 오른쪽이 가용. **한 줄에 나란히** 둔다
// (2026-08-22 사용자 요청). 둘은 **같은 모양**이어야 한다 — 크기를 다르게 하면
// 한쪽이 부차적인 값처럼 읽힌다
//   ⚠ **글자가 하나도 없다** (2026-08-22 요청) — `총자산`/`가용` 라벨, `미실현 $x` 줄,
//     끝의 `USDT`까지 전부 제거됐다. 숫자 둘과 구분자 `/`뿐이다
//     (미실현은 바로 아래 포지션 카드가 이미 보여준다 — 중복.
//      단위는 이 앱이 USDT 하나만 다루므로 적을 이유가 없었고,
//      실제로 **⟳ 버튼과 겹쳐** 자리만 잡아먹고 있었다 — 실측)
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
//   안 줄이면 `$1,001,083 / $990,000`에서 `USDT`·⟳ 버튼이 밖으로 밀려
//   **새로고침을 누를 수 없게 된다**(실측). 잔고가 클수록 못 쓰는 건 말이 안 된다
//   ※ 두 숫자는 **항상 같은 크기**다 — 긴 쪽에 맞춰 둘 다 줄인다.
//     한쪽만 줄이면 그쪽이 부차적인 값처럼 읽힌다
function amountSize(a, b) {
  const len = a.length + b.length;
  if (len <= 16) return "20px";   // $101,083 / $50,000 까지
  if (len <= 20) return "17px";   // $1,001,083 / $990,000 까지
  return "14px";                  // 그 이상
}

export function BalanceCard({ balance, position, lastPrice, error, onRefetch, online }) {
  const { theme } = useTheme();
  // 음수는 `-$1,234` — 부호가 `$` 앞이다 (PositionCard 주석 참고)
  const fmt = p => `${p < 0 ? "-" : ""}$${d3.format(",.0f")(Math.abs(p))}`;

  const refetchBtn = (
    <button onClick={onRefetch} style={iconBtn(theme.textFaint)}
      onMouseEnter={e => e.target.style.color="#f0b90b"}
      onMouseLeave={e => e.target.style.color=theme.textFaint}>⟳</button>
  );

  // 백엔드 상태 점 — **⟳ 왼쪽**에 둔다 (2026-08-23 사용자 요청).
  //   ⚠ 예전엔 숫자 바로 뒤에 붙어 있었다. 거기 두면 `amountSize()`가 글자를 줄여도
  //     자릿수가 커질 때 숫자와 함께 밀려서, 잔고가 클수록 점이 ⟳ 쪽으로 파고들었다.
  //     ⟳와 한 덩어리로 묶으면 오른쪽 끝에 고정되어 자릿수와 무관해진다
  //   ⚠ 크기·박동은 `index.css`의 `.health-dot`이 갖는다 — **색만 여기서 준다**
  //     (css는 `currentColor`만 쓰므로 글로우가 저절로 따라온다)
  //   ⚠ 이 점은 **알림일 뿐 안전장치가 아니다.** 주문을 막지 않는다 —
  //     쌓인 요청을 실제로 막는 건 backend/server.js의 멈춤 감지다
  const healthDot = online === undefined ? null : (
    <span className={`health-dot${online ? "" : " off"}`}
      title={online ? "백엔드 정상" : "백엔드 응답 없음 — 재시작이 필요합니다"}
      style={{ color: online ? "#0ecb81" : "#f6465d" }} />
  );

  if (error) return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
      <span style={{ fontSize:"12px", color:"#f6465d" }}>⚠ server.js 실행 확인</span>
      {refetchBtn}
    </div>
  );

  if (!balance) return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
      <span style={{ fontSize:"12px", color:theme.textFaint }}>잔고 로딩중...</span>
      {refetchBtn}
    </div>
  );

  // ⚠ 폴링으로 들어온 `crossUnPnl`을 쓰지 않는다 — 그건 갱신 주기마다 계단처럼 뛴다.
  //   `lastPrice`로 매 틱 다시 계산해야 "포지션이 있으면 실시간으로 움직인다"가 성립한다.
  //   포지션이 없으면 미실현이 0이라 지갑 잔고 그대로 = 가만히 있는다 (요구사항)
  //   식은 `utils/equity.js` 하나가 갖는다 — PositionCard의 `미실현`과 같은 값에서 나와야 한다
  const equity = totalEquity(balance.walletBalance, position, lastPrice);
  const size = amountSize(fmt(equity), fmt(balance.availableBalance));

  return (
    <div style={{ display:"flex", alignItems:"baseline", justifyContent:"space-between", gap:"6px" }}>
      <div style={{ display:"flex", alignItems:"baseline", gap:"5px", minWidth:0 }}>
        <Amount value={equity} fmt={fmt} size={size} />
        {/* 구분자 — 라벨이 없으니 둘이 붙어 한 숫자로 읽히면 안 된다.
            흐린 색으로 두어 숫자보다 뒤로 물러나게 한다 */}
        <span style={{ fontSize:"15px", color:theme.textFaint }}>/</span>
        <Amount value={balance.availableBalance} fmt={fmt} size={size} />
      </div>
      <div style={{ display:"flex", alignItems:"center", gap:"6px", flex:"none", alignSelf:"center" }}>
        {healthDot}
        {refetchBtn}
      </div>
    </div>
  );
}
