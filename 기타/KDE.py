"""
BTC/USDT S/R Detection — TDA + Weighted KDE
═══════════════════════════════════════════════════════════════════════════════

파이프라인:
  1. TDA (Persistent Homology, superlevel/sublevel set)
       각 TF의 가격 시계열에서 스윙 감지.
       persistence = f(peak) − f(saddle) : 위상학적 "생존 기간"
       작은 노이즈 스윙 → persistence 작음 → 자동 소멸
       구조적 스윙    → persistence 큼   → 생존

  2. Weighted KDE
       모든 TF의 유효 스윙 가격을 수집, norm_pers(=persistence/ATR)로 가중.
       ATR 정규화 덕분에 TF 간 배율 인수 불필요:
         - 1d 대형 스윙 → 높은 norm_pers → KDE에 더 강하게 기여
         - 15m 소형 스윙 → 낮은 norm_pers → 자연히 약하게 기여
       같은 가격대에 여러 TF 스윙이 모이면 밀도 피크가 자연히 높아짐.
       (MTF 가산점 개념이 KDE에 내재)

  3. TDA on KDE density
       밀도 함수 자체에 TDA 재적용.
       작은 밀도 bumps → persistence 작음 → 필터 아웃
       유의미한 밀도 피크만 S/R 레벨로 채택.

  오버레이 (KDE와 독립):
       PDH/PDL/PWH/PWL/PMH/PML  — 시장 참여자 공통 기준선
       라운드 넘버              — 심리적 앵커

파라미터 (3개, 전부 물리적 의미):
  PERSISTENCE_ATR_MULT  : 스윙 최소 유효 크기 (ATR 배수)
  BANDWIDTH_ATR_MULT    : KDE 커널 폭 (ATR 배수) — "근처"의 정의
  DENSITY_PEAK_MIN_PERS : 밀도 피크 최소 persistence (max 대비)

인위적 가중치 없음: TF 배율, MTF 가산점, S/R 종류별 가중치 전부 제거.
"""

import sys
import time
import platform
import warnings
import asyncio
import subprocess
import argparse

import numpy as np
import pandas as pd
import pandas_ta as ta
import ccxt.async_support as ccxt

warnings.filterwarnings('ignore')
if sys.platform == 'win32':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

# ══════════════════════════════════════════════════════════════ CONFIG ══════
SYMBOL     = 'BTC/USDT'
TIMEFRAMES = ['1d', '4h', '1h', '15m']
LIMIT      = 1000

# ── 물리적 의미가 명확한 파라미터 3개 ──────────────────────────────────────
PERSISTENCE_ATR_MULT  = 0.5   # 최소 유효 스윙: ATR의 절반 미만은 노이즈
BANDWIDTH_ATR_MULT    = 0.3   # "이 가격대"의 폭: 1h ATR × 0.3 달러
DENSITY_PEAK_MIN_PERS = 0.08  # 밀도 피크 필터: max density의 8% 미만 제거

KDE_PRICE_RANGE = 0.20   # 분석 범위: 현재가 ±20%
KDE_GRID_N      = 3000   # 밀도 함수 해상도
TOP_N           = 12     # 상/하 출력 레벨 수 (텍스트 리포트)
TOP_N_JSON      = 5      # 상/하 JSON 출력 레벨 수
OVERLAY_TAG_MULT = 0.5   # 오버레이 태그 반경 = ATR × 0.5

# ── CLI 인자로 파라미터 오버라이드 ──────────────────────────────────────────
def _parse_args():
    p = argparse.ArgumentParser(add_help=False)
    p.add_argument('--json',            action='store_true')
    p.add_argument('--kde-range',       type=float, default=None)
    p.add_argument('--persistence-atr', type=float, default=None)
    p.add_argument('--bandwidth-atr',   type=float, default=None)
    p.add_argument('--peak-min-pers',   type=float, default=None)
    p.add_argument('--limit',           type=int,   default=None)
    p.add_argument('--top-n',           type=int,   default=None)
    args, _ = p.parse_known_args()
    return args

