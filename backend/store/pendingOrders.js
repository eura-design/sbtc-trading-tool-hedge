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
    const entry = existing?.createdAt ? info : { ...info, createdAt: Date.now() };
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

module.exports = new PendingOrderStore();
