// AI 보고서: 이상징후 요약 / 경영진 보고서 (Gemini)
const DOW_KO = ['일', '월', '화', '수', '목', '금', '토'];

const SYSTEM_PROMPT = `당신은 기업 내부감사 및 경비 관리 전문가입니다. 법인카드 사용내역 이상징후 분석 결과(JSON)를 해석해 문서를 작성합니다.
규칙:
- 제공된 데이터에 있는 수치만 사용하고, 없는 수치를 추정하거나 만들어내지 마세요. 금액은 원 단위 천 단위 구분기호로 표기하세요.
- 특정 직원을 부정사용자로 단정하지 말고 "소명 필요", "추가 확인 필요" 등 중립적 표현을 사용하세요.
- 직원 식별자(예: 직원01)는 데이터에 표기된 그대로 사용하세요.
- 탐지 기준의 한계(예: 집근처 사용이 업무상 정당할 수 있음, 온라인 결제는 위치 판단 불가)를 필요한 곳에 짧게 언급하세요.
- 한국어, 마크다운 형식(제목 #, 표, 불릿)으로 작성하세요. 코드블록으로 감싸지 마세요.`;

const PROMPTS = {
  summary: () => `아래 데이터를 바탕으로 감사 담당자가 바로 활용할 "이상징후 탐지 결과 요약"을 작성하세요.
구성:
# 법인카드 이상징후 탐지 결과 요약
## 핵심 요약 (3~5개 불릿)
## 시나리오별 탐지 결과 (① 집근처 ② 휴일 ③ 심야 ④ 점검대상(복합) — 건수·금액·특징을 표로)
## 직원별 위험도 (상/중/하 등급과 근거, 표)
## 주요 패턴 (반복 이용 가맹점, 요일·시간대, 업종 쏠림)
## 우선 확인 대상 거래 (최대 10건, 표: 직원/일시/가맹점/업종/금액/사유)
## 권고 조치
분량은 A4 1~2쪽.`,

  exec: (org, today) => `아래 데이터를 바탕으로 경영진 보고용 공식 보고서를 작성하세요.
문체는 개조식(~함, ~임)으로, 경영진이 2분 안에 핵심을 파악할 수 있게 간결하게 쓰고 개별 거래 나열은 대표 사례 3건 이내로 제한하세요.
구성:
# ${org ? org + ' ' : ''}법인카드 사용 실태 점검 결과 보고
보고일: ${today}
## 1. 보고 개요 (목적 / 점검 기간 / 점검 대상 / 점검 기준)
## 2. 종합 의견 (3줄 이내)
## 3. 점검 결과
### 3-1. 전체 사용 현황
### 3-2. 시나리오별 결과 (표)
### 3-3. 대표 사례
## 4. 시사점
## 5. 개선 권고 및 향후 조치 (조치 항목 / 담당 / 시한 제안을 표로)`,
};

