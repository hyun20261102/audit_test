// 화면 제어
const State = {
  txs: Store.get('cardTx', []),
  homes: Store.get('homes', []),
  from: '', to: '',
  empSort: { k: 'flagAmt', dir: 'desc' },
  txSort: { k: 'seq', dir: 'asc' },
  rows: [],
};

const S = Analysis.settings;
const RADIUS_OPTIONS = [300, 500, 1000, 2000, 3000, 5000];

function saveTxs() {
  if (!Store.set('cardTx', State.txs)) alert('브라우저 저장 공간이 부족해 사용내역을 저장하지 못했습니다. (새로고침 시 다시 업로드 필요)');
}
function saveHomes() { Store.set('homes', State.homes); }

/* ---------- 탭 ---------- */
let currentTab = 'data';
function showTab(name) {
  currentTab = name;
  $$('#tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  $$('.tab-panel').forEach(p => p.classList.toggle('active', p.id === 'tab-' + name));
  $('#globalFilters').hidden = !['dash', 'map', 'list', 'report'].includes(name);
  refresh();
}
$$('#tabs button').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));

/* ---------- 분석 결과 계산 ---------- */
function compute() {
  Analysis.invalidate();
  State.rows = State.txs
    // 날짜오류 건은 기간과 무관하게 항상 포함(점검 필요)
    .filter(t => !t.dateValid || ((!State.from || t.dateStr >= State.from) && (!State.to || t.dateStr <= State.to)))
    .map(t => {
      const r = Analysis.evaluate(t, State.homes);
      return { ...t, ...r, reasonsText: r.reasons.join(', ') };
    });
}

function refresh() {
  compute();
  renderCardSummary();
  if (currentTab === 'dash') renderDashboard();
  if (currentTab === 'map') renderMap();
  if (currentTab === 'list') renderList();
  if (currentTab === 'report' && window.Report) Report.onShow();
}

/* ---------- 1. 데이터 등록 ---------- */
$('#cardFile').addEventListener('change', async e => {
  const files = Array.from(e.target.files);
  e.target.value = '';
  const seen = new Set(State.txs.map(txKey));
  let added = 0, dup = 0;
  for (const f of files) {
    try {
      const rows = await parseCardFile(f);
      rows.forEach(t => {
        const k = txKey(t);
        if (seen.has(k)) { dup++; return; }
        seen.add(k); State.txs.push(t); added++;
      });
    } catch (err) { alert(err.message); }
  }
  saveTxs();
  initDateRange(true);
  refresh();
  $('#cardSummary').insertAdjacentHTML('afterbegin', `<div>추가 ${fmt.num(added)}건${dup ? `, 중복 제외 ${fmt.num(dup)}건` : ''}</div>`);
});

$('#clearCards').addEventListener('click', () => {
  if (!confirm('업로드한 사용내역을 모두 지웁니다.')) return;
  State.txs = []; saveTxs(); initDateRange(true); refresh();
});

function renderCardSummary() {
  const t = State.txs;
  if (!t.length) { $('#cardSummary').innerHTML = '등록된 사용내역이 없습니다.'; return; }
  const users = new Set(t.map(x => x.user));
  const dates = t.filter(x => x.dateValid).map(x => x.dateStr).sort();
  const bad = t.filter(x => !x.dateValid);
  const geoOk = t.filter(x => x.geo).length;
  $('#cardSummary').innerHTML = `
    <div>총 <b>${fmt.num(t.length)}</b>건 · ${fmt.won(t.reduce((s, x) => s + x.amount, 0))} · 이용자 ${users.size}명</div>
    <div>기간 ${dates[0] || '-'} ~ ${dates[dates.length - 1] || '-'} · 좌표 변환 완료 ${fmt.num(geoOk)}건</div>
    ${bad.length ? `<div class="warn">존재하지 않는 이용일 ${bad.length}건: ${bad.slice(0, 5).map(x => esc(x.dateStr) + '(순번 ' + x.seq + ')').join(', ')}${bad.length > 5 ? ' …' : ''}</div>` : ''}`;
}