_args = _parse_args()
if _args.kde_range       is not None: KDE_PRICE_RANGE      = _args.kde_range
if _args.persistence_atr is not None: PERSISTENCE_ATR_MULT = _args.persistence_atr
if _args.bandwidth_atr   is not None: BANDWIDTH_ATR_MULT   = _args.bandwidth_atr
if _args.peak_min_pers   is not None: DENSITY_PEAK_MIN_PERS = _args.peak_min_pers
if _args.limit           is not None: LIMIT                = _args.limit
if _args.top_n           is not None: TOP_N_JSON           = _args.top_n


# ══════════════════════════════════════════════════════════════ DATA ════════
class MarketDataFetcher:
    def __init__(self, symbol: str):
        self.symbol   = symbol
        self.exchange = ccxt.binance({
            'options': {'defaultType': 'future'},
            'enableRateLimit': True,
        })

    async def close(self):
        await self.exchange.close()

    async def fetch_ohlcv(self, tf: str) -> pd.DataFrame:
        try:
            raw = await self.exchange.fapiPublicGetKlines({
                'symbol':   self.symbol.replace('/', ''),
                'interval': tf,
                'limit':    LIMIT,
            })
            df = pd.DataFrame(raw, columns=[
                'timestamp', 'open', 'high', 'low', 'close', 'volume',
                'close_time', 'q_vol', 'trades', 'tb_vol', 'tb_qvol', 'ignore',
            ])[['timestamp', 'open', 'high', 'low', 'close', 'volume']]
            for c in df.columns:
                if c != 'timestamp':
                    df[c] = pd.to_numeric(df[c], errors='coerce')
            df['timestamp'] = pd.to_datetime(df['timestamp'], unit='ms')
            return df.set_index('timestamp')
        except Exception as e:
            print(f'[Error] fetch {tf}: {e}')
            return pd.DataFrame()


async def collect_tf_data(fetcher: MarketDataFetcher, tf: str) -> tuple:
    try:
        df = await fetcher.fetch_ohlcv(tf)
        if df.empty:
            return None, tf
        df['atr'] = ta.atr(df['high'], df['low'], df['close'], length=14)
        df.dropna(subset=['atr'], inplace=True)
        if df.empty or df[['close', 'atr']].iloc[-1].isna().any():
            return None, tf
        last = df.iloc[-1]
        return {'df': df, 'price': float(last['close']), 'atr': float(last['atr'])}, tf
    except Exception as e:
        print(f'[Error] {tf}: {e}')
        return None, tf