const Report = window.Report = {
  abort: null,
  emp: '',
  alias: {}, unalias: {},

  onShow() { fillEmpSelect($('#rEmp'), this.emp, false); },

  rows() {
    return State.rows.filter(r => !this.emp || r.user === this.emp);
  },

  makeAlias(rows, mask) {
    this.alias = {}; this.unalias = {};
    [...new Set(rows.map(r => r.user))].sort((a, b) => a.localeCompare(b, 'ko')).forEach((u, i) => {
      const a = mask ? '직원' + String(i + 1).padStart(2, '0') : u;
      this.alias[u] = a; this.unalias[a] = u;
    });
  },
  unmask(text) {
    if (!$('#rMask').checked) return text;
    return text.replace(/직원(\d{2,3})(?![\d명])/g, m => this.unalias[m] || m);
  },

  // 우선순위: 점검대상 > 집근처 > 휴일/심야, 같은 순위는 금액순
  priorityRows(rows) {
    const score = r => (r.flag ? 8 : 0) + (r.near ? 4 : 0) + (r.holidayUse ? 2 : 0) + (r.nightUse ? 2 : 0) + (r.risk && !r.excluded ? 1 : 0);
    return rows.filter(r => !r.cancelled && score(r) > 0)
      .map(r => ({ r, s: score(r) }))
      .sort((a, b) => b.s - a.s || b.r.amount - a.r.amount)
      .map(x => x.r);
  },

  buildData(rows) {
    const valid = rows.filter(r => !r.cancelled);
    const act = rows.filter(r => !r.excluded);
    const sum = a => a.reduce((s, r) => s + r.amount, 0);
    const stat = (a, base) => ({ 건수: a.length, 금액: sum(a), 비중: base ? fmt.pct(sum(a) / sum(base)) : undefined });
    const near = act.filter(r => r.near);
    const dates = rows.filter(r => r.dateValid).map(r => r.dateStr).sort();
    const A = u => this.alias[u];

    const repeat = new Map();
    near.forEach(r => {
      const k = A(r.user) + '|' + r.merchant;
      const g = repeat.get(k) || { 직원: A(r.user), 가맹점: r.merchant, 업종: r.category, 횟수: 0, 금액: 0, 집거리km: +fmt.km(r.dist) };
      g.횟수++; g.금액 += r.amount; repeat.set(k, g);
    });

    const hourly = {};
    valid.forEach(r => { const h = String(r.time).slice(0, 2); if (/^\d{2}$/.test(h)) hourly[h + '시'] = (hourly[h + '시'] || 0) + r.amount; });
    const dowAmt = {};
    valid.filter(r => r.dateValid).forEach(r => {
      const k = r.holiday === '공휴일' ? '공휴일(평일)' : DOW_KO[r.dow];
      dowAmt[k] = (dowAmt[k] || 0) + r.amount;
    });

    return {
      점검기간: `${State.from || dates[0] || ''} ~ ${State.to || dates[dates.length - 1] || ''}`,
      점검대상: this.emp ? A(this.emp) : `전체 ${new Set(rows.map(r => r.user)).size}명`,
      탐지기준: {
        '① 집근처 사용': `직원 집 반경 ${S.radius}m 이내 오프라인 가맹점 사용 (온라인·PG 결제는 위치 판단 불가로 제외)`,
        '② 휴일 사용': '토·일·공휴일 사용 (온라인 포함)',
        '③ 심야 사용': `${S.nightFrom}~${S.nightTo} 승인 (온라인 포함)`,
        '점검대상(복합)': `①이면서 휴일·심야·주의업종(${S.riskCats}) 중 하나 이상`,
      },
      전체현황: {
        전체: stat(valid), '온라인/PG(위치분석 제외)': stat(valid.filter(r => r.excluded)), 취소전표: rows.length - valid.length,
        '① 집근처 사용': { ...stat(near), 비중: fmt.pct(sum(near) / sum(act)) + ' (오프라인 대비)' },
        '② 휴일 사용': stat(valid.filter(r => r.holidayUse), valid),
        '③ 심야 사용': stat(valid.filter(r => r.nightUse), valid),
        '점검대상(복합)': stat(act.filter(r => r.flag), valid),
        주소좌표변환성공: `${act.filter(r => r.geo).length}/${act.length}`,
        날짜오류건: rows.filter(r => !r.dateValid).length,
      },
      직원별: aggregateByEmp(rows).map(e => ({
        직원: A(e.name), 집주소등록: e.hasHome ? 'Y' : 'N(집근처 판정 불가)', 총건수: e.cnt, 총금액: e.amt,
        집근처건수: e.nearCnt, 집근처금액: e.nearAmt, 집근처비중: fmt.pct(e.nearRatio),
        휴일건수: e.holCnt, 휴일금액: e.holAmt, 심야건수: e.nightCnt, 심야금액: e.nightAmt,
        점검대상건수: e.flagCnt, 점검대상금액: e.flagAmt,
      })),
      요일별금액: dowAmt,
      시간대별금액: hourly,
      집근처반복이용가맹점: [...repeat.values()].filter(g => g.횟수 >= 2).sort((a, b) => b.금액 - a.금액).slice(0, 15),
      주요의심거래: this.priorityRows(rows).slice(0, 60).map(r => ({
        직원: A(r.user), 일자: r.dateStr, 요일: r.dateValid ? DOW_KO[r.dow] : '날짜오류', 시각: r.time,
        가맹점: r.merchant, 업종: r.category, 금액: r.amount,
        집거리km: r.dist != null ? +fmt.km(r.dist) : null, 사유: r.reasonsText, 비고: r.excluded || undefined,
      })),
    };
  },

  // 부록: 시스템 산출 수치 (AI와 무관, 실명 표기)
  appendix(rows) {
    const valid = rows.filter(r => !r.cancelled), act = rows.filter(r => !r.excluded);
    const sum = a => a.reduce((s, r) => s + r.amount, 0);
    const line = (l, a) => `<tr><td>${l}</td><td class="num">${fmt.num(a.length)}</td><td class="num">${fmt.won(sum(a))}</td></tr>`;
    const emps = sortBy(aggregateByEmp(rows), 'flagAmt', 'desc');
    const top = this.priorityRows(rows).slice(0, 20);
    return `<section class="appendix">
      <h2>부록. 분석 수치 (시스템 산출)</h2>
      <p class="hint">기간 ${esc(State.from)} ~ ${esc(State.to)} · 반경 ${fmt.num(S.radius)}m · 심야 ${esc(S.nightFrom)}~${esc(S.nightTo)}</p>
      <h3>1. 시나리오별 현황</h3>
      <table class="rtbl"><thead><tr><th>구분</th><th>건수</th><th>금액</th></tr></thead><tbody>
        ${line('전체 사용(취소 제외)', valid)}${line('온라인/PG (위치분석 제외)', valid.filter(r => r.excluded))}
        ${line('① 집근처 사용', act.filter(r => r.near))}${line('② 휴일 사용', valid.filter(r => r.holidayUse))}
        ${line('③ 심야 사용', valid.filter(r => r.nightUse))}${line('점검대상(복합)', act.filter(r => r.flag))}
      </tbody></table>
      <h3>2. 직원별 현황</h3>
      <table class="rtbl"><thead><tr><th>직원</th><th>총 금액</th><th>집근처</th><th>휴일</th><th>심야</th><th>점검대상</th></tr></thead><tbody>
        ${emps.map(e => `<tr><td>${esc(e.name)}</td><td class="num">${fmt.won(e.amt)}</td>
          <td class="num">${e.nearCnt}건 · ${fmt.won(e.nearAmt)}</td><td class="num">${e.holCnt}건 · ${fmt.won(e.holAmt)}</td>
          <td class="num">${e.nightCnt}건 · ${fmt.won(e.nightAmt)}</td><td class="num">${e.flagCnt}건 · ${fmt.won(e.flagAmt)}</td></tr>`).join('')}
      </tbody></table>
      <h3>3. 우선 확인 대상 거래 (상위 ${top.length}건)</h3>
      <table class="rtbl"><thead><tr><th>직원</th><th>일시</th><th>가맹점</th><th>업종</th><th>금액</th><th>집거리</th><th>사유</th></tr></thead><tbody>
        ${top.map(r => `<tr><td>${esc(r.user)}</td><td>${esc(r.dateStr)} ${esc(r.time.slice(0, 5))}</td><td>${esc(r.merchant)}</td><td>${esc(r.category)}</td>
          <td class="num">${fmt.won(r.amount)}</td><td class="num">${r.dist != null ? fmt.km(r.dist) + 'km' : '-'}</td><td>${esc(r.reasonsText)}</td></tr>`).join('')}
      </tbody></table>
    </section>`;
  },

  render(md, appendixHtml) {
    $('#reportOut').innerHTML = DOMPurify.sanitize(marked.parse(md)) + appendixHtml;
  },

  async run(type) {
    if (!S.geminiKey || !S.geminiModel) { alert('설정 탭에서 Gemini API 키를 입력하고 "저장 및 연결 테스트"를 누르세요.'); showTab('settings'); return; }
    compute();
    const rows = this.rows();
    if (!rows.length) { alert('분석할 사용내역이 없습니다.'); return; }

    const mask = $('#rMask').checked;
    this.makeAlias(rows, mask);
    const data = this.buildData(rows);
    const appendixHtml = this.appendix(rows);
    const extra = $('#rExtra').value.trim();
    const today = new Date().toISOString().slice(0, 10);
    const prompt = (type === 'exec' ? PROMPTS.exec(S.orgName, today) : PROMPTS.summary())
      + (extra ? `\n\n추가 요청사항: ${extra}` : '')
      + `\n\n[분석 데이터]\n${JSON.stringify(data, null, 1)}`;

    this.setBusy(true);
    const t0 = Date.now();
    let note = '';
    const timer = setInterval(() => { $('#rStatus').textContent = `작성 중… ${Math.round((Date.now() - t0) / 1000)}초${note}`; }, 500);
    this.abort = new AbortController();
    $('#reportOut').innerHTML = '<div class="hint">Gemini가 작성 중입니다…</div>';
    $('#rHistoryPanel').hidden = true;
    const scope = { emp: this.emp || '전체', period: `${State.from} ~ ${State.to}`, radius: S.radius };
    let pending = false, latest = '', done = false;
    try {
      const text = await Gemini.generate({
        key: S.geminiKey, model: S.geminiModel, system: SYSTEM_PROMPT, prompt, signal: this.abort.signal,
        onRetry: n => { note = ` · 서버 혼잡으로 재시도 ${n}/3`; },
        onText: t => {
          latest = t;
          if (pending) return;
          pending = true;
          requestAnimationFrame(() => { pending = false; if (!done) this.render(this.unmask(latest), ''); });
        },
      });
      this.show(ReportHistory.add({ type, md: this.unmask(text), appendixHtml, model: S.geminiModel, ...scope }));
      $('#rStatus').textContent = `완료 (${Math.round((Date.now() - t0) / 1000)}초 · ${S.geminiModel}) · 저장된 보고서에 보관됨`;
    } catch (err) {
      if (err.name === 'AbortError') {
        $('#rStatus').textContent = '중지됨';
        if (latest) this.show(ReportHistory.add({ type, md: this.unmask(latest), appendixHtml, model: S.geminiModel, ...scope, partial: true }));
      } else {
        $('#rStatus').textContent = '';
        $('#reportOut').innerHTML = `<div class="summary"><span class="warn">${esc(err.message)}</span></div>`;
      }
    } finally {
      done = true;
      clearInterval(timer);
      this.setBusy(false);
    }
  },

  setBusy(b) {
    $('#rSummary').disabled = b; $('#rExec').disabled = b; $('#rHistoryBtn').disabled = b;
    $('#rStop').hidden = !b;
    $('#rToolbar').hidden = b || !this.last;
  },

  // 저장된 보고서 1건 표시
  show(entry) {
    this.last = entry;
    if (!entry) {
      $('#reportOut').innerHTML = '<div class="hint">버튼을 누르면 이곳에 결과가 표시됩니다.</div>';
      $('#rToolbar').hidden = true;
      return;
    }
    this.render(entry.md, entry.appendixHtml || '');
    $('#reportOut').insertAdjacentHTML('afterbegin', `<p class="hint no-print report-meta">${esc(ReportHistory.label(entry))}</p>`);
    $('#rToolbar').hidden = false;
    renderHistory();
  },

  title() {
    const at = this.last && this.last.id ? new Date(this.last.id) : new Date();
    const p = n => String(n).padStart(2, '0');
    return (this.last && this.last.type === 'exec' ? '경영진보고서' : '이상징후요약')
      + `_${at.getFullYear()}-${p(at.getMonth() + 1)}-${p(at.getDate())}_${p(at.getHours())}${p(at.getMinutes())}`;
  },

  // 화면 전용 요소를 뺀 보고서 본문
  content() {
    const c = $('#reportOut').cloneNode(true);
    $$('.no-print', c).forEach(n => n.remove());
    return c;
  },

  docHtml() {
    return `<!doctype html><html><head><meta charset="utf-8"><title>${this.title()}</title>
      <style>
        body { font-family: "Malgun Gothic", sans-serif; font-size: 10.5pt; line-height: 1.6; color: #111; }
        h1 { font-size: 18pt; border-bottom: 2px solid #333; padding-bottom: 4pt; }
        h2 { font-size: 13pt; margin-top: 16pt; } h3 { font-size: 11pt; }
        table { border-collapse: collapse; width: 100%; margin: 6pt 0; }
        th, td { border: 1px solid #999; padding: 3pt 5pt; font-size: 9.5pt; vertical-align: top; }
        th { background: #eef1f6; } .num { text-align: right; } .hint { color: #666; font-size: 9pt; }
        .appendix { page-break-before: always; }
      </style></head><body>${this.content().innerHTML}</body></html>`;
  },
};

