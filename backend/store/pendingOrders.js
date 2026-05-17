const fs   = require("fs");
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
      console.error("pending_orders.json 로드 실패:", e.message);
    }
  }

  get(orderId)         { return this.#map.get(String(orderId)); }
  has(orderId)         { return this.#map.has(String(orderId)); }
  delete(orderId)      { this.#map.delete(String(orderId)); this.#scheduleSave(); }
  clear()              { this.#map.clear(); this.#scheduleSave(); }
  entries()            { return this.#map.entries(); }
  get size()           { return this.#map.size; }

  // 즉시 저장이 필요한 크리티컬 상태 목록
  static #CRITICAL = new Set(["FILLED", "TPSL_PLACED", "TPSL_PARTIAL", "TPSL_MISSING"]);

  set(orderId, info) {
    const existing = this.#map.get(String(orderId));
    // createdAt 우선순위: info 명시값 > 기존 entry 값 > 현재 시각
    // (recoveryService가 createdAt을 명시 전달하는 경우 보존)
    const createdAt = info.createdAt ?? existing?.createdAt ?? Date.now();
    const entry = { ...info, createdAt };
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
      console.error("pending_orders.json 저장 실패:", e.message);
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
