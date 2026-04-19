// stats 캐시 상태를 서비스 계층에서 관리
// orderWatcher가 routes/stats를 직접 import하는 역방향 의존을 제거하기 위해 분리

let cache     = null;
let cacheTime = 0;

function invalidateCache() {
  cache     = null;
  cacheTime = 0;
}

function getCache()        { return { cache, cacheTime }; }
function setCache(c, time) { cache = c; cacheTime = time; }

module.exports = { invalidateCache, getCache, setCache };
