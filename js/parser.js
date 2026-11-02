// 엑셀/CSV 파싱: 법인카드 사용내역, 직원 집주소
const CARD_FIELDS = {
  '순번': 'seq', '카드번호': 'card', '이용자명': 'user', '이용일': 'date', '가맹점명': 'merchant',
  '이용금액': 'amount', '가맹점주소': 'address', '사업자등록번호': 'bizNo', '승인번호': 'approvalNo',
  '과세유형': 'taxType', '전표구분': 'slipType', '미화금액': 'usd', '미화환율': 'fxRate',
  '승인시간': 'time', '가맹점업종코드': 'catCode', '가맹점업종명': 'category', '유종': 'fuel', '리터당단가': 'literPrice',
};
const REQUIRED_CARD = ['user', 'date', 'merchant', 'amount', 'address'];

const HOME_FIELDS = {
  '이용자명': 'user', '성명': 'user', '이름': 'user', '직원명': 'user',
  '집주소': 'address', '주소': 'address', '자택주소': 'address', '거주지': 'address',
  '카드끝4자리': 'card4', '카드번호': 'card4', '카드뒤4자리': 'card4',
};

const keyOf = h => String(h || '').replace(/\s+/g, '');

async function readRows(file) {
  const buf = await file.arrayBuffer();
  let wb;
  if (/\.csv$/i.test(file.name)) {
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(buf); }
    catch (e) { text = new TextDecoder('euc-kr').decode(buf); }
    wb = XLSX.read(text.replace(/^﻿/, ''), { type: 'string', raw: true });
  } else {
    wb = XLSX.read(buf, { type: 'array' });
  }
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
}

// 헤더 행을 찾아 컬럼 인덱스 매핑
function mapHeader(rows, fieldMap, required) {
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const idx = {};
    rows[i].forEach((h, c) => {
      const f = fieldMap[keyOf(h)];
      if (f && idx[f] == null) idx[f] = c;
    });
    if (required.every(f => idx[f] != null)) return { headerRow: i, idx };
  }
  return null;
}

function toNumber(v) {
  if (typeof v === 'number') return v;
  const s = String(v || '').replace(/[,\s원]/g, '');
  if (s === '' || s === '-') return 0;
  const n = Number(s);
  return isFinite(n) ? n : 0;
}

// 이용일 → {dateStr:'YYYY-MM-DD', valid}
function parseDate(v) {
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    const d = XLSX.SSF.parse_date_code(v);
    return mkDate(d.y, d.m, d.d, String(v));
  }
  const raw = String(v || '').trim();
  let m = raw.match(/^(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
  if (!m) m = raw.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (!m) return { dateStr: raw, valid: false, raw };
  return mkDate(+m[1], +m[2], +m[3], raw);
}
function mkDate(y, mo, d, raw) {
  const dt = new Date(y, mo - 1, d);
  const valid = dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d;
  const p = n => String(n).padStart(2, '0');
  return { dateStr: valid ? `${y}-${p(mo)}-${p(d)}` : raw, valid, raw, dow: valid ? dt.getDay() : null };
}

// 승인시간 → 'HH:MM:SS'
function parseTime(v) {
  if (typeof v === 'number' && v < 1) {
    const s = Math.round(v * 86400);
    const p = n => String(n).padStart(2, '0');
    return `${p(Math.floor(s / 3600))}:${p(Math.floor(s / 60) % 60)}:${p(s % 60)}`;
  }
  const raw = String(v || '').trim();
  let m = raw.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (m) return `${m[1].padStart(2, '0')}:${m[2]}:${m[3] || '00'}`;
  m = raw.match(/^(\d{2})(\d{2})(\d{2})?$/);
  if (m) return `${m[1]}:${m[2]}:${m[3] || '00'}`;
  return raw;
}

async function parseCardFile(file) {
  const rows = await readRows(file);
  const hdr = mapHeader(rows, CARD_FIELDS, REQUIRED_CARD);
  if (!hdr) throw new Error(`${file.name}: 필수 컬럼(이용자명, 이용일, 가맹점명, 이용금액, 가맹점 주소)을 찾지 못했습니다.`);
  const out = [];
  for (let r = hdr.headerRow + 1; r < rows.length; r++) {
    const row = rows[r];
    const get = f => hdr.idx[f] == null ? '' : row[hdr.idx[f]];
    if (!String(get('user')).trim() && !String(get('merchant')).trim()) continue;
    const d = parseDate(get('date'));
    out.push({
      seq: toNumber(get('seq')) || out.length + 1,
      card: String(get('card')).trim(),
      user: String(get('user')).trim(),
      dateStr: d.dateStr, dateValid: d.valid, dow: d.dow,
      merchant: String(get('merchant')).trim(),
      amount: toNumber(get('amount')),
      address: normAddr(get('address')),
      bizNo: String(get('bizNo')).trim(),
      approvalNo: String(get('approvalNo')).trim(),
      taxType: String(get('taxType')).trim(),
      slipType: String(get('slipType')).trim(),
      usd: toNumber(get('usd')),
      fxRate: toNumber(get('fxRate')),
      time: parseTime(get('time')),
      catCode: String(get('catCode')).trim(),
      category: String(get('category')).trim(),
      fuel: String(get('fuel')).trim(),
      literPrice: toNumber(get('literPrice')),
      source: file.name,
    });
  }
  return out;
}

async function parseHomeFile(file) {
  const rows = await readRows(file);
  const hdr = mapHeader(rows, HOME_FIELDS, ['user', 'address']);
  if (!hdr) throw new Error('집주소 파일에서 이용자명/집주소 컬럼을 찾지 못했습니다.');
  const out = [];
  for (let r = hdr.headerRow + 1; r < rows.length; r++) {
    const row = rows[r];
    const user = String(row[hdr.idx.user] || '').trim();
    if (!user) continue;
    const card4 = hdr.idx.card4 == null ? '' : String(row[hdr.idx.card4] || '').replace(/\D/g, '').slice(-4);
    out.push({ user, card4, address: normAddr(row[hdr.idx.address]) });
  }
  return out;
}

function txKey(t) {
  return [t.card, t.approvalNo, t.dateStr, t.time, t.amount, t.merchant].join('|');
}
