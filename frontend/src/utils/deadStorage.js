// 없어진 기능이 브라우저에 남긴 찌꺼기 정리 — **규칙의 정본은 여기 하나다**
//
// 기능을 지워도 사용자가 켜/꺼 둔 값은 `localStorage`에 남는다. 해롭지는 않지만
// (읽는 코드가 없으므로) 나중에 저장소를 열어본 사람이 "이건 뭐지"로 시간을 쓴다.
//
// ⚠ **쓰이는 값을 지우면 설정이 새로고침마다 사라진다.** 그래서 순수 함수로 떼어
//   `tests/deadStorage.test.js`가 검산한다. `main.jsx`가 이 함수들을 부른다.
//   ⚠ 규칙을 테스트에 복제하지 말 것 — 여기서 import해 쓸 것.
//
// ⚠ 지운 값은 백엔드 백업(`backend/backups/`, 60일)에 그대로 남아 있다.

/**
 * `obj`에서 **허용 목록에 있는 키만** 남긴다 (`indicators`처럼 키 자체가 기능 이름일 때).
 *
 * @param allowed 살아 있는 키. **호출부가 코드의 정본에서 얻어야 한다** — 목록을
 *   복제하면 기능을 새로 추가할 때 그 설정이 새로고침마다 사라진다
 * @returns `{ value, changed }` — `changed`가 false면 저장하지 않는다(쓰기를 아낀다)
 */
export function keepOnly(obj, allowed) {
  const keep = new Set(allowed);
  const value = {};
  let changed = false;
  for (const [k, v] of Object.entries(obj ?? {})) {
    if (keep.has(k)) value[k] = v;
    else changed = true;
  }
  return { value, changed };
}

/**
 * `obj`에서 **이름을 지정한 필드만** 뺀다 (기능 하나가 없어졌을 때).
 * `keepOnly`와 반대 방향이다 — 그 뭉치에 무엇이 살아 있는지 다 알 수 없을 때 쓴다.
 * (예: `indicatorParams.zz`에는 지표 파라미터가 여럿이고, 그중 하나만 없어졌다)
 */
export function withoutFields(obj, fields) {
  if (!obj || typeof obj !== "object") return { value: obj, changed: false };
  const drop = new Set(fields);
  const value = {};
  let changed = false;
  for (const [k, v] of Object.entries(obj)) {
    if (drop.has(k)) changed = true;
    else value[k] = v;
  }
  return { value, changed };
}

/** 객체 배열의 **각 원소**에서 필드를 뺀다 (예: `structures[].showLegVol`) */
export function withoutFieldsInList(list, fields) {
  if (!Array.isArray(list)) return { value: list, changed: false };
  let changed = false;
  const value = list.map(item => {
    const r = withoutFields(item, fields);
    if (r.changed) changed = true;
    return r.changed ? r.value : item;
  });
  return { value, changed };
}