/* ---------- 저장된 보고서 (브라우저에 최근 30건 보관) ---------- */
const ReportHistory = {
  KEY: 'reportHistory', MAX: 30,
  list() { return Store.get(this.KEY, []); },
  save(list) {
    // 저장 공간이 부족하면 오래된 것부터 지움
    while (list.length && !Store.set(this.KEY, list)) list.pop();
  },
  add(e) {
    const entry = { id: Date.now(), at: new Date().toLocaleString('ko-KR'), ...e };
    this.save([entry, ...this.list()].slice(0, this.MAX));
    return entry;
  },
  remove(id) { this.save(this.list().filter(x => x.id !== id)); },
  get(id) { return this.list().find(x => x.id === id); },
  label(x) {
    return `${x.type === 'exec' ? '경영진 보고서' : '이상징후 요약'}${x.partial ? ' (중지됨)' : ''} · 생성 ${x.at}`
      + (x.emp ? ` · 대상 ${x.emp}` : '') + (x.period ? ` · 기간 ${x.period}` : '') + (x.model ? ` · ${x.model}` : '');
  },
};

function renderHistory() {
  const list = ReportHistory.list();
  $('#rHistoryBtn').textContent = `저장된 보고서 (${list.length})`;
  const cur = Report.last && Report.last.id;
  $('#rHistoryList').innerHTML = list.map(x => `
    <div class="hitem${x.id === cur ? ' current' : ''}">
      <span class="chip ${x.type === 'exec' ? 'hol' : 'night'}">${x.type === 'exec' ? '경영진 보고서' : '이상징후 요약'}</span>
      <span class="hmeta">${esc(x.at)} · ${esc(x.emp || '전체')} · ${esc(x.period || '')}${x.partial ? ' · <b>중지됨</b>' : ''}<br>
        <span class="hint">${esc(x.model || '')}</span></span>
      <span class="hact">${x.id === cur ? '<span class="hint">보는 중</span>' : `<button class="ghost" data-view="${x.id}">보기</button>`}
        <button class="link" data-delr="${x.id}">삭제</button></span>
    </div>`).join('') || '<div class="hint">아직 생성한 보고서가 없습니다.</div>';
}