# ══════════════════════════════════════════════════════════════ TDA ═════════
def _persistence_1d(y: np.ndarray) -> list:
    """
    0-dimensional Persistent Homology — superlevel set filtration.

    이론적 배경:
      f : {0..n-1} → ℝ 인 1차원 함수에 대해
      superlevel set S_t = {i : f(i) ≥ t} 의 연결 성분을 t = ∞ → -∞ 로 추적.

      t 감소 시:
        - 국소 최댓값 위치에서 새 연결 성분 탄생 (birth = f(local_max))
        - 국소 최솟값(안장점) 위치에서 두 성분 병합:
          elder rule — 더 높은 피크를 가진 성분이 생존
          낮은 피크의 성분이 소멸 (death = f(saddle))
        - persistence = birth − death = f(dying_peak) − f(saddle)

      필수 클래스 (essential class):
        전역 최댓값은 끝까지 소멸하지 않음.
        persistence = f(global_max) − f(global_min) 으로 표현.

    안정성 정리(Stability Theorem):
      두 함수 f, g가 sup-norm으로 ε 거리 이내이면
      persistence diagram 사이의 bottleneck distance ≤ ε.
      → 작은 가격 노이즈는 작은 persistence만 생성, 자동 필터 가능.

    구현: Union-Find + path compression  →  O(n α(n)) amortized

    Returns:
      list of dict:
        persistence  : float  — 위상학적 수명
        peak_idx     : int    — 소멸 피크의 인덱스
        peak_price   : float  — y[peak_idx]
        saddle_price : float  — 소멸 안장점 y값
      (persistence 내림차순 정렬)
    """
    n = len(y)
    if n < 3:
        return []

    parent  = np.arange(n, dtype=np.int32)
    peak_of = np.arange(n, dtype=np.int32)   # peak_of[root] = argmax in component
    active  = np.zeros(n, dtype=bool)
    pairs   = []

    def find(x: int) -> int:
        """Path-compressed find"""
        while parent[x] != x:
            parent[x] = parent[parent[x]]   # path halving
            x = parent[x]
        return x

    # Filtration: process in decreasing order of y
    for idx in np.argsort(y)[::-1]:
        active[idx] = True
        l_in = (idx > 0)     and active[idx - 1]
        r_in = (idx < n - 1) and active[idx + 1]

        if not l_in and not r_in:
            # Isolated: new component born, this point is its peak
            pass  # parent[idx]=idx, peak_of[idx]=idx already set

        elif l_in ^ r_in:
            # One active neighbor: attach to that component (slope)
            # peak_of 갱신 불필요 — superlevel 순서로 처리하므로
            # 이미 처리된 이웃은 항상 현재보다 높음
            parent[idx] = find(idx - 1 if l_in else idx + 1)

        else:
            # Both active: saddle — merge two components
            rl, rr = find(idx - 1), find(idx + 1)
            if rl == rr:
                # 이미 같은 컴포넌트 (루프가 있는 경우)
                parent[idx] = rl
                continue

            pl, pr     = peak_of[rl], peak_of[rr]
            saddle_val = float(y[idx])

            # Elder rule: 더 높은 피크가 elder
            if y[pl] >= y[pr]:
                elder_root, dying_root, dying_peak = rl, rr, pr
            else:
                elder_root, dying_root, dying_peak = rr, rl, pl

            pers = float(y[dying_peak]) - saddle_val
            if pers > 0:
                pairs.append({
                    'persistence':  pers,
                    'peak_idx':     int(dying_peak),
                    'peak_price':   float(y[dying_peak]),
                    'saddle_price': saddle_val,
                })

            parent[dying_root] = elder_root
            parent[idx]        = elder_root
            # peak_of[elder_root] 갱신 불필요 — elder peak이 더 높으므로

    # Essential class: 전역 최댓값
    g = int(np.argmax(y))
    pairs.append({
        'persistence':  float(y[g] - y.min()),
        'peak_idx':     g,
        'peak_price':   float(y[g]),
        'saddle_price': float(y.min()),
    })

    return sorted(pairs, key=lambda p: p['persistence'], reverse=True)


def extract_swing_levels(df: pd.DataFrame, tf: str) -> list:
    """
    각 TF OHLCV에 TDA 적용 → 유효 스윙 레벨 추출.

    고점: highs 시계열에 superlevel persistence
    저점: −lows 시계열에 superlevel persistence (= lows의 sublevel set)

    필터: persistence ≥ ATR × PERSISTENCE_ATR_MULT
      → ATR 미만의 작은 스윙은 노이즈로 제거

    가중치 norm_pers = persistence / ATR
      → TF 간 가격 스케일 정규화
      → 1d 대형 구조 스윙이 15m 소형 스윙보다 자연히 높은 가중치
    """
    if len(df) < 20 or 'atr' not in df.columns:
        return []

    atr_series = df['atr'].dropna()
    if atr_series.empty:
        return []
    atr = float(atr_series.iloc[-1])
    if atr <= 0:
        return []

    thresh = atr * PERSISTENCE_ATR_MULT
    highs  = df['high'].values.astype(float)
    lows   = df['low'].values.astype(float)
    out    = []

    # (입력 배열, 원본 배열, 레벨 타입)
    for y_in, orig, kind in [
        ( highs, highs, 'high'),
        (-lows,  lows,  'low'),
    ]:
        for p in _persistence_1d(y_in):
            if p['persistence'] < thresh:
                continue
            # y_in의 peak_idx → 원본 가격으로 변환
            out.append({
                'price':     float(orig[p['peak_idx']]),
                'norm_pers': p['persistence'] / atr,
                'type':      kind,
                'tf':        tf,
            })

    return out