// 집주소 테이블
function renderHomes() {
  const tb = $('#homeTable tbody');
  tb.innerHTML = State.homes.map((h, i) => `
    <tr data-i="${i}">
      <td><input data-f="user" value="${esc(h.user)}"></td>
      <td><input data-f="card4" value="${esc(h.card4)}" maxlength="4" placeholder="선택"></td>
      <td><input data-f="address" value="${esc(h.address)}" placeholder="예: 서울 송파구 올림픽로 300"></td>
      <td>${h.lat != null ? `<span class="chip ok" title="${esc(h.matched)}">${esc(h.level)}</span>` : h.geoFail ? '<span class="chip err">실패</span>' : '<span class="chip">미변환</span>'}</td>
      <td><button class="link" data-del="${i}">삭제</button></td>
    </tr>`).join('') || '<tr><td colspan="5" class="hint">등록된 집주소가 없습니다.</td></tr>';
}
$('#homeTable').addEventListener('change', e => {
  const f = e.target.dataset.f;
  if (!f) return;
  const h = State.homes[+e.target.closest('tr').dataset.i];
  h[f] = f === 'card4' ? e.target.value.replace(/\D/g, '').slice(-4) : normAddr(e.target.value);
  if (f === 'address') { delete h.lat; delete h.lng; delete h.geoFail; delete h.level; }
  saveHomes(); renderHomes(); refresh();
});
$('#homeTable').addEventListener('click', e => {
  if (e.target.dataset.del == null) return;
  State.homes.splice(+e.target.dataset.del, 1);
  saveHomes(); renderHomes(); refresh();
});
$('#addHome').addEventListener('click', () => {
  State.homes.push({ user: '', card4: '', address: '' });
  renderHomes();
});
$('#fillHomeNames').addEventListener('click', () => {
  const have = new Set(State.homes.map(h => h.user));
  const users = [...new Set(State.txs.map(t => t.user))].filter(u => u && !have.has(u));
  users.forEach(u => State.homes.push({ user: u, card4: '', address: '' }));
  saveHomes(); renderHomes();
  if (!users.length) alert('추가할 새 이용자명이 없습니다.');
});
$('#homeFile').addEventListener('change', async e => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try {
    const list = await parseHomeFile(f);
    list.forEach(n => {
      const ex = State.homes.find(h => h.user === n.user && h.card4 === n.card4);
      if (ex) { if (ex.address !== n.address) { Object.assign(ex, n); delete ex.lat; delete ex.lng; delete ex.geoFail; } }
      else State.homes.push(n);
    });
    saveHomes(); renderHomes(); refresh();
    alert(`집주소 ${list.length}건을 불러왔습니다.`);
  } catch (err) { alert(err.message); }
});
$('#homeTemplate').addEventListener('click', () => {
  const users = [...new Set(State.txs.map(t => t.user))];
  const aoa = [['이용자명', '카드끝4자리', '집주소'], ...(users.length ? users.map(u => [u, '', '']) : [['홍길동', '', '서울 송파구 올림픽로 300']])];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), '집주소');
  XLSX.writeFile(wb, '직원_집주소_양식.xlsx');
});