$('#rHistoryBtn').addEventListener('click', () => {
  renderHistory();
  $('#rHistoryPanel').hidden = !$('#rHistoryPanel').hidden;
});
$('#rHistoryList').addEventListener('click', e => {
  const v = e.target.dataset.view, d = e.target.dataset.delr;
  if (v) { Report.show(ReportHistory.get(+v)); $('#rHistoryPanel').hidden = true; $('#rStatus').textContent = ''; }
  if (d) {
    if (!confirm('이 보고서를 삭제합니다.')) return;
    ReportHistory.remove(+d);
    if (Report.last && Report.last.id === +d) Report.show(ReportHistory.list()[0]);
    renderHistory();
  }
});

/* ---------- 이벤트 ---------- */
$('#rEmp').addEventListener('change', e => { Report.emp = e.target.value; });
$('#rSummary').addEventListener('click', () => Report.run('summary'));
$('#rExec').addEventListener('click', () => Report.run('exec'));
$('#rStop').addEventListener('click', () => Report.abort && Report.abort.abort());

$('#rCopy').addEventListener('click', async () => {
  const c = Report.content();
  const html = c.innerHTML, text = c.innerText || c.textContent;
  try {
    await navigator.clipboard.write([new ClipboardItem({
      'text/html': new Blob([html], { type: 'text/html' }),
      'text/plain': new Blob([text], { type: 'text/plain' }),
    })]);
  } catch (e) {
    await navigator.clipboard.writeText(text);
  }
  $('#rStatus').textContent = '클립보드에 복사했습니다.';
});

