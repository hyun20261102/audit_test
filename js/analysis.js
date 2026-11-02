// 분석 기준 및 거래별 판정
const DEFAULT_HOLIDAYS = [
  // 2025
  '2025-01-01', '2025-01-27', '2025-01-28', '2025-01-29', '2025-01-30', '2025-03-01', '2025-03-03',
  '2025-05-05', '2025-05-06', '2025-06-03', '2025-06-06', '2025-08-15', '2025-10-03', '2025-10-05',
  '2025-10-06', '2025-10-07', '2025-10-08', '2025-10-09', '2025-12-25',
  // 2026
  '2026-01-01', '2026-02-16', '2026-02-17', '2026-02-18', '2026-03-01', '2026-03-02', '2026-05-05',
  '2026-05-24', '2026-05-25', '2026-06-03', '2026-06-06', '2026-08-15', '2026-08-17', '2026-09-24',
  '2026-09-25', '2026-09-26', '2026-10-03', '2026-10-05', '2026-10-09', '2026-12-25',
];

const DEFAULT_SETTINGS = {
  kakaoKey: '',
  geminiKey: '',
  geminiModel: '',
  orgName: '',
  radius: 1000,
  nightFrom: '22:00',
  nightTo: '06:00',
  riskCats: '주점,유흥,노래,골프,모텔,숙박,호텔,마트,편의점,백화점,미용,사우나,찜질,안마,PC방,게임',
  exclude: 'PG,온라인,인터넷,통신판매,쇼핑몰,카카오,네이버,쿠팡,배달의민족,요기요',
  holidays: DEFAULT_HOLIDAYS.join(', '),
};

const Analysis = {
  settings: { ...DEFAULT_SETTINGS, ...Store.get('settings', {}) },

  saveSettings() { Store.set('settings', this.settings); },

  holidaySet() {
    return new Set(String(this.settings.holidays).split(/[\s,]+/).filter(Boolean));
  },
  keywords(s) {
    return String(s || '').split(',').map(x => x.trim()).filter(Boolean);
  },

  findHome(tx, homes) {
    const same = homes.filter(h => h.user === tx.user);
    if (!same.length) return null;
    const digits = String(tx.card).replace(/\D/g, '');
    return same.find(h => h.card4 && digits.endsWith(h.card4))
      || same.find(h => !h.card4)
      || same[0];
  },

  inNight(time) {
    if (!/^\d{2}:\d{2}/.test(time)) return false;
    const t = time.slice(0, 5), { nightFrom: f, nightTo: e } = this.settings;
    return f <= e ? (t >= f && t < e) : (t >= f || t < e);
  },

  // 거래 1건 판정 (radius 지정 시 해당 반경 기준)
  evaluate(tx, homes, radius = this.settings.radius) {
    const hol = this._hol || (this._hol = this.holidaySet());
    const r = { home: null, dist: null, near: false, flag: false, excluded: '', reasons: [] };

    r.cancelled = /취소/.test(tx.slipType);
    if (r.cancelled) r.excluded = '취소전표';
    else {
      const ex = this.keywords(this.settings.exclude);
      const hay = tx.merchant + ' ' + tx.category;
      if (tx.merchant.includes(' - ')) r.excluded = 'PG 하위가맹점(온라인)';
      else {
        const k = ex.find(k => hay.includes(k));
        if (k) r.excluded = `온라인/제외키워드(${k})`;
      }
    }

    r.home = this.findHome(tx, homes);
    if (!r.excluded && r.home && r.home.lat != null && tx.geo) r.dist = distanceM(r.home, tx.geo);

    const holiday = tx.dow === 0 || tx.dow === 6 ? (tx.dow === 0 ? '일요일' : '토요일')
      : hol.has(tx.dateStr) ? '공휴일' : '';
    const night = this.inNight(tx.time);
    const riskK = this.keywords(this.settings.riskCats).find(k => (tx.category + ' ' + tx.merchant).includes(k));

    r.holiday = holiday;
    r.night = night;
    r.risk = riskK || '';

    // 시나리오 1: 집근처 사용 (위치 기반이므로 온라인/PG 결제는 제외)
    r.near = !r.excluded && r.dist != null && r.dist <= radius;
    // 시나리오 2·3: 휴일 사용, 심야 사용 (위치와 무관하므로 온라인/PG 결제도 포함, 취소전표만 제외)
    r.holidayUse = !r.cancelled && !!holiday;
    r.nightUse = !r.cancelled && night;
    // 점검대상: 집근처 + (휴일/심야/주의업종)
    r.flag = r.near && !!(holiday || night || riskK);
    r.scenarios = [r.near && '집근처', r.holidayUse && '휴일', r.nightUse && '심야'].filter(Boolean);

    if (r.near) r.reasons.push(`집근처 ${fmt.km(r.dist)}km`);
    if (r.holidayUse) r.reasons.push(holiday);
    if (r.nightUse) r.reasons.push('심야');
    if (riskK && !r.excluded) r.reasons.push(`주의업종(${riskK})`);
    if (!tx.dateValid) r.reasons.push('날짜오류');
    return r;
  },

  invalidate() { this._hol = null; },
};