# ══════════════════════════════════════════════════════════════ KDE ═════════
def build_kde(
    all_levels:    list,
    current_price: float,
    atr_1h:        float,
) -> tuple:
    """
    Weighted Gaussian KDE.

    weight    = norm_pers (persistence/ATR)
    bandwidth = max(ATR_1h × BANDWIDTH_ATR_MULT, $10)

    설계 의도:
      - norm_pers가 클수록 (더 오래, 더 크게 살아남은 스윙) KDE에 강하게 기여
      - 같은 가격대에 여러 TF의 스윙이 집중 → 밀도 피크 자연 상승
        (MTF 가산점 없이도 multi-timeframe confluence가 밀도로 표현됨)
      - bandwidth = ATR 배수 → 현재 변동성 기준으로 "근처"의 의미를 자동 조정

    Returns: (grid, density) — shape (KDE_GRID_N,) 동일 길이 1D 배열
    """
    if not all_levels:
        return np.array([]), np.array([])

    prices  = np.array([lv['price']     for lv in all_levels])
    weights = np.array([lv['norm_pers'] for lv in all_levels], dtype=float)
    weights /= weights.sum()   # 정규화

    bw   = max(atr_1h * BANDWIDTH_ATR_MULT, 10.0)   # floor: $10
    lo   = current_price * (1 - KDE_PRICE_RANGE)
    hi   = current_price * (1 + KDE_PRICE_RANGE)
    grid = np.linspace(lo, hi, KDE_GRID_N)

    # Vectorized: (G, L) 브로드캐스팅 → O(G × L) 메모리
    # G=3000, L≈수천 → ~수십 MB, 문제 없음
    z       = (grid[:, None] - prices[None, :]) / bw
    density = (weights[None, :] * np.exp(-0.5 * z ** 2)).sum(axis=1)
    density /= bw * np.sqrt(2 * np.pi)

    return grid, density


def find_density_peaks(grid: np.ndarray, density: np.ndarray) -> list:
    """
    KDE 밀도 함수 자체에 TDA 재적용 → 유의미한 피크만 선별.

    설계 의도:
      - KDE 결과에도 작은 노이즈 bumps가 있을 수 있음
      - TDA를 density에 재적용하면 persistence가 작은 bumps가 자동 소멸
      - 임계값: density.max() × DENSITY_PEAK_MIN_PERS
        → "최강 레벨의 8% 미만 강도" 피크는 제거

    Returns: list of dict {price, density, dens_pers}
             density 내림차순 정렬
    """
    if len(density) == 0:
        return []

    min_pers = float(density.max()) * DENSITY_PEAK_MIN_PERS
    out      = []

    for p in _persistence_1d(density):
        if p['persistence'] < min_pers:
            continue
        idx = p['peak_idx']
        if 0 <= idx < len(grid):
            out.append({
                'price':     float(grid[idx]),
                'density':   float(density[idx]),
                'dens_pers': p['persistence'],
            })

    return sorted(out, key=lambda x: x['density'], reverse=True)


# ══════════════════════════════════════════════════════════ OVERLAY ═════════
def get_pd_pw(df_map: dict) -> list:
    """PDH/PDL/PWH/PWL/PMH/PML — KDE와 독립적인 기준선 오버레이"""
    out = []

    df_1h = df_map.get('1h')
    if df_1h is not None and not df_1h.empty:
        tmp = df_1h.copy()
        tmp['_d'] = tmp.index.date
        d = tmp.groupby('_d').agg({'high': 'max', 'low': 'min'})
        if len(d) >= 2:
            out += [
                {'price': float(d['high'].iloc[-2]), 'label': 'PDH'},
                {'price': float(d['low'].iloc[-2]),  'label': 'PDL'},
            ]

    df_1d = df_map.get('1d')
    if df_1d is not None and not df_1d.empty:
        tmp = df_1d.copy()
        tmp['_w'] = [f"{t.isocalendar()[0]}-{t.isocalendar()[1]:02d}" for t in tmp.index]
        tmp['_m'] = [f"{t.year}-{t.month:02d}" for t in tmp.index]

        w = tmp.groupby('_w').agg({'high': 'max', 'low': 'min'})
        if len(w) >= 2:
            out += [
                {'price': float(w['high'].iloc[-2]), 'label': 'PWH'},
                {'price': float(w['low'].iloc[-2]),  'label': 'PWL'},
            ]

        m = tmp.groupby('_m').agg({'high': 'max', 'low': 'min'})
        if len(m) >= 2:
            out += [
                {'price': float(m['high'].iloc[-2]), 'label': 'PMH'},
                {'price': float(m['low'].iloc[-2]),  'label': 'PML'},
            ]

    return out


