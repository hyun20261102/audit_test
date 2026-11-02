// 공통 유틸: 저장소, 포맷, 거리 계산
const Store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v == null ? fallback : JSON.parse(v);
    } catch (e) { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch (e) { console.warn('저장 실패', key, e); return false; }
  },
  remove(key) { try { localStorage.removeItem(key); } catch (e) {} },
};

const fmt = {
  won: n => (Math.round(n || 0)).toLocaleString('ko-KR') + '원',
  num: n => (n || 0).toLocaleString('ko-KR'),
  km: m => m == null ? '-' : (m / 1000).toFixed(2),
  pct: r => isFinite(r) ? (r * 100).toFixed(1) + '%' : '-',
};

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// 두 좌표 간 거리(m), Haversine
function distanceM(a, b) {
  if (!a || !b) return null;
  const R = 6371008.8, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// 주소 정규화: 공백 정리
function normAddr(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

// 테이블 헤더 클릭 정렬
function makeSortable(table, onSort) {
  $$('th[data-k]', table).forEach(th => {
    th.addEventListener('click', () => {
      const dir = th.classList.contains('desc') ? 'asc' : 'desc';
      $$('th', table).forEach(h => h.classList.remove('asc', 'desc'));
      th.classList.add(dir);
      onSort(th.dataset.k, dir);
    });
  });
}

function sortBy(arr, key, dir) {
  const m = dir === 'asc' ? 1 : -1;
  return arr.slice().sort((a, b) => {
    const x = a[key], y = b[key];
    if (x == null && y == null) return 0;
    if (x == null) return 1;
    if (y == null) return -1;
    return (typeof x === 'number' ? x - y : String(x).localeCompare(String(y), 'ko')) * m;
  });
}

// 공용 툴팁
const Tip = {
  show(html, ev) {
    const t = $('#tooltip');
    t.innerHTML = html; t.hidden = false;
    const x = Math.min(ev.clientX + 12, window.innerWidth - t.offsetWidth - 8);
    t.style.left = x + 'px'; t.style.top = (ev.clientY + 14) + 'px';
  },
  hide() { $('#tooltip').hidden = true; },
};