$('#rWord').addEventListener('click', () => {
  const blob = new Blob(['﻿', Report.docHtml()], { type: 'application/msword' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = Report.title() + '.doc';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

$('#rPrint').addEventListener('click', () => window.print());

// Gemini 설정
function fillModelSelect(names) {
  const sel = $('#sGeminiModel');
  const list = names.length ? names : (S.geminiModel ? [S.geminiModel] : []);
  sel.innerHTML = list.length
    ? list.map(n => `<option value="${esc(n)}" ${n === S.geminiModel ? 'selected' : ''}>${esc(n)}</option>`).join('')
    : '<option value="">(키 저장 시 사용 가능한 모델을 불러옵니다)</option>';
}
// 키로 사용 가능한 모델 목록을 받아 선택 목록 갱신 (단종 모델이 저장돼 있으면 추천 모델로 교체)
async function refreshModels(key) {
  const names = await Gemini.listModels(key);
  if (!names.length) throw new Error('이 키로 사용 가능한 Gemini 모델이 없습니다.');
  Store.set('geminiModels', names);
  if (!names.includes(S.geminiModel)) S.geminiModel = Gemini.pickModel(names);
  Analysis.saveSettings();
  fillModelSelect(names);
  return names;
}

$('#sGeminiKey').value = S.geminiKey;
$('#sOrgName').value = S.orgName;
fillModelSelect(Store.get('geminiModels', []));
$('#sGeminiModel').addEventListener('change', e => { S.geminiModel = e.target.value; Analysis.saveSettings(); });

// 키 입력 직후 바로 모델 목록 불러오기
$('#sGeminiKey').addEventListener('change', async e => {
  const key = e.target.value.trim();
  if (!key) return;
  const st = $('#geminiStatus');
  st.textContent = '모델 목록 불러오는 중…';
  try {
    S.geminiKey = key;
    const names = await refreshModels(key);
    st.textContent = `모델 ${names.length}개를 불러왔습니다. 선택 후 "저장 및 연결 테스트"를 누르세요.`;
  } catch (err) {
    st.innerHTML = `<span class="chip err">${esc(err.message)}</span>`;
  }
});

// 페이지를 열 때 키가 있으면 목록 자동 갱신
if (S.geminiKey) refreshModels(S.geminiKey).catch(err => {
  $('#geminiStatus').innerHTML = `<span class="chip err">${esc(err.message)}</span>`;
});

$('#saveGemini').addEventListener('click', async () => {
  S.geminiKey = $('#sGeminiKey').value.trim();
  S.orgName = $('#sOrgName').value.trim();
  Analysis.saveSettings();
  const st = $('#geminiStatus');
  if (!S.geminiKey) { st.textContent = '키가 비어 있습니다.'; return; }
  st.textContent = '모델 목록 확인 중…';
  try {
    await refreshModels(S.geminiKey);
    const t0 = Date.now();
    let note = '';
    var timer = setInterval(() => { st.textContent = `연결 테스트 중… ${Math.round((Date.now() - t0) / 1000)}초${note}`; }, 500);
    await Gemini.test(S.geminiKey, S.geminiModel, (n, ms) => { note = ` · 서버 혼잡으로 재시도 ${n}/3`; });
    st.innerHTML = `<span class="chip ok">연결됨 · ${esc(S.geminiModel)} · ${((Date.now() - t0) / 1000).toFixed(1)}초</span>`;
  } catch (err) {
    st.innerHTML = `<span class="chip err">${esc(err.message)}</span>`;
  } finally {
    clearInterval(timer);
  }
});

// 시작 시 가장 최근 보고서 표시 (이전 버전의 lastReport는 기록으로 옮김)
(function restore() {
  const old = Store.get('lastReport', null);
  if (old && old.md) {
    ReportHistory.save([{ id: Date.now(), ...old }, ...ReportHistory.list()].slice(0, ReportHistory.MAX));
    Store.remove('lastReport');
  }
  renderHistory();
  const latest = ReportHistory.list()[0];
  if (latest) Report.show(latest);
})();