def get_rounds(price: float, pct: float = 0.20) -> list:
    """심리적 앵커 — 라운드 넘버"""
    lo, hi = price * (1 - pct), price * (1 + pct)
    out = []
    for step, label in [(10_000, '10k'), (5_000, '5k'), (1_000, '1k')]:
        base = int(lo // step) * step
        for p in range(base, int(hi) + step, step):
            if not (lo <= p <= hi):
                continue
            if step == 5_000 and p % 10_000 == 0:
                continue   # 10k와 중복
            if step == 1_000 and p % 5_000 == 0:
                continue   # 5k와 중복
            out.append({'price': float(p), 'label': label})
    return out


def tag_peaks(
    peaks:      list,
    pd_pw:      list,
    rounds:     list,
    all_levels: list,
    atr_1h:     float,
) -> list:
    """
    각 KDE 피크에 오버레이 태그 및 기여 TF 정보 부착.
    tag_radius = ATR × OVERLAY_TAG_MULT
    contrib_radius = bandwidth × 2 (KDE 커널 유효 범위)
    """
    tag_r  = atr_1h * OVERLAY_TAG_MULT
    bw2    = atr_1h * BANDWIDTH_ATR_MULT * 2

    for pk in peaks:
        c = pk['price']
        pk['pdpw']   = [lv['label'] for lv in pd_pw  if abs(lv['price'] - c) <= tag_r]
        pk['rounds'] = [lv['label'] for lv in rounds  if abs(lv['price'] - c) <= tag_r]
        contribs     = [lv          for lv in all_levels if abs(lv['price'] - c) <= bw2]
        pk['tfs']    = sorted({lv['tf']   for lv in contribs})
        pk['types']  = sorted({lv['type'] for lv in contribs})

    return peaks


# ══════════════════════════════════════════════════════════════ RENDER ═══════
def _stars(density: float, d_max: float) -> str:
    """
    별점: 최강 레벨 대비 상대적 밀도.
    인위적 임계값 없음 — 항상 최강이 ★★★★, 상대 비교로만 의미 있음.
    """
    r = density / d_max if d_max > 0 else 0
    if r >= 0.75: return '★★★★'
    if r >= 0.50: return '★★★'
    if r >= 0.30: return '★★'
    return '★'


def render_report(tf_data: dict) -> str:
    # ── 기본값 수집 ───────────────────────────────────────────────────────
    price  = 0.0
    atr_1h = 0.0
    atrs   = {}
    df_map = {}

    for tf, d in tf_data.items():
        if d is None:
            continue
        df_map[tf] = d['df']
        atrs[tf]   = d['atr']
        if tf == '15m':
            price = d['price']
        if tf == '1h':
            atr_1h = d['atr']

    if not price:
        price = next((d['price'] for d in tf_data.values() if d), 0.0)
    if not atr_1h:
        atr_1h = next((v for v in atrs.values() if v > 0), 100.0)

    # ── TDA → 스윙 레벨 수집 ─────────────────────────────────────────────
    all_levels = []
    for tf, d in tf_data.items():
        if d:
            all_levels.extend(extract_swing_levels(d['df'], tf))

    n_total = len(all_levels)
    n_by_tf = {tf: sum(1 for lv in all_levels if lv['tf'] == tf) for tf in TIMEFRAMES}

    # ── KDE → 밀도 피크 ──────────────────────────────────────────────────
    grid, density = build_kde(all_levels, price, atr_1h)
    raw_peaks     = find_density_peaks(grid, density)

    # ── 오버레이 ─────────────────────────────────────────────────────────
    pd_pw  = get_pd_pw(df_map)
    rounds = get_rounds(price)
    peaks  = tag_peaks(raw_peaks, pd_pw, rounds, all_levels, atr_1h)

    d_max  = max((p['density'] for p in peaks), default=1.0)
    resist = sorted([p for p in peaks if p['price'] > price],
                    key=lambda x: x['price'])[:TOP_N]
    supprt = sorted([p for p in peaks if p['price'] < price],
                    key=lambda x: x['price'], reverse=True)[:TOP_N]

    # ── 렌더링 ───────────────────────────────────────────────────────────
    W = 92
    lines = []
    lines.append('═' * W)
    lines.append(
        f"  BTC/USDT  ${price:>12,.2f}   "
        f"{pd.Timestamp.utcnow().strftime('%Y-%m-%d %H:%M')} UTC"
    )
    lines.append(
        f"  ATR  15m:{atrs.get('15m', 0):>6.0f}  "
        f"1h:{atr_1h:>7.0f}  "
        f"4h:{atrs.get('4h', 0):>7.0f}  "
        f"1d:{atrs.get('1d', 0):>7.0f}"
    )
    lines.append('─' * W)
    lines.append(
        f"  스윙 입력: {n_total}개  "
        + '  '.join(f"{tf}:{n_by_tf.get(tf, 0)}" for tf in TIMEFRAMES)
        + f"  |  KDE 피크: {len(peaks)}개"
    )
    lines.append('─' * W)
    lines.append(
        f"  {'가격':>12}  {'강도':8}  {'밀도%':>7}  {'TF':12}  오버레이 / 거리"
    )
    lines.append('  ' + '─' * (W - 2))

    def fmt(p: dict, side: str) -> str:
        dist_pct = (p['price'] - price) / price * 100
        dist_s   = f"+{dist_pct:.1f}%" if side == 'R' else f"{dist_pct:.1f}%"
        stars    = _stars(p['density'], d_max)
        rel_pct  = p['density'] / d_max * 100
        tf_s     = '/'.join(p['tfs']) if p['tfs'] else '?'
        ovl      = ' '.join(p['pdpw'] + p['rounds'])
        ovl_s    = f"  [{ovl}]" if ovl else ''
        return (
            f"  ${p['price']:>12,.2f}  {stars:<8}  {rel_pct:>6.1f}%"
            f"  {tf_s:<12}  {dist_s}{ovl_s}"
        )

    for p in reversed(resist):
        lines.append(fmt(p, 'R'))

    lines.append('  ' + '─' * (W - 2))
    lines.append(
        f"  ▶ 현재가  ${price:>12,.2f}  "
        f"(bandwidth ±${atr_1h * BANDWIDTH_ATR_MULT:,.0f}  |  "
        f"persistence 필터 ≥ ${atr_1h * PERSISTENCE_ATR_MULT:,.0f})"
    )
    lines.append('  ' + '─' * (W - 2))

    for p in supprt:
        lines.append(fmt(p, 'S'))

    lines.append('─' * W)

    if resist and supprt:
        r0 = resist[0]
        s0 = supprt[0]
        lines.append(
            f"  최근접 저항  ${r0['price']:>12,.2f}"
            f"  (+{(r0['price'] - price) / price * 100:.1f}%  {_stars(r0['density'], d_max)})"
        )
        lines.append(
            f"  최근접 지지  ${s0['price']:>12,.2f}"
            f"  (-{(price - s0['price']) / price * 100:.1f}%  {_stars(s0['density'], d_max)})"
        )

    lines.append('─' * W)
    lines.append('  방법론: TDA(Persistent Homology) → Weighted KDE → TDA on density')
    lines.append(
        f"  파라미터: "
        f"persistence≥ATR×{PERSISTENCE_ATR_MULT}  "
        f"bandwidth=ATR×{BANDWIDTH_ATR_MULT}  "
        f"peak_min_pers=max×{DENSITY_PEAK_MIN_PERS}"
    )
    lines.append('  오버레이: PDH/PDL/PWH/PWL/PMH/PML + 라운드넘버 (KDE 독립 레이어)')
    lines.append(
        '  강도: 최강 밀도 피크 대비 상대값  '
        '★★★★≥75%  ★★★≥50%  ★★≥30%  ★<30%'
    )
    lines.append('  TF 배율·MTF 가산점·종류별 가중치 없음 — persistence/ATR 하나로 통일')
    lines.append('═' * W)

    return '\n'.join(lines)


# ══════════════════════════════════════════════════════════════ JSON ════════
def render_json(tf_data: dict) -> str:
    import json

    price  = 0.0
    atr_1h = 0.0
    atrs   = {}

    for tf, d in tf_data.items():
        if d is None:
            continue
        atrs[tf] = d['atr']
        if tf == '15m':
            price = d['price']
        if tf == '1h':
            atr_1h = d['atr']

    if not price:
        price = next((d['price'] for d in tf_data.values() if d), 0.0)
    if not atr_1h:
        atr_1h = next((v for v in atrs.values() if v > 0), 100.0)

    all_levels = []
    for tf, d in tf_data.items():
        if d:
            all_levels.extend(extract_swing_levels(d['df'], tf))

    grid, density = build_kde(all_levels, price, atr_1h)
    raw_peaks     = find_density_peaks(grid, density)
    d_max         = max((p['density'] for p in raw_peaks), default=1.0)

    def stars(density_val):
        r = density_val / d_max if d_max > 0 else 0
        if r >= 0.75: return 4
        if r >= 0.50: return 3
        if r >= 0.30: return 2
        return 1

    resist = sorted([p for p in raw_peaks if p['price'] > price], key=lambda x: x['price'])[:TOP_N_JSON]
    supprt = sorted([p for p in raw_peaks if p['price'] < price], key=lambda x: x['price'], reverse=True)[:TOP_N_JSON]

    levels = []
    for p in resist:
        contribs = [lv for lv in all_levels if abs(lv['price'] - p['price']) <= atr_1h * BANDWIDTH_ATR_MULT * 2]
        tfs = sorted({lv['tf'] for lv in contribs})
        levels.append({
            'price':       round(p['price'], 2),
            'side':        'resistance',
            'stars':       stars(p['density']),
            'density_pct': round(p['density'] / d_max * 100, 1),
            'tfs':         tfs,
        })
    for p in supprt:
        contribs = [lv for lv in all_levels if abs(lv['price'] - p['price']) <= atr_1h * BANDWIDTH_ATR_MULT * 2]
        tfs = sorted({lv['tf'] for lv in contribs})
        levels.append({
            'price':       round(p['price'], 2),
            'side':        'support',
            'stars':       stars(p['density']),
            'density_pct': round(p['density'] / d_max * 100, 1),
            'tfs':         tfs,
        })

    return json.dumps({
        'price':     round(price, 2),
        'timestamp': pd.Timestamp.utcnow().strftime('%Y-%m-%dT%H:%M:%SZ'),
        'levels':    levels,
    })


# ══════════════════════════════════════════════════════════════ MAIN ═════════
async def main():
    t0      = time.time()
    fetcher = MarketDataFetcher(SYMBOL)
    print(f'[{SYMBOL}] 데이터 수집 중...')

    results = await asyncio.gather(
        *[collect_tf_data(fetcher, tf) for tf in TIMEFRAMES],
        return_exceptions=True,
    )
    await fetcher.close()

    tf_data = {
        res[1]: res[0]
        for res in results
        if isinstance(res, tuple) and res[0] is not None
    }

    if not tf_data:
        print('[Fail] 유효한 데이터 없음')
        return

    print(f'  수집 완료: {time.time() - t0:.1f}초')

    if _args.json:
        print(render_json(tf_data))
        return

    report = render_report(tf_data)
    print('\n' + report)

    # ── 클립보드 / 파일 저장 ─────────────────────────────────────────────
    try:
        sys_ = platform.system()
        if   sys_ == 'Windows':
            subprocess.run(['clip'],   input=report.encode('utf-16'), check=True)
        elif sys_ == 'Darwin':
            subprocess.run(['pbcopy'], input=report.encode('utf-8'),  check=True)
        else:
            subprocess.run(['xclip', '-selection', 'clipboard'],
                           input=report.encode('utf-8'), check=True)
        print('\n📋 클립보드 복사 완료')
    except Exception:
        try:
            with open('btc_sr_report.txt', 'w', encoding='utf-8') as f:
                f.write(report)
            print('\n📄 btc_sr_report.txt 저장')
        except Exception as fe:
            print(f'\n[Warn] 저장 실패: {fe}')


if __name__ == '__main__':
    if sys.platform == 'win32':
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    asyncio.run(main())