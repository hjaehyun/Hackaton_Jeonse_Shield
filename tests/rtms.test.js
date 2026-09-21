import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseItems, parseAmount, complexKey, normalizeRent, normalizeTrade, activeTrades,
} from '../src/lib/rtms.js';

// Captured verbatim from the live API on 2026-09-21 (LAWD_CD=11110, DEAL_YMD=202606).
const RENT_XML = `<?xml version="1.0" encoding="UTF-8"?>
<response><header><resultCode>000</resultCode><resultMsg>OK</resultMsg></header>
<body><items>
<item><aptNm>광화문스페이스본(101동~105동)</aptNm><aptSeq>11110-2203</aptSeq><buildYear>2008</buildYear><contractTerm> </contractTerm><contractType> </contractType><dealDay>27</dealDay><dealMonth>6</dealMonth><dealYear>2026</dealYear><deposit>96,000</deposit><excluUseAr>97.61</excluUseAr><floor>1</floor><jibun>9</jibun><monthlyRent>0</monthlyRent><sggCd>11110</sggCd><umdNm>사직동</umdNm></item>
<item><aptNm>삼익</aptNm><aptSeq>41111-5</aptSeq><buildYear>1978</buildYear><contractTerm>26.07~28.07</contractTerm><contractType>신규</contractType><dealDay>25</dealDay><dealMonth>6</dealMonth><dealYear>2026</dealYear><deposit>1,000</deposit><excluUseAr>55.57</excluUseAr><floor>10</floor><jibun>212-5</jibun><monthlyRent>50</monthlyRent><sggCd>41111</sggCd><umdNm>파장동</umdNm></item>
</items><numOfRows>2</numOfRows><totalCount>180</totalCount></body></response>`;

test('parseItems returns one flat object per <item>', () => {
  const rows = parseItems(RENT_XML);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].aptNm, '광화문스페이스본(101동~105동)');
  assert.equal(rows[0].deposit, '96,000');
  assert.equal(rows[1].aptNm, '삼익');
  assert.equal(rows[1].contractType, '신규');
});

test('parseItems reports whitespace-only fields as empty strings', () => {
  const rows = parseItems(RENT_XML);
  assert.equal(rows[0].contractTerm, '');
  assert.equal(rows[0].contractType, '');
});

test('parseItems ignores tags outside <item> and returns [] when there are none', () => {
  assert.deepEqual(parseItems('<response><body><totalCount>0</totalCount></body></response>'), []);
  assert.deepEqual(parseItems(''), []);
  assert.deepEqual(parseItems(null), []);
});

test('parseAmount strips thousands separators', () => {
  assert.equal(parseAmount('96,000'), 96000);
  assert.equal(parseAmount('1,234,567'), 1234567);
  assert.equal(parseAmount('50'), 50);
  assert.equal(parseAmount('0'), 0);
});

test('parseAmount keeps decimals for areas', () => {
  assert.equal(parseAmount('97.61'), 97.61);
  assert.equal(parseAmount('55.57'), 55.57);
});

test('parseAmount returns null for blank or non-numeric input', () => {
  for (const input of [' ', '', null, undefined, '-', 'N/A', {}]) {
    assert.equal(parseAmount(input), null, `expected null for ${JSON.stringify(input)}`);
  }
});

// The trade response carries no aptSeq, so rent and trade rows can only be
// joined on the complex name. These cases decide what counts as one complex.
test('complexKey drops the building-range suffix the rent feed appends', () => {
  assert.equal(complexKey('광화문스페이스본(101동~105동)'), complexKey('광화문스페이스본'));
});

test('complexKey ignores spacing and letter case differences', () => {
  assert.equal(complexKey('e편한세상 신촌'), complexKey('E편한세상신촌'));
  assert.equal(complexKey(' 삼익 '), complexKey('삼익'));
});

test('complexKey keeps phase numbers that identify a different complex', () => {
  assert.notEqual(complexKey('아남아파트 3차'), complexKey('아남아파트 2차'));
  assert.notEqual(complexKey('래미안'), complexKey('래미안2'));
});

test('complexKey returns null when there is no usable name', () => {
  for (const input of ['', ' ', '()', null, undefined, 42]) {
    assert.equal(complexKey(input), null, `expected null for ${JSON.stringify(input)}`);
  }
});

const RENT_ROW = {
  aptNm: '광화문스페이스본(101동~105동)', aptSeq: '11110-2203', buildYear: '2008',
  contractTerm: '', contractType: '', dealDay: '27', dealMonth: '6', dealYear: '2026',
  deposit: '96,000', excluUseAr: '97.61', floor: '1', jibun: '9', monthlyRent: '0',
  sggCd: '11110', umdNm: '사직동',
};

const TRADE_ROW = {
  aptDong: '301', aptNm: '명륜동주상복합아남아파트', buildYear: '1999',
  cdealDay: '', cdealType: '', dealAmount: '89,500', dealDay: '17', dealMonth: '6',
  dealYear: '2026', dealingGbn: '중개거래', excluUseAr: '59.36', floor: '3',
  jibun: '237', sggCd: '11110', umdNm: '명륜2가',
};

test('normalizeRent maps the documented rent fields', () => {
  assert.deepEqual(normalizeRent(RENT_ROW), {
    name: '광화문스페이스본(101동~105동)',
    key: complexKey('광화문스페이스본'),
    area: 97.61, deposit: 96000, monthlyRent: 0, floor: 1,
    year: 2026, month: 6, day: 27, dong: '사직동', buildYear: 2008,
  });
});

test('normalizeRent treats a zero monthly rent as a 전세 contract', () => {
  assert.equal(normalizeRent(RENT_ROW).monthlyRent, 0);
  assert.equal(normalizeRent({ ...RENT_ROW, monthlyRent: '50' }).monthlyRent, 50);
});

test('normalizeTrade maps the documented trade fields', () => {
  assert.deepEqual(normalizeTrade(TRADE_ROW), {
    name: '명륜동주상복합아남아파트',
    key: complexKey('명륜동주상복합아남아파트'),
    area: 59.36, price: 89500, floor: 3,
    year: 2026, month: 6, day: 17, dong: '명륜2가', buildYear: 1999,
    cancelled: false,
  });
});

test('normalizeTrade flags a deal the ministry marked as cancelled', () => {
  assert.equal(normalizeTrade({ ...TRADE_ROW, cdealType: '해제' }).cancelled, true);
  assert.equal(normalizeTrade({ ...TRADE_ROW, cdealType: 'O', cdealDay: '26.07.01' }).cancelled, true);
});

test('normalize returns null when the row lacks a name or a usable amount', () => {
  assert.equal(normalizeRent({ ...RENT_ROW, aptNm: ' ' }), null);
  assert.equal(normalizeRent({ ...RENT_ROW, excluUseAr: ' ' }), null);
  assert.equal(normalizeRent({ ...RENT_ROW, deposit: ' ' }), null);
  assert.equal(normalizeTrade({ ...TRADE_ROW, dealAmount: ' ' }), null);
  assert.equal(normalizeTrade(null), null);
});

test('activeTrades drops cancelled deals so they cannot move the median', () => {
  const rows = [
    normalizeTrade(TRADE_ROW),
    normalizeTrade({ ...TRADE_ROW, dealAmount: '999,999', cdealType: '해제' }),
    normalizeTrade({ ...TRADE_ROW, dealAmount: '90,000' }),
  ];
  assert.deepEqual(activeTrades(rows).map((t) => t.price), [89500, 90000]);
});