// 좌표 변환
$('#runGeocode').addEventListener('click', async () => {
  if (!Kakao.ready) { alert('먼저 설정 탭에서 카카오 JavaScript 키를 저장·연결하세요.'); showTab('settings'); return; }
  const btn = $('#runGeocode');
  btn.disabled = true;
  Analysis.invalidate();
  const homes = State.homes.filter(h => h.user && h.address);
  // 분석 제외 거래(온라인/취소)는 변환하지 않음
  const txTargets = State.txs.filter(t => !Analysis.evaluate(t, []).excluded && (t.address || t.merchant));
  const total = homes.length + txTargets.length;
  let done = 0;
  const fails = [];
  const tick = () => {
    done++;
    $('#geoBar').style.width = (done / total * 100) + '%';
    $('#geoProgress').textContent = `${done} / ${total}`;
  };
  try {
    for (const h of homes) {
      const g = await Kakao.geocode(h.address);
      if (g) { Object.assign(h, { lat: g.lat, lng: g.lng, level: g.level, matched: g.matched }); delete h.geoFail; }
      else { h.geoFail = true; delete h.lat; delete h.lng; fails.push(`[집] ${h.user}: ${h.address}`); }
      tick();
    }
    // 동시 4건씩 처리
    let idx = 0;
    const worker = async () => {
      while (idx < txTargets.length) {
        const t = txTargets[idx++];
        const g = await Kakao.geocode(t.address, t.merchant);
        if (g) { t.geo = { lat: g.lat, lng: g.lng, level: g.level, matched: g.matched }; delete t.geoFail; }
        else { delete t.geo; t.geoFail = true; fails.push(`[가맹점] ${t.merchant}: ${t.address || '(주소 없음)'}`); }
        tick();
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    $('#geoProgress').textContent = `완료: ${total - fails.length} / ${total} 변환 성공`;
  } catch (err) {
    alert(err.message);
    $('#geoProgress').textContent = '중단됨: ' + err.message;
  }
  saveHomes(); saveTxs();
  const uniqFails = [...new Set(fails)];
  $('#geoFailures').innerHTML = uniqFails.length
    ? `<div class="warn">변환 실패 ${uniqFails.length}건 (주소를 확인하세요)</div><div class="hint">${uniqFails.slice(0, 30).map(esc).join('<br>')}${uniqFails.length > 30 ? '<br>…' : ''}</div>` : '';
  btn.disabled = false;
  renderHomes(); refresh();
});

/* ---------- 공통 필터 ---------- */
function initDateRange(reset) {
  const dates = State.txs.filter(t => t.dateValid).map(t => t.dateStr).sort();
  if (reset || !State.from) { State.from = dates[0] || ''; State.to = dates[dates.length - 1] || ''; }
  $('#fFrom').value = State.from; $('#fTo').value = State.to;
}
function initRadiusSelect() {
  const opts = [...new Set([...RADIUS_OPTIONS, +S.radius])].sort((a, b) => a - b);
  $('#fRadius').innerHTML = opts.map(r => `<option value="${r}" ${r === +S.radius ? 'selected' : ''}>${r >= 1000 ? r / 1000 + 'km' : r + 'm'}</option>`).join('');
}
$('#fFrom').addEventListener('change', e => { State.from = e.target.value; refresh(); });
$('#fTo').addEventListener('change', e => { State.to = e.target.value; refresh(); });
$('#fRadius').addEventListener('change', e => {
  S.radius = +e.target.value; Analysis.saveSettings(); $('#sRadius').value = S.radius; refresh();
});

/* ---------- 2. 대시보드 ---------- */
function aggregateByEmp(rows) {
  const m = new Map();
  rows.forEach(r => {
    if (!m.has(r.user)) m.set(r.user, {
      name: r.user, cnt: 0, amt: 0, offAmt: 0, nearCnt: 0, nearAmt: 0, holCnt: 0, holAmt: 0, nightCnt: 0, nightAmt: 0,
      flagCnt: 0, flagAmt: 0, hasHome: !!(r.home && r.home.lat != null),
    });
    const e = m.get(r.user);
    if (r.cancelled) return;
    e.cnt++; e.amt += r.amount;
    if (!r.excluded) e.offAmt += r.amount;
    if (r.near) { e.nearCnt++; e.nearAmt += r.amount; }
    if (r.holidayUse) { e.holCnt++; e.holAmt += r.amount; }
    if (r.nightUse) { e.nightCnt++; e.nightAmt += r.amount; }
    if (r.flag) { e.flagCnt++; e.flagAmt += r.amount; }
  });
  // 집근처 비중은 위치 분석이 가능한 오프라인 사용금액 대비
  return [...m.values()].map(e => ({ ...e, nearRatio: e.offAmt ? e.nearAmt / e.offAmt : 0 }));
}

function renderDashboard() {
  const rows = State.rows;
  const valid = rows.filter(r => !r.cancelled);
  const act = rows.filter(r => !r.excluded);
  const sum = a => a.reduce((s, r) => s + r.amount, 0);
  const near = act.filter(r => r.near), flag = act.filter(r => r.flag);
  const hol = valid.filter(r => r.holidayUse), night = valid.filter(r => r.nightUse);
  const geoTargets = act.filter(r => r.address || r.merchant);
  const geoOk = geoTargets.filter(r => r.geo).length;
  const emps = aggregateByEmp(rows);
  const noHome = emps.filter(e => !e.hasHome).map(e => e.name);
  $('#dashNote').textContent = `반경 ${fmt.num(S.radius)}m · 심야 ${S.nightFrom}~${S.nightTo}`;

  $('#kpis').innerHTML = [
    ['전체 사용', `${fmt.num(valid.length)}건`, `${fmt.won(sum(valid))} · 온라인/PG ${valid.length - act.length}건 · 취소 ${rows.length - valid.length}건`],
    ['① 집근처 사용', `${fmt.num(near.length)}건`, `${fmt.won(sum(near))} · 오프라인 대비 ${fmt.pct(sum(near) / sum(act))}`],
    ['② 휴일 사용', `${fmt.num(hol.length)}건`, `${fmt.won(sum(hol))} · 전체 대비 ${fmt.pct(sum(hol) / sum(valid))}`],
    ['③ 심야 사용', `${fmt.num(night.length)}건`, `${fmt.won(sum(night))} · 전체 대비 ${fmt.pct(sum(night) / sum(valid))}`],
    ['점검대상(복합)', `${fmt.num(flag.length)}건`, `${fmt.won(sum(flag))} · 집근처 + 휴일/심야/주의업종`],
    ['주소 좌표 변환', fmt.pct(geoOk / geoTargets.length), `${fmt.num(geoOk)} / ${fmt.num(geoTargets.length)}건`],
    ['집주소 미등록·미변환', `${noHome.length}명`, noHome.slice(0, 4).map(esc).join(', ') + (noHome.length > 4 ? ' …' : '')],
  ].map(([l, v, s]) => `<div class="kpi"><div class="label">${l}</div><div class="value">${v}</div><div class="sub">${s}</div></div>`).join('');

  const sorted = sortBy(emps, State.empSort.k, State.empSort.dir);
  const cntCell = (n, cls) => `<td class="num">${n ? `<span class="chip ${cls}">${n}</span>` : 0}</td>`;
  $('#empTable tbody').innerHTML = sorted.map(e => `
    <tr>
      <td>${esc(e.name)} ${e.hasHome ? '' : '<span class="chip err">집주소 없음</span>'}</td>
      <td class="num">${fmt.num(e.cnt)}</td><td class="num">${fmt.won(e.amt)}</td>
      ${cntCell(e.nearCnt, 'near')}<td class="num">${fmt.won(e.nearAmt)}</td><td class="num">${fmt.pct(e.nearRatio)}</td>
      ${cntCell(e.holCnt, 'hol')}<td class="num">${fmt.won(e.holAmt)}</td>
      ${cntCell(e.nightCnt, 'night')}<td class="num">${fmt.won(e.nightAmt)}</td>
      ${cntCell(e.flagCnt, 'flag')}<td class="num">${fmt.won(e.flagAmt)}</td>
      <td style="white-space:nowrap"><button class="link" data-map="${esc(e.name)}">지도</button><button class="link" data-list="${esc(e.name)}">내역</button></td>
    </tr>`).join('') || '<tr><td colspan="13" class="hint">데이터가 없습니다.</td></tr>';

  // 요일별 금액 (평일 공휴일은 별도 행)
  const dowNames = ['월', '화', '수', '목', '금', '토', '일'];
  const dowIdx = r => r.holiday === '공휴일' ? 7 : (r.dow + 6) % 7;
  const dated = valid.filter(r => r.dateValid);
  renderBars('#dowChart', [...dowNames, '공휴일(평일)'].map((l, i) => {
    const g = dated.filter(r => dowIdx(r) === i);
    return { label: l, value: sum(g), hl: i >= 5, tip: `${l}: ${fmt.num(g.length)}건 · ${fmt.won(sum(g))}` };
  }), '데이터가 없습니다.');

  // 시간대별 금액
  $('#hourNote').innerHTML = `· <i class="sw hl"></i>심야 ${esc(S.nightFrom)}~${esc(S.nightTo)}`;
  const hours = Array.from({ length: 24 }, (_, h) => {
    const g = valid.filter(r => +String(r.time).slice(0, 2) === h && /^\d{2}:/.test(r.time));
    const label = String(h).padStart(2, '0') + '시';
    return { label, value: sum(g), hl: Analysis.inNight(label.slice(0, 2) + ':00'), tip: `${label}대: ${fmt.num(g.length)}건 · ${fmt.won(sum(g))}` };
  });
  renderColumns('#hourChart', hours);

  // 거리 구간별 금액
  const buckets = [[0, 500, '500m 이내'], [500, 1000, '0.5~1km'], [1000, 2000, '1~2km'], [2000, 5000, '2~5km'], [5000, 10000, '5~10km'], [10000, Infinity, '10km 이상']];
  const withDist = act.filter(r => r.dist != null);
  renderBars('#distChart', buckets.map(([a, b, l]) => {
    const g = withDist.filter(r => r.dist >= a && r.dist < b);
    return { label: l, value: sum(g), tip: `${l}: ${fmt.num(g.length)}건 · ${fmt.won(sum(g))}` };
  }), '거리를 계산한 거래가 없습니다. 좌표 변환을 먼저 실행하세요.');

  const cat = new Map();
  near.forEach(r => {
    const k = r.category || '(업종 없음)';
    const c = cat.get(k) || { value: 0, n: 0 };
    c.value += r.amount; c.n++; cat.set(k, c);
  });
  renderBars('#catChart', [...cat.entries()].sort((a, b) => b[1].value - a[1].value).slice(0, 10)
    .map(([k, c]) => ({ label: k, value: c.value, tip: `${esc(k)}: ${c.n}건 · ${fmt.won(c.value)}` })), '집근처 사용 내역이 없습니다.');
}

function renderBars(sel, data, empty) {
  const el = $(sel);
  const max = Math.max(...data.map(d => d.value), 0);
  if (!max) { el.innerHTML = `<div class="hint">${empty}</div>`; return; }
  el.innerHTML = data.map(d => `
    <div class="bar-row" data-tip="${esc(d.tip)}">
      <div class="lbl" title="${esc(d.label)}">${esc(d.label)}</div>
      <div class="track"><div class="fill${d.hl ? ' hl' : ''}" style="width:${d.value / max * 100}%"></div></div>
      <div class="val">${fmt.won(d.value)}</div>
    </div>`).join('');
}

// 세로 막대 (시간대별)
function renderColumns(sel, data) {
  const el = $(sel);
  const max = Math.max(...data.map(d => d.value), 0);
  if (!max) { el.innerHTML = '<div class="hint">데이터가 없습니다.</div>'; return; }
  el.innerHTML = data.map((d, i) => `
    <div class="col" data-tip="${esc(d.tip)}">
      <div class="col-track"><div class="fill${d.hl ? ' hl' : ''}" style="height:${d.value / max * 100}%"></div></div>
      <div class="col-lbl">${i % 3 === 0 ? i : ''}</div>
    </div>`).join('');
}

// 점검사유 칩 색상
function reasonChip(r, x) {
  const cls = x.startsWith('집근처') ? (r.flag ? 'flag' : 'near')
    : /토요일|일요일|공휴일/.test(x) ? 'hol' : x === '심야' ? 'night' : x === '날짜오류' ? 'err' : r.flag ? 'flag' : '';
  return `<span class="chip ${cls}">${esc(x)}</span>`;
}
document.addEventListener('mousemove', e => {
  const row = e.target.closest && e.target.closest('[data-tip]');
  if (row) Tip.show(row.dataset.tip, e); else Tip.hide();
});

makeSortable($('#empTable'), (k, dir) => { State.empSort = { k, dir }; renderDashboard(); });
$('#empTable').addEventListener('click', e => {
  const m = e.target.dataset.map, l = e.target.dataset.list;
  if (m) { $('#mEmp').value = m; State.mapEmp = m; showTab('map'); }
  if (l) { State.listEmp = l; showTab('list'); }
});

/* ---------- 3. 지도 ---------- */
let map = null, overlays = [], infoWin = null;

function fillEmpSelect(sel, current, withHomeOnly) {
  const users = [...new Set(State.txs.map(t => t.user))].filter(u => !withHomeOnly || State.homes.some(h => h.user === u && h.lat != null));
  sel.innerHTML = `<option value="">전체</option>` + users.map(u => `<option ${u === current ? 'selected' : ''}>${esc(u)}</option>`).join('');
  if (current && !users.includes(current)) sel.value = '';
}

function clearOverlays() {
  overlays.forEach(o => o.setMap(null));
  overlays = [];
  if (infoWin) infoWin.close();
}

function renderMap() {
  fillEmpSelect($('#mEmp'), State.mapEmp, false);
  const emp = $('#mEmp').value;
  const show = $('#mShow').value;
  let rows = State.rows.filter(r => !r.excluded && r.geo && (!emp || r.user === emp));
  if (show === 'near') rows = rows.filter(r => r.near);
  if (show === 'holiday') rows = rows.filter(r => r.holidayUse);
  if (show === 'night') rows = rows.filter(r => r.nightUse);
  if (show === 'flag') rows = rows.filter(r => r.flag);

  // 가맹점 좌표별 그룹
  const groups = new Map();
  rows.forEach(r => {
    const k = r.geo.lat.toFixed(5) + ',' + r.geo.lng.toFixed(5);
    if (!groups.has(k)) groups.set(k, { geo: r.geo, items: [] });
    groups.get(k).items.push(r);
  });
  const gl = [...groups.values()].map(g => {
    g.status = g.items.some(r => r.flag) ? 'flag' : g.items.some(r => r.near) ? 'near' : 'far';
    g.amount = g.items.reduce((s, r) => s + r.amount, 0);
    g.minDist = Math.min(...g.items.map(r => r.dist == null ? Infinity : r.dist));
    return g;
  }).sort((a, b) => ({ flag: 0, near: 1, far: 2 }[a.status] - { flag: 0, near: 1, far: 2 }[b.status]) || a.minDist - b.minDist);

  // 사이드 목록
  $('#mSideTitle').textContent = `가맹점 ${gl.length}곳 · 거래 ${rows.length}건`;
  $('#mSideList').innerHTML = gl.map((g, i) => {
    const r0 = g.items[0];
    return `<div class="mitem" data-g="${i}">
      <div class="t"><i class="dot ${g.status}" style="margin:0 4px 0 0"></i>${esc(r0.merchant)}</div>
      <div>${esc(r0.category)} · ${g.items.length}건 · ${fmt.won(g.amount)} · ${isFinite(g.minDist) ? fmt.km(g.minDist) + 'km' : '집 미등록'}</div>
      <div>${[...new Set(g.items.flatMap(r => r.reasons.filter(x => !x.startsWith('집근처'))))].map(x => reasonChip({ flag: g.status === 'flag' }, x)).join('')}</div>
    </div>`;
  }).join('') || '<div class="hint">표시할 거래가 없습니다. 좌표 변환을 실행했는지 확인하세요.</div>';

  if (!Kakao.ready) return;
  const container = $('#map');
  if (!map) {
    container.innerHTML = '';
    map = new kakao.maps.Map(container, { center: new kakao.maps.LatLng(37.5665, 126.978), level: 7 });
    map.addControl(new kakao.maps.ZoomControl(), kakao.maps.ControlPosition.RIGHT);
  }
  map.relayout();
  clearOverlays();
  const bounds = new kakao.maps.LatLngBounds();
  let hasPoint = false;

  const homes = State.homes.filter(h => h.lat != null && (!emp || h.user === emp));
  homes.forEach(h => {
    const pos = new kakao.maps.LatLng(h.lat, h.lng);
    overlays.push(new kakao.maps.Circle({
      map, center: pos, radius: +S.radius, strokeWeight: 2, strokeColor: '#1f9d55', strokeOpacity: 0.8,
      strokeStyle: 'dash', fillColor: '#1f9d55', fillOpacity: 0.07,
    }));
    const el = document.createElement('div');
    el.className = 'mk-home';
    el.textContent = '🏠 ' + h.user;
    overlays.push(new kakao.maps.CustomOverlay({ map, position: pos, content: el, yAnchor: 1.3, zIndex: 5 }));
    bounds.extend(pos); hasPoint = true;
  });

  gl.forEach((g, i) => {
    const pos = new kakao.maps.LatLng(g.geo.lat, g.geo.lng);
    const el = document.createElement('div');
    el.className = 'mk ' + g.status;
    el.addEventListener('click', () => openGroup(gl, i));
    el.addEventListener('mousemove', e => Tip.show(`${esc(g.items[0].merchant)} · ${g.items.length}건 · ${fmt.won(g.amount)}`, e));
    el.addEventListener('mouseleave', Tip.hide);
    overlays.push(new kakao.maps.CustomOverlay({ map, position: pos, content: el, yAnchor: 0.5, zIndex: g.status === 'flag' ? 4 : g.status === 'near' ? 3 : 2 }));
    bounds.extend(pos); hasPoint = true;
  });
  State._groups = gl;
  if (hasPoint) map.setBounds(bounds);
}

function openGroup(gl, i) {
  const g = gl[i];
  const pos = new kakao.maps.LatLng(g.geo.lat, g.geo.lng);
  if (infoWin) infoWin.close();
  infoWin = new kakao.maps.InfoWindow({
    position: pos, removable: true,
    content: `<div class="iw"><b>${esc(g.items[0].merchant)}</b><br>${esc(g.items[0].address)}<br>
      <span style="color:#7d8799">좌표: ${esc(g.geo.level)} · ${esc(g.geo.matched)}</span><hr style="border:0;border-top:1px solid #e2e6ee">
      ${g.items.map(r => `${esc(r.dateStr)} ${esc(r.time)} · ${esc(r.user)} · <b>${fmt.won(r.amount)}</b><br>
        <span style="color:#7d8799">${esc(r.reasonsText || (r.dist != null ? '집에서 ' + fmt.km(r.dist) + 'km' : ''))}</span>`).join('<br>')}</div>`,
  });
  infoWin.open(map);
  map.panTo(pos);
}

$('#mEmp').addEventListener('change', e => { State.mapEmp = e.target.value; renderMap(); });
$('#mShow').addEventListener('change', renderMap);
$('#mSideList').addEventListener('click', e => {
  const it = e.target.closest('.mitem');
  if (it && map && State._groups) openGroup(State._groups, +it.dataset.g);
});

/* ---------- 4. 거래 내역 ---------- */
function filteredList() {
  const emp = $('#lEmp').value, f = $('#lFilter').value, q = $('#lSearch').value.trim();
  let rows = State.rows.filter(r => !emp || r.user === emp);
  const test = {
    near: r => r.near, flag: r => r.flag, holiday: r => r.holidayUse, night: r => r.nightUse,
    excluded: r => !!r.excluded, fail: r => !r.excluded && !r.geo,
  }[f];
  if (test) rows = rows.filter(test);
  if (q) rows = rows.filter(r => (r.merchant + r.address + r.category).includes(q));
  return sortBy(rows, State.txSort.k, State.txSort.dir);
}

function renderList() {
  fillEmpSelect($('#lEmp'), State.listEmp, false);
  const rows = filteredList();
  $('#listCount').textContent = `${fmt.num(rows.length)}건 · ${fmt.won(rows.reduce((s, r) => s + r.amount, 0))}`;
  const shown = rows.slice(0, 2000);
  $('#txTable tbody').innerHTML = shown.map(r => `
    <tr>
      <td class="num">${r.seq}</td><td>${esc(r.user)}</td><td>${esc(r.dateStr)}${r.dateValid ? '' : ' <span class="chip err">날짜오류</span>'}</td><td>${esc(r.time)}</td>
      <td>${esc(r.merchant)}</td><td>${esc(r.category)}</td><td class="num">${fmt.num(r.amount)}</td>
      <td>${esc(r.address)}</td><td class="num">${r.dist != null ? fmt.km(r.dist) : '-'}</td>
      <td>${r.excluded ? `<span class="chip">${esc(r.excluded)}</span>` : ''}${r.reasons.filter(x => x !== '날짜오류').map(x => reasonChip(r, x)).join('')}
        ${!r.excluded && !r.geo ? '<span class="chip err">주소 변환 실패</span>' : ''}</td>
      <td>${r.geo ? `<button class="link" data-loc="${r.seq}|${esc(r.user)}">지도</button>` : ''}</td>
    </tr>`).join('') + (rows.length > shown.length ? `<tr><td colspan="11" class="hint">상위 2,000건만 표시합니다. 전체는 엑셀로 내보내세요.</td></tr>` : '');
}
['#lEmp', '#lFilter'].forEach(s => $(s).addEventListener('change', () => { State.listEmp = $('#lEmp').value; renderList(); }));
$('#lSearch').addEventListener('input', renderList);
makeSortable($('#txTable'), (k, dir) => { State.txSort = { k: k === 'dist' ? 'dist' : k, dir }; renderList(); });
$('#txTable').addEventListener('click', e => {
  const v = e.target.dataset.loc;
  if (!v) return;
  const [seq, user] = v.split('|');
  State.mapEmp = user; $('#mShow').value = 'all';
  showTab('map');
  const i = (State._groups || []).findIndex(g => g.items.some(r => String(r.seq) === seq && r.user === user));
  if (i >= 0 && map) openGroup(State._groups, i);
});

$('#exportXlsx').addEventListener('click', () => {
  const rows = filteredList();
  const head = ['순번', '카드번호', '이용자명', '이용일', '가맹점명', '이용금액', '가맹점 주소', '사업자 등록번호', '승인번호', '과세유형', '전표구분',
    '미화금액', '미화환율', '승인시간', '가맹점업종코드', '가맹점업종명', '유종', '리터당단가',
    '집주소', '집까지 거리(km)', '해당 시나리오', '①집근처', '②휴일', '③심야', '주의업종', '점검대상(복합)', '점검사유', '분석제외사유', '좌표변환결과'];
  const aoa = [head, ...rows.map(r => [r.seq, r.card, r.user, r.dateStr, r.merchant, r.amount, r.address, r.bizNo, r.approvalNo, r.taxType, r.slipType,
    r.usd, r.fxRate, r.time, r.catCode, r.category, r.fuel, r.literPrice,
    r.home ? r.home.address : '', r.dist != null ? +fmt.km(r.dist) : '', r.scenarios.join(', '),
    r.near ? 'Y' : '', r.holidayUse ? r.holiday : '', r.nightUse ? 'Y' : '', r.excluded ? '' : r.risk, r.flag ? 'Y' : '',
    r.reasonsText, r.excluded, r.geo ? `${r.geo.level}: ${r.geo.matched}` : (r.excluded ? '' : '실패')])];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = head.map((h, i) => ({ wch: [4, 6, 18, 24].includes(i) ? 30 : 12 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '집근처분석');
  XLSX.writeFile(wb, `법인카드_집근처분석_${S.radius}m_${new Date().toISOString().slice(0, 10)}.xlsx`);
});

/* ---------- 설정 ---------- */
function loadSettingsForm() {
  $('#sKey').value = S.kakaoKey;
  $('#sRadius').value = S.radius;
  $('#sNightFrom').value = S.nightFrom;
  $('#sNightTo').value = S.nightTo;
  $('#sRiskCats').value = S.riskCats;
  $('#sExclude').value = S.exclude;
  $('#sHolidays').value = S.holidays;
  $('#originHint').textContent = location.origin;
  $('#cacheInfo').textContent = `캐시된 주소 ${Object.keys(Kakao.cache).length}건`;
}

async function connectKakao() {
  const st = $('#kakaoStatus');
  if (!S.kakaoKey) { st.textContent = '카카오 지도: 키 미입력'; st.className = 'status'; return; }
  st.textContent = '카카오 지도: 연결 중…'; st.className = 'status';
  try {
    await Kakao.load(S.kakaoKey);
    const test = await Kakao._addressSearch('서울 중구 세종대로 110');
    if (test && test.error) throw new Error('API 호출 거부 (도메인 등록/카카오맵 사용설정 확인)');
    st.textContent = '카카오 지도: 연결됨'; st.className = 'status ok';
    if (currentTab === 'map') renderMap();
  } catch (err) {
    st.textContent = '카카오 지도: ' + err.message; st.className = 'status err';
  }
}

$('#saveKey').addEventListener('click', () => {
  const key = $('#sKey').value.trim();
  const changed = key !== S.kakaoKey;
  S.kakaoKey = key; Analysis.saveSettings();
  // SDK는 페이지당 한 번만 로드 가능하므로 키 변경 시 새로고침
  if (changed && Kakao.ready) location.reload(); else connectKakao();
});
$('#clearGeoCache').addEventListener('click', () => {
  if (!confirm('저장된 주소 좌표 캐시를 비웁니다. 다음 분석 시 다시 변환합니다.')) return;
  Kakao.clearCache(); loadSettingsForm();
});
$('#saveSettings').addEventListener('click', () => {
  S.radius = Math.max(50, +$('#sRadius').value || 1000);
  S.nightFrom = $('#sNightFrom').value || '22:00';
  S.nightTo = $('#sNightTo').value || '06:00';
  S.riskCats = $('#sRiskCats').value;
  S.exclude = $('#sExclude').value;
  S.holidays = $('#sHolidays').value;
  Analysis.saveSettings();
  initRadiusSelect(); refresh();
  alert('저장했습니다. 분석 결과에 반영되었습니다.');
});

/* ---------- 시작 ---------- */
loadSettingsForm();
initRadiusSelect();
initDateRange(true);
renderHomes();
refresh();
connectKakao();
