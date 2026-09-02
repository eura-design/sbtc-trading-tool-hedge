const fs   = require("fs");
const { log, errOf } = require("./logStore");
const path = require("path");

const PENDING_FILE = path.join(__dirname, "../pending_orders.json");

class PendingOrderStore {
  #map       = new Map();
  #saveTimer = null;

  load() {
    try {
      if (!fs.existsSync(PENDING_FILE)) return;
      const raw    = JSON.parse(fs.readFileSync(PENDING_FILE, "utf-8"));
      const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000; // 7일
      for (const [k, v] of Object.entries(raw)) {
        if (v.createdAt && v.createdAt < cutoff) continue; // 오래된 주문 제거
        this.#map.set(k, v);
      }
    } catch (e) {
      log("STORE_IO_FAILED", { level: "error", store: "pendingOrders", op: "load", err: errOf(e) });
    }
  }

  get(orderId)         { return this.#map.get(String(orderId)); }
  /** 이 기록이 어느 심볼의 것인가 — 낡은 기록(필드 없음)은 기본 심볼이다 */
  symbolOf(orderId)    { return this.#map.get(String(orderId))?.symbol
                              ?? require("../services/symbolInfo").DEFAULT_SYMBOL; }
  has(orderId)         { return this.#map.has(String(orderId)); }
  delete(orderId)      { this.#map.delete(String(orderId)); this.#scheduleSave(); }
  clear()              { this.#map.clear(); this.#scheduleSave(); }
  entries()            { return this.#map.entries(); }
  get size()           { return this.#map.size; }

  // 즉시 저장이 필요한 크리티컬 상태 목록
  static #CRITICAL = new Set(["FILLED", "TPSL_PLACED", "TPSL_PARTIAL", "TPSL_MISSING"]);

  // ⚠ **`symbol`은 여기서 보정한다** (2026-09-02). 부르는 곳이 20군데가 넘어서
  //   한 곳만 빠뜨려도 그 주문이 "심볼을 모르는 기록"이 되고, 체결될 때 TP/SL이
  //   엉뚱한 심볼에 걸린다. 2026-09-02 이전 기록에는 이 필드가 아예 없으므로
  //   **읽는 쪽도 `info.symbol ?? DEFAULT_SYMBOL`로 읽어야 한다** (그때는 전부 BTCUSDT였다)
  set(orderId, info) {
    const existing = this.#map.get(String(orderId));
    // createdAt 우선순위: info 명시값 > 기존 entry 값 > 현재 시각
    // (recoveryService가 createdAt을 명시 전달하는 경우 보존)
    const createdAt = info.createdAt ?? existing?.createdAt ?? Date.now();
    const symbol    = info.symbol ?? existing?.symbol ?? require("../services/symbolInfo").DEFAULT_SYMBOL;
    const entry = { ...info, createdAt, symbol };
    this.#map.set(String(orderId), entry);
    // 크리티컬 상태 전환은 debounce 없이 즉시 저장
    if (PendingOrderStore.#CRITICAL.has(info.status)) {
      if (this.#saveTimer) { clearTimeout(this.#saveTimer); this.#saveTimer = null; }
      this.#save();
    } else {
      this.#scheduleSave();
    }
  }

  // debounce 500ms 후 비동기 저장
  #scheduleSave() {
    if (this.#saveTimer) clearTimeout(this.#saveTimer);
    this.#saveTimer = setTimeout(() => this.#save(), 500);
  }

  async #save() {
    try {
      const snapshot = JSON.stringify(Object.fromEntries(this.#map), null, 2);
      await fs.promises.writeFile(PENDING_FILE, snapshot);
    } catch (e) {
      log("STORE_IO_FAILED", { level: "error", store: "pendingOrders", op: "save", err: errOf(e) });
    }
  }

  // 즉시 저장 (셧다운 시 사용)
  async flush() {
    if (this.#saveTimer) { clearTimeout(this.#saveTimer); this.#saveTimer = null; }
    await this.#save();
  }
}

const _store = new PendingOrderStore();
// 서버 시작 직후 라우트가 호출돼도 store가 빈 상태가 되지 않도록 모듈 로드 시점에 동기 load
_store.load();
module.exports = _store;
