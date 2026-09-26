import {
  jeonseRatio, verdict, similarPrices,
  marketRatio, marketVerdict, depositDistribution, similarDeposits,
  wolseRatio, wolseDistribution, wolseTransactions, DEPOSIT_BAND,
  jeonseTransactions, recentFilings, depositWindow, nearbyWolse,
} from './lib/ratio.js';
import { listComplexes, complexTransactions, monthRangeLabel, missingRatioReason } from './lib/aggregate.js';
import { recentMonths } from './lib/months.js';

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const format = (number) => new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 2 }).format(number);
const money = (number) => `${format(number)}만원`;
let regions = [];
let step = 1;
let contract = null;

function showScreen(name) {
  $$('.screen').forEach((screen) => { screen.hidden = screen.id !== `${name}-screen`; });
}

function showStep(next, focus = true) {
  step = next;
  $$('.form-step').forEach((part) => { part.hidden = Number(part.dataset.step) !== step; });
  $$('[data-step-indicator]').forEach((item) => {
    const number = Number(item.dataset.stepIndicator);
    item.classList.toggle('completed', number < step);
    if (number === step) item.setAttribute('aria-current', 'step');
    else item.removeAttribute('aria-current');
  });
  $('#previous-step').hidden = step === 1;
  $('#next-step').innerHTML = step === 3 ? '진단하기 <span aria-hidden="true">→</span>' : '다음 단계 <span aria-hidden="true">→</span>';
  clearError();
  if (focus) $(`[data-step="${step}"] input, [data-step="${step}"] select`)?.focus({ preventScroll: false });
}

function route() {
  const hash = location.hash || '#home';
  if (hash === '#diagnosis') {
    showScreen('wizard');
    showStep(contract ? 3 : step, false);
    window.scrollTo(0, 0);
    $('#wizard-title').focus({ preventScroll: true });
  } else if (hash === '#result' && contract) {
    renderResult();
    showScreen('result');
    window.scrollTo(0, 0);
    $('#result-title').focus({ preventScroll: true });
  } else {
    showScreen('home');
    if (hash === '#why' || hash === '#standards') requestAnimationFrame(() => $(hash)?.scrollIntoView());
    else {
      if (hash !== '#home' && hash !== '') history.replaceState(null, '', '#home');
      window.scrollTo(0, 0);
    }
  }
}

function clearError() {
  $('#form-error').textContent = '';
  $$('[aria-invalid=true]').forEach((element) => element.removeAttribute('aria-invalid'));
}

function fail(selector, message) {
  const field = $(selector);
  field.setAttribute('aria-invalid', 'true');
  $('#form-error').textContent = message;
  field.focus();
  return false;
}

// How many months of transactions one diagnosis looks at. Each month is a
// separate request so that no single Worker invocation parses more than one
// month of XML; the browser issues them together.
const MONTHS = 6;

// Rows already fetched, keyed by lawdCd, so returning to a district costs
// nothing. The Worker caches too, but this skips the round trip entirely.
const rowsByDistrict = new Map();

let monthlyRows = null;
let complexes = [];
let selectedComplex = null;

// Abandoned loads are cancelled, not merely ignored. Twelve requests are in
// flight per district; letting them finish after the user has moved on spends
// the daily upstream quota on answers nobody will see.
let inFlight = null;

// Identifies the load a response belongs to. A district the user has moved on
// from can still have a dozen requests in flight; without this, the slower one
// repaints the list and the user picks a complex that does not exist in the
// district they selected.
let loadToken = 0;

// What a search term is matched against: the join key plus the displayed name.
// The key has parentheses stripped, so matching on it alone makes a complex
// unsearchable by the very label the list prints — '경희궁자이(1단지)' finds
// nothing.
function searchIndex(item) {
  return `${item.key} ${String(item.name ?? '').replace(/\s+/g, '').toLowerCase()}`;
}

function resetComplexes(message) {
  // Any load still in flight belongs to a selection that no longer exists.
  loadToken += 1;
  inFlight?.abort();
  inFlight = null;
  complexes = [];
  selectedComplex = null;
  monthlyRows = null;
  $('#complex-list').replaceChildren();
  $('#complex-empty').hidden = true;
  $('#complex-filter').value = '';
  $('#complex-status').textContent = message;
}

// A request that failed for a reason retrying cannot change must not tell the
// user to retry. A deployment with no service key answers 503 forever.
const LOAD_FAILURE_MESSAGE = {
  KEY_NOT_CONFIGURED: '서버에 공공데이터포털 서비스키가 설정되지 않았습니다. 운영자에게 알려 주세요.',
  INVALID_PARAMETERS: '조회 조건이 올바르지 않습니다. 페이지를 새로고침한 뒤 다시 선택해 주세요.',
};
const DEFAULT_LOAD_FAILURE = '실거래가를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.';

class LoadFailure extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

async function fetchMonthRows(kind, lawdCd, ym, signal) {
  const response = await fetch(`/api/month?kind=${kind}&lawdCd=${lawdCd}&ym=${ym}`, { signal });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new LoadFailure(body.error ?? `HTTP_${response.status}`);
  }
  return (await response.json()).rows ?? [];
}

function showComplexes(cached) {
  monthlyRows = cached;
  complexes = listComplexes(cached.trades, cached.rents);
  const range = monthRangeLabel(cached.months);
  $('#complex-status').textContent = complexes.length
    ? `${range} 거래가 있는 단지 ${format(complexes.length)}곳`
    : `${range} 이 지역에는 아파트 거래 기록이 없습니다.`;
  renderComplexes('');
}

async function loadComplexes(lawdCd) {
  resetComplexes('단지를 불러오는 중입니다...');
  const token = (loadToken += 1);

  const cached = rowsByDistrict.get(lawdCd);
  if (cached) {
    showComplexes(cached);
    return;
  }

  const controller = new AbortController();
  inFlight = controller;

  const months = recentMonths(MONTHS);
  // Fanning out here is the point: one Worker invocation per region-month.
  const requests = months.flatMap((ym) => [
    fetchMonthRows('trade', lawdCd, ym, controller.signal).then((rows) => ({ kind: 'trade', rows })),
    fetchMonthRows('rent', lawdCd, ym, controller.signal).then((rows) => ({ kind: 'rent', rows })),
  ]);

  let settled;
  try {
    settled = await Promise.all(requests);
  } catch (error) {
    // Never fall back to partial data: a short range moves the median.
    if (token !== loadToken) return;
    monthlyRows = null;
    $('#complex-status').textContent = error instanceof LoadFailure
      ? LOAD_FAILURE_MESSAGE[error.code] ?? DEFAULT_LOAD_FAILURE
      : DEFAULT_LOAD_FAILURE;
    return;
  }

  // The user moved on while these were in flight. Their result is not ours.
  if (token !== loadToken) return;
  inFlight = null;

  const rows = {
    lawdCd,
    months,
    trades: settled.filter((r) => r.kind === 'trade').flatMap((r) => r.rows),
    rents: settled.filter((r) => r.kind === 'rent').flatMap((r) => r.rows),
  };
  rowsByDistrict.set(lawdCd, rows);
  showComplexes(rows);
}

function renderComplexes(filter) {
  const needle = String(filter ?? '').replace(/\s+/g, '').toLowerCase();
  const shown = needle ? complexes.filter((c) => searchIndex(c).includes(needle)) : complexes;
  const list = $('#complex-list');
  list.replaceChildren();

  for (const item of shown) {
    const option = document.createElement('button');
    option.type = 'button';
    option.className = 'complex-option';
    option.setAttribute('role', 'option');
    option.setAttribute('aria-selected', String(item.key === selectedComplex?.key));
    if (item.key === selectedComplex?.key) option.classList.add('selected');

    const name = document.createElement('strong');
    // Ministry-supplied text is never inserted as HTML.
    name.textContent = item.name;
    const meta = document.createElement('small');
    meta.textContent = `매매 ${format(item.tradeCount)}건 · 전월세 ${format(item.rentCount)}건`;
    option.append(name, meta);

    option.addEventListener('click', () => {
      selectedComplex = item;
      $$('.complex-option').forEach((el) => {
        const chosen = el === option;
        el.classList.toggle('selected', chosen);
        el.setAttribute('aria-selected', String(chosen));
      });
      clearError();
    });

    const li = document.createElement('li');
    li.append(option);
    list.append(li);
  }

  $('#complex-empty').hidden = shown.length > 0 || complexes.length === 0;
}

const contractType = () => ($('input[name="contractType"]:checked')?.value ?? 'jeonse');

// The rent field only exists for a contract that has rent. Hiding it also
// clears it, so switching 월세 -> 전세 cannot leave a stale amount behind that
// the report would then describe as a monthly contract.
function syncContractType() {
  const wolse = contractType() === 'wolse';
  $('#rent-field').hidden = !wolse;
  $('#rent-input').required = wolse;
  if (!wolse) $('#rent-input').value = '0';
  else if ($('#rent-input').value === '0') $('#rent-input').value = '';
  clearError();
}

function validate(number) {
  clearError();
  if (number === 1) {
    if (!regions.length) return fail('#sido-select', '지역 정보를 불러오지 못했습니다. 페이지를 새로고침해 주세요.');
    const group = regions.find((entry) => entry.sido === $('#sido-select').value);
    if (!group) return fail('#sido-select', '시도를 선택해 주세요.');
    if (!group.items.some((item) => item.code === $('#district-select').value)) return fail('#district-select', '시군구를 선택해 주세요.');
  }
  if (number === 2 && !selectedComplex) return fail('#complex-filter', '목록에서 단지를 선택해 주세요.');
  if (number === 3) {
    // 월세 is only asked for, and only checked, when the contract is one.
    // Requiring a rent of 0 from a 전세 tenant was a rule they had to be told;
    // picking 전세 says the same thing without the instruction.
    const fields = [['#area-input', '전용면적', 0.01, false], ['#deposit-input', '보증금', 1, true]];
    if (contractType() === 'wolse') fields.push(['#rent-input', '월세', 1, true]);
    for (const [selector, label, minimum, integer] of fields) {
      const field = $(selector);
      const value = Number(field.value);
      if (!field.value.trim() || !Number.isFinite(value) || value < minimum || value > Number.MAX_SAFE_INTEGER || (integer && !Number.isSafeInteger(value)) || !field.validity.valid) {
        return fail(selector, `${label}${label === '보증금' ? '은' : '는'} 0보다 큰 ${integer ? '정수' : '숫자(소수점 둘째 자리까지)'}로 입력해 주세요.`);
      }
    }
  }
  return true;
}

$('#diagnosis-form').addEventListener('submit', (event) => {
  event.preventDefault();
  if (!validate(step)) return;
  if (step < 3) { showStep(step + 1); return; }
  // Revalidate earlier steps if browser form state has been changed.
  for (const previous of [1, 2]) {
    if (!validate(previous)) { showStep(previous, false); validate(previous); return; }
  }
  const group = regions.find((entry) => entry.sido === $('#sido-select').value);
  const district = group.items.find((entry) => entry.code === $('#district-select').value);
  // The rows are already in memory: the complex list was built from them. No
  // second round trip, and the report cannot disagree with the list it came from.
  const picked = complexTransactions(selectedComplex.key, monthlyRows.trades, monthlyRows.rents);
  contract = {
    sido: group.sido, district: district.name, lawdCd: district.code,
    apartment: picked.name ?? selectedComplex.name, complexKey: selectedComplex.key,
    area: Number($('#area-input').value),
    deposit: Number($('#deposit-input').value),
    rent: contractType() === 'wolse' ? Number($('#rent-input').value) : 0,
    trades: picked.trades, rents: picked.rents,
    cancelledCount: picked.cancelledCount,
    rangeLabel: monthRangeLabel(monthlyRows.months),
  };
  location.hash = 'result';
});
$('#diagnosis-form').addEventListener('input', (event) => {
  if (event.target.matches('input') && event.target.getAttribute('aria-invalid') === 'true') clearError();
});
$('#previous-step').addEventListener('click', () => showStep(Math.max(1, step - 1)));
$$('input[name="contractType"]').forEach((radio) => radio.addEventListener('change', syncContractType));
$('#sido-select').addEventListener('change', () => {
  const group = regions.find((entry) => entry.sido === $('#sido-select').value);
  const select = $('#district-select');
  select.replaceChildren(new Option(group ? '시군구를 선택해 주세요' : '시도를 먼저 선택해 주세요', ''));
  select.disabled = !group;
  if (group) group.items.forEach((item) => select.add(new Option(item.name, item.code)));
  resetComplexes('시군구를 선택하면 실제 거래가 있는 단지를 불러옵니다.');
  clearError();
});
$('#district-select').addEventListener('change', (event) => {
  clearError();
  if (event.target.value) loadComplexes(event.target.value);
  else resetComplexes('시군구를 선택하면 실제 거래가 있는 단지를 불러옵니다.');
});
$('#complex-filter').addEventListener('input', (event) => renderComplexes(event.target.value));
$('#new-diagnosis').addEventListener('click', () => {
  contract = null;
  step = 1;
  $('#diagnosis-form').reset();
  // form.reset() restores the checked radio but not the field it governs.
  syncContractType();
  monthlyRows = null;
  $('#sido-select').dispatchEvent(new Event('change'));
});

function gauge(ratio) {
  const position = Math.max(0, Math.min(100, ratio));
  return `<div class="gauge-wrap" role="img" aria-label="전세가율 ${format(ratio)}퍼센트. 게이지 범위 0에서 100퍼센트. 기준 60, 70, 80퍼센트.">
    <div class="ratio-gauge"><span></span><span></span><span></span><span></span></div><span class="gauge-marker" style="left:${position}%"></span>
    <div class="gauge-ticks"><span style="left:0">0</span><span style="left:60%">60</span><span style="left:70%">70</span><span style="left:80%">80</span><span style="left:100%">100%</span></div></div>`;
}

const SALE_NOTE = '25%·75%는 실제 관측값(nearest-rank)을 사용합니다.<br>내 보증금 마커는 매매가와의 비교이며 전월세 백분위가 아닙니다.';
const MARKET_NOTE = '25%·75%는 실제 관측값(nearest-rank)을 사용합니다.<br>월세가 있는 계약은 제외했습니다. 전월세 전환율을 가정하지 않습니다.';

// What the plotted values are. The chart is drawn for two different
// populations, and a screen reader hears only this label: announcing the jeonse
// card's deposits as '매매 분포' describes the wrong dataset entirely.
const SALE_LABEL = '매매 분포';
const MARKET_LABEL = '전세 보증금 분포';

function renderDistribution(stats, deposit, note = SALE_NOTE, what = SALE_LABEL) {
  // Include the deposit in the displayed axis even if outside observed trade range.
  const low = Math.min(stats.min, deposit) * 0.85;
  const high = Math.max(stats.max, deposit) * 1.05;
  const span = high - low || 1;
  const x = (value) => 25 + ((value - low) / span) * 350;
  const marker = x(deposit);
  const anchor = marker < 90 ? 'start' : marker > 310 ? 'end' : 'middle';
  // Label the whisker ends, not the padded axis bounds. The padding exists only
  // to keep the deposit marker on screen; printing it would put numbers on the
  // chart that appear nowhere in the data and contradict the table below.
  const endLabel = (value) => {
    const at = x(value);
    const clamped = Math.max(30, Math.min(370, at));
    const align = at < 60 ? 'start' : at > 340 ? 'end' : 'middle';
    return `<text x="${clamped}" y="137" text-anchor="${align}">${format(value)}</text>`;
  };
  return `<svg class="box-plot" viewBox="0 0 400 153" role="img" aria-label="${what}: 최저 ${money(stats.min)}, 하위25% ${money(stats.q1)}, 중위 ${money(stats.median)}, 상위25% ${money(stats.q3)}, 최고 ${money(stats.max)}. 내 보증금 ${money(deposit)}.">
    <line x1="25" y1="115" x2="375" y2="115" stroke="#e6ebe8"/>
    <line x1="${x(stats.min)}" y1="84" x2="${x(stats.max)}" y2="84" stroke="#9db7a9" stroke-width="2"/>
    <line x1="${x(stats.min)}" y1="70" x2="${x(stats.min)}" y2="98" stroke="#9db7a9" stroke-width="2"/>
    <line x1="${x(stats.max)}" y1="70" x2="${x(stats.max)}" y2="98" stroke="#9db7a9" stroke-width="2"/>
    <rect x="${x(stats.q1)}" y="62" width="${x(stats.q3) - x(stats.q1)}" height="43" fill="#e3efe7" stroke="#a6c1b0" rx="3"/>
    <line x1="${x(stats.median)}" y1="62" x2="${x(stats.median)}" y2="105" stroke="#4c8469" stroke-width="2"/>
    <line x1="${marker}" y1="43" x2="${marker}" y2="115" stroke="#1b2a4a" stroke-dasharray="3 3"/>
    <circle cx="${marker}" cy="44" r="4" fill="#1b2a4a"/>
    <text class="deposit-text" x="${marker}" y="20" text-anchor="${anchor}">내 보증금</text>
    <text class="deposit-text" x="${marker}" y="35" text-anchor="${anchor}">${money(deposit)}</text>
    ${endLabel(stats.min)}${endLabel(stats.max)}
    </svg>
    <dl class="distribution-stats">${[['최저', stats.min], ['하위25%', stats.q1], ['중위', stats.median], ['상위25%', stats.q3], ['최고', stats.max]].map(([label, price]) => `<div><dt>${label}</dt><dd>${format(price)}</dd></div>`).join('')}</dl>
    <p class="distribution-note">${note}</p>`;
}

// The filings behind the median, newest first. A median is a summary and a
// reader is entitled to the rows it summarises; this is also the only place
// the report shows an individual contract rather than a statistic.
//
// Built from nodes rather than markup. Nothing here is ministry-supplied text
// today, but the moment someone adds a 동 or 단지명 column it would be, and a
// table that was already string-built is where that goes wrong.
//
// Open by default. Collapsed, it was not found: the first reader to test this
// asked for the feature it already shipped, because the chart above it looks
// like the answer and a disclosure looks like a footnote. What people want
// from a comparison is the amounts, so the amounts are not behind a click.
function renderFilings(rows, myAmount, kind = 'jeonse') {
  const wolse = kind === 'wolse';
  const wrap = document.createElement('details');
  wrap.className = 'filing-list';
  wrap.open = true;

  const summary = document.createElement('summary');
  const label = document.createElement('span');
  label.className = 'summary-heading';
  label.textContent = `실제 거래된 금액 ${format(rows.length)}건`;
  const hint = document.createElement('span');
  hint.className = 'filing-hint';
  // Not '중위가를 낸 거래': this list also ships when the sample was too thin
  // for a median, and the card would then be claiming one exists.
  hint.textContent = '최신순 · 비교 대상 거래 전부';
  summary.append(label, hint);

  const scroll = document.createElement('div');
  scroll.className = 'filing-scroll';
  const table = document.createElement('table');
  table.className = 'filing-table';

  const head = document.createElement('thead');
  const headRow = document.createElement('tr');
  const headings = wolse
    ? [['계약일', 'left'], ['전용', 'right'], ['층', 'right'], ['보증금', 'right'], ['월세', 'right']]
    : [['계약일', 'left'], ['전용', 'right'], ['층', 'right'], ['보증금', 'right']];
  for (const [text, align] of headings) {
    const th = document.createElement('th');
    th.textContent = text;
    th.style.textAlign = align;
    headRow.append(th);
  }
  head.append(headRow);

  const body = document.createElement('tbody');
  for (const row of rows) {
    const tr = document.createElement('tr');
    const cells = [FILING_DATE(row), AREA_CELL(row), FLOOR_CELL(row)];
    // The deposit each rent bought sits next to it: without it the rents look
    // like a spread when they are a curve.
    if (wolse) cells.push(format(row.deposit));
    for (const [i, text] of cells.entries()) {
      const td = document.createElement('td');
      td.textContent = text;
      if (i > 0) td.className = 'num';
      tr.append(td);
    }

    const money = document.createElement('td');
    money.className = 'num filing-deposit';
    const amount = document.createElement('strong');
    amount.textContent = format(wolse ? row.monthlyRent : row.deposit);
    money.append(amount);
    // The difference is the reason this table is on a comparison card.
    if (Number.isFinite(myAmount) && myAmount > 0) {
      // 월세 ends in a vowel and 보증금 in a consonant, so the particle differs.
      const [mine, same] = wolse ? ['내 월세', '내 월세와 같음'] : ['내 보증금', '내 보증금과 같음'];
      const gap = (wolse ? row.monthlyRent : row.deposit) - myAmount;
      const diff = document.createElement('small');
      diff.className = gap > 0 ? 'over' : gap < 0 ? 'under' : 'same';
      diff.textContent = gap === 0 ? same
        : `${mine}보다 ${format(Math.abs(gap))} ${gap > 0 ? '높음' : '낮음'}`;
      money.append(diff);
    }
    tr.append(money);
    body.append(tr);
  }

  table.append(head, body);
  scroll.append(table);
  wrap.append(summary, scroll);
  return wrap;
}

// --- 이 단지 최근 실거래 (three kinds side by side) ---
//
// This replaced the sale box plot. A chart of prices a reader cannot name is
// weaker than six dated rows they can, and the same complex trades in three
// forms that a single distribution cannot hold at once.

const FILING_DATE = (row) => (row.year && row.month
  ? `${row.year}.${String(row.month).padStart(2, '0')}${row.day ? `.${String(row.day).padStart(2, '0')}` : ''}`
  : '날짜 없음');

const AREA_CELL = (row) => `${format(row.area)}㎡`;
const FLOOR_CELL = (row) => (Number.isFinite(row.floor) ? `${format(row.floor)}층` : '—');

// How many filings the popup lists. The tile says how many exist, so a capped
// list never reads as the complete history of the complex.
const DIALOG_LIMIT = 20;

const FILING_KINDS = {
  jeonse: {
    label: '전세',
    amount: (r) => format(r.deposit),
    columns: [['계약일', FILING_DATE], ['전용', AREA_CELL], ['층', FLOOR_CELL],
      ['보증금', (r) => format(r.deposit), true]],
  },
  wolse: {
    label: '월세',
    amount: (r) => `${format(r.deposit)} / ${format(r.monthlyRent)}`,
    columns: [['계약일', FILING_DATE], ['전용', AREA_CELL], ['층', FLOOR_CELL],
      ['보증금', (r) => format(r.deposit)], ['월세', (r) => format(r.monthlyRent), true]],
  },
  sales: {
    label: '매매',
    amount: (r) => format(r.price),
    columns: [['계약일', FILING_DATE], ['전용', AREA_CELL], ['층', FLOOR_CELL],
      ['거래가', (r) => format(r.price), true]],
  },
};

function filingTable(rows, columns) {
  const table = document.createElement('table');
  table.className = 'filing-table recent-table';

  const head = document.createElement('tr');
  for (const [label] of columns) {
    const th = document.createElement('th');
    th.textContent = label;
    head.append(th);
  }
  const thead = document.createElement('thead');
  thead.append(head);

  const body = document.createElement('tbody');
  for (const row of rows) {
    const tr = document.createElement('tr');
    for (const [, value, strong] of columns) {
      const td = document.createElement('td');
      td.className = 'num';
      const text = value(row);
      if (strong) {
        const b = document.createElement('strong');
        b.textContent = text;
        td.append(b);
      } else {
        td.textContent = text;
      }
      tr.append(td);
    }
    tr.firstChild.className = '';
    body.append(tr);
  }

  table.append(thead, body);
  return table;
}

function openFilings(kind) {
  const spec = FILING_KINDS[kind];
  const recent = recentFilings(contract.trades, contract.rents, DIALOG_LIMIT);
  const rows = recent[kind];
  const total = recent.totals[kind];

  $('#filing-dialog-title').textContent = `${contract.apartment} · ${spec.label}`;
  $('#filing-dialog-sub').textContent = total > rows.length
    ? `${contract.rangeLabel} · 최근 ${format(rows.length)}건 · 전체 ${format(total)}건 · 가격 단위: 만원`
    : `${contract.rangeLabel} · ${format(total)}건 · 가격 단위: 만원`;

  const scroll = document.createElement('div');
  scroll.className = 'filing-scroll';
  scroll.append(filingTable(rows, spec.columns));
  $('#filing-dialog-body').replaceChildren(scroll);

  // A withdrawn sale is not a price anything traded at, so it is counted here
  // rather than listed with the prices that stood.
  const withdrawn = kind === 'sales' ? contract.cancelledCount ?? 0 : 0;
  if (withdrawn > 0) {
    const note = document.createElement('p');
    note.className = 'distribution-note';
    note.textContent = `해제된 매매 ${format(withdrawn)}건은 목록에서 제외했습니다.`;
    $('#filing-dialog-body').append(note);
  }

  $('#filing-dialog').showModal();
}

function recentTile(kind, rows, total) {
  const spec = FILING_KINDS[kind];
  const tile = document.createElement('button');
  tile.type = 'button';
  tile.className = 'recent-tile';
  tile.dataset.kind = kind;

  const label = document.createElement('span');
  label.className = 'recent-tile-label';
  label.textContent = spec.label;

  const count = document.createElement('span');
  count.className = 'recent-count';
  count.textContent = `${format(total)}건`;

  const head = document.createElement('span');
  head.className = 'recent-group-head';
  head.append(label, count);
  tile.append(head);

  if (!rows.length) {
    const empty = document.createElement('span');
    empty.className = 'recent-empty';
    empty.textContent = '신고된 거래 없음';
    tile.append(empty);
    tile.disabled = true;
    tile.setAttribute('aria-label', `${spec.label} 거래 없음`);
    return tile;
  }

  // The newest filing on the face of the tile: enough to be worth opening, and
  // a number the popup will repeat rather than contradict.
  const latest = rows[0];
  const when = document.createElement('span');
  when.className = 'recent-tile-when';
  when.textContent = `최근 ${FILING_DATE(latest)} · ${AREA_CELL(latest)}`;
  const amount = document.createElement('strong');
  amount.className = 'recent-tile-amount';
  amount.textContent = spec.amount(latest);
  const more = document.createElement('span');
  more.className = 'recent-tile-more';
  more.textContent = '거래 내역 보기';

  tile.append(amount, when, more);
  tile.setAttribute('aria-label', `${spec.label} ${format(total)}건 거래 내역 보기`);
  tile.addEventListener('click', () => openFilings(kind));
  return tile;
}

function renderRecent() {
  const recent = recentFilings(contract.trades, contract.rents, DIALOG_LIMIT);
  const total = recent.totals.jeonse + recent.totals.wolse + recent.totals.sales;
  $('#recent-sample').textContent = total ? `전체 ${format(total)}건` : '';
  $('#recent-content').replaceChildren(
    recentTile('jeonse', recent.jeonse, recent.totals.jeonse),
    recentTile('wolse', recent.wolse, recent.totals.wolse),
    recentTile('sales', recent.sales, recent.totals.sales),
  );
}

// Why the deposit could not be placed against the local jeonse market. Same
// discipline as missingRatioReason: 'not enough samples' is wrong when the
// real answer is that every filing here is a monthly-rent contract.
function missingMarketReason(contract) {
  const nearby = similarDeposits(contract.rents, contract.area);
  const area = `전용 ${format(contract.area)}㎡`;
  if (!contract.rents.length) {
    return { heading: '전세 시세를 비교할 수 없습니다', lines: [`이 단지는 ${contract.rangeLabel}에 전월세 거래가 없습니다.`] };
  }
  if (!nearby.length) {
    const jeonseAnywhere = contract.rents.filter((r) => (r?.monthlyRent ?? 0) === 0).length;
    return {
      heading: '전세 시세를 비교할 수 없습니다',
      lines: [jeonseAnywhere
        ? `전월세 ${format(contract.rents.length)}건이 있지만 ${area} 부근(±10%)에 전세 계약이 없습니다.`
        : `전월세 ${format(contract.rents.length)}건이 모두 월세 계약입니다.`],
    };
  }
  return {
    heading: '전세 시세를 비교할 수 없습니다',
    lines: [`${area} 부근 전세가 ${format(nearby.length)}건뿐입니다.`, '표본 3건 이상이 필요합니다.'],
  };
}

// Why a rent could not be placed against comparable ones. The deposit band is
// the part a reader will not guess, so every branch names it.
function missingWolseReason(contract) {
  const area = `전용 ${format(contract.area)}㎡`;
  // Stated, not rounded: the window the card names has to be the window the
  // filter used, or the reader is told to look for rows that cannot be there.
  const window = depositWindow(contract.deposit);
  const band = `보증금 ${money(window.statedLow)}~${money(window.statedHigh)}`;
  // Same predicate the comparison starts from, not a second copy of it.
  const nearby = nearbyWolse(contract.rents, contract.area);
  const comparable = wolseTransactions(contract.rents, contract.area, contract.deposit);
  const heading = '월세 시세를 비교할 수 없습니다';
  if (!contract.rents.length) {
    return { heading, lines: [`이 단지는 ${contract.rangeLabel}에 전월세 거래가 없습니다.`] };
  }
  if (!nearby.length) {
    return { heading, lines: [`전월세 ${format(contract.rents.length)}건이 있지만 ${area} 부근(±10%)에 월세 계약이 없습니다.`] };
  }
  if (!comparable.length) {
    return {
      heading,
      lines: [`${area} 부근 월세는 ${format(nearby.length)}건 있지만, ${band} 구간의 계약이 없습니다.`,
        '보증금이 다르면 월세도 달라지므로 서로 비교하지 않습니다.'],
    };
  }
  return {
    heading,
    lines: [`${band} 구간의 월세 계약이 ${format(comparable.length)}건뿐입니다.`, '표본 3건 이상이 필요합니다.'],
  };
}

// A monthly contract is two numbers that trade against each other, so it gets
// its own comparison: the rent, measured only against rents that bought a
// comparable deposit. Converting either number into the other is the one thing
// this report will not do.
function renderWolseMarket() {
  const card = $('#market-card');
  $('#market-title').textContent = '같은 단지 월세 시세와 비교';
  $('#market-card .report-description').textContent =
    `동일 단지 · 전용면적 ±10% · 보증금이 내 계약과 ±${Math.round(DEPOSIT_BAND * 100)}% 이내인 월세 계약만 · 가격 단위: 만원`;

  const stats = wolseDistribution(contract.rents, contract.area, contract.deposit);
  const filings = wolseTransactions(contract.rents, contract.area, contract.deposit);
  $('#market-sample').textContent = filings.length ? `월세 표본 ${filings.length}건` : '';
  // The per-row difference is meaningful here in a way it never was on the
  // jeonse card for a monthly contract: every row bought a deposit within
  // ±20% of mine, so their rents and my rent are the same kind of number.
  const listing = filings.length ? renderFilings(filings, contract.rent, 'wolse') : null;

  if (!stats) {
    card.dataset.level = 'unknown';
    const reason = missingWolseReason(contract);
    const warning = document.createElement('p');
    warning.className = 'ratio-warning';
    warning.textContent = '표본을 늘리려고 면적이나 보증금 범위를 넓히지 않습니다.';
    $('#market-content').replaceChildren(
      unknownState(reason.heading, reason.lines), ...(listing ? [listing] : []), warning,
    );
    return;
  }

  const result = wolseRatio(contract.rent, contract.rents, contract.area, contract.deposit);
  const decision = marketVerdict(result);
  const displayRatio = Math.floor(result.ratio * 10) / 10;
  card.dataset.level = decision.level;
  $('#market-content').innerHTML = `<div class="ratio-value">${displayRatio.toFixed(1)}<small>%</small></div>
    <div class="ratio-status"><span class="verdict-pill market-${decision.level}">${decision.label}</span></div>
    <p class="ratio-calculation">월세 ${money(contract.rent)} ÷ 월세 중위가 ${money(result.medianRent)}<br>보증금 ${money(result.statedLow)}~${money(result.statedHigh)} 구간의 ${format(result.sampleSize)}건 기준 · 소수점 둘째 자리 이하 버림</p>
    <p class="ratio-warning">100% 미만 시세보다 낮음 · 100~110% 미만 시세 수준 · 110% 이상 시세보다 높음<br>보증금과 월세는 서로 맞바꿀 수 있어, 보증금이 비슷한 계약끼리만 비교합니다. 보증금 반환의 안전성과는 별개입니다.</p>`;
  $('#market-content').querySelector('.ratio-warning').before(listing);
}

function renderMarket() {
  if (contract.rent > 0) { renderWolseMarket(); return; }

  const card = $('#market-card');
  $('#market-title').textContent = '같은 단지 전세 시세와 비교';
  $('#market-card .report-description').textContent =
    '동일 단지 · 전용면적 ±10% · 월세 없는 전세 계약만 · 가격 단위: 만원';
  const stats = depositDistribution(contract.rents, contract.area);
  const filings = jeonseTransactions(contract.rents, contract.area);
  const size = filings.length;
  $('#market-sample').textContent = size ? `전세 표본 ${size}건` : '';
  // The list goes out even when no ratio does. 'only 2 nearby' is a claim the
  // reader can check, and two rows is exactly the size that invites checking.
  const listing = size ? renderFilings(filings, contract.deposit) : null;

  if (!stats) {
    card.dataset.level = 'unknown';
    const reason = missingMarketReason(contract);
    const warning = document.createElement('p');
    warning.className = 'ratio-warning';
    warning.textContent = '표본을 늘리려고 면적 범위를 넓히거나 월세를 전세로 환산하지 않습니다.';
    $('#market-content').replaceChildren(
      unknownState(reason.heading, reason.lines), ...(listing ? [listing] : []), warning,
    );
    return;
  }

  const result = marketRatio(contract.deposit, contract.rents, contract.area);
  const decision = marketVerdict(result);
  const displayRatio = Math.floor(result.ratio * 10) / 10;
  card.dataset.level = decision.level;
  $('#market-content').innerHTML = `<div class="ratio-value">${displayRatio.toFixed(1)}<small>%</small></div>
    <div class="ratio-status"><span class="verdict-pill market-${decision.level}">${decision.label}</span></div>
    <p class="ratio-calculation">보증금 ${money(contract.deposit)} ÷ 전세 중위가 ${money(result.medianDeposit)}<br>소수점 둘째 자리 이하 버림 · 판정은 원래 계산값 기준</p>
    ${renderDistribution(stats, contract.deposit, MARKET_NOTE, MARKET_LABEL)}
    <p class="ratio-warning">100% 미만 시세보다 낮음 · 100~110% 미만 시세 수준 · 110% 이상 시세보다 높음<br>같은 단지 최근 전세 실거래와의 비교이며, 보증금 반환의 안전성과는 별개입니다.</p>`;
  // Amounts first, chart second. The chart summarises these rows, so it reads
  // as the aside and they read as the answer.
  $('#market-content').querySelector('.box-plot').before(listing);
}

// Why a ratio could not be produced. The distinction matters: "not enough
// samples" reads like a defect when the real reason is that this complex has
// not sold in the window we looked at.
// Built from nodes, not markup: the lines can contain a complex name, and that
// comes from the ministry.
function unknownState(headingText, lines) {
  const state = document.createElement('div');
  state.className = 'unknown-state';

  const symbol = document.createElement('span');
  symbol.className = 'unknown-symbol';
  symbol.setAttribute('aria-hidden', 'true');
  symbol.textContent = '—';

  const heading = document.createElement('h3');
  heading.textContent = headingText;

  const detail = document.createElement('p');
  lines.forEach((line, index) => {
    if (index > 0) detail.append(document.createElement('br'));
    detail.append(document.createTextNode(line));
  });

  state.append(symbol, heading, detail);
  return state;
}

// Which topics the report shows, in the order a tenant meets them. They are
// fixed rather than derived from the verdict: these four apply to every
// residential lease, and picking by verdict would imply the law changes with
// the number, which it does not.
const LEGAL_TOPICS = ['opposing-power', 'priority', 'deposit-return', 'renewal'];

// Fetched once per page load and reused. Precedents do not depend on the
// contract, so re-running a diagnosis must not re-request them.
let legalTopicsPromise = null;

// A precedent card leads with the plain summary when a model produced one, and
// keeps the court's own 판시사항 collapsed underneath. Both are always present:
// a reader who doubts the summary can check it against the source without
// leaving the page, and a reader who does not can move on.
//
// With no model configured plainSummary is absent and the court's wording
// leads instead, which is how the section read before summaries existed.
function renderPrecedent(precedent) {
  const card = document.createElement('article');
  card.className = 'precedent';

  const meta = document.createElement('p');
  meta.className = 'precedent-meta';
  meta.textContent = `${precedent.court} ${precedent.decidedOn} 선고 ${precedent.caseNumber}`;
  card.append(meta);

  const quote = document.createElement('blockquote');
  quote.className = 'source-quote';
  // Court text is never inserted as markup.
  quote.textContent = precedent.summary;

  if (precedent.plainSummary) {
    const plain = document.createElement('p');
    plain.className = 'plain-summary';
    plain.textContent = precedent.plainSummary;

    const badge = document.createElement('p');
    badge.className = 'summary-badge';
    badge.textContent = `AI가 아래 판시사항을 바꿔 쓴 문장입니다 · ${precedent.summarizedBy ?? 'AI'}`;

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'source-toggle';
    toggle.textContent = '대법원 판시사항 원문 보기';
    toggle.setAttribute('aria-expanded', 'false');
    quote.hidden = true;
    toggle.addEventListener('click', () => {
      quote.hidden = !quote.hidden;
      toggle.textContent = quote.hidden ? '대법원 판시사항 원문 보기' : '원문 접기';
      toggle.setAttribute('aria-expanded', String(!quote.hidden));
    });

    card.append(plain, badge, toggle, quote);
  } else {
    card.append(quote);
  }

  const refs = document.createElement('p');
  refs.className = 'precedent-refs';
  refs.textContent = `참조조문 ${precedent.references}`;

  const link = document.createElement('a');
  link.href = precedent.link;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = '판례 전문 보기 (국가법령정보센터)';

  card.append(refs, link);
  return card;
}

function renderLegalTopic(topic, alreadyShown) {
  const section = document.createElement('article');
  section.className = 'legal-topic';

  const heading = document.createElement('h3');
  heading.textContent = topic.label;

  const guidance = document.createElement('p');
  guidance.className = 'legal-guidance';
  guidance.textContent = topic.guidance;

  section.append(heading, guidance);

  // One decision often applies to two topics — 대항력 and 우선변제권 turn on
  // the same article — and quoting 600 characters twice on one page helps
  // nobody. The first topic that needs it keeps it.
  const fresh = topic.precedents.filter((p) => !alreadyShown.has(p.id));
  fresh.forEach((p) => alreadyShown.add(p.id));

  if (fresh.length === 0) {
    const none = document.createElement('p');
    none.className = 'field-hint';
    none.textContent = topic.precedents.length === 0
      ? '이 쟁점에 대한 대법원 판례를 찾지 못했습니다. 위 설명만 참고해 주세요.'
      : '이 쟁점의 판례는 위 항목에서 이미 인용했습니다.';
    section.append(none);
    return section;
  }

  fresh.forEach((p) => section.append(renderPrecedent(p)));
  return section;
}

async function loadLegalTopics() {
  if (!legalTopicsPromise) {
    legalTopicsPromise = Promise.all(
      LEGAL_TOPICS.map((topic) => fetch(`/api/law?topic=${topic}`).then((r) => {
        if (!r.ok) throw new Error(topic);
        return r.json();
      })),
    );
  }

  const container = $('#legal-topics');
  const status = $('#legal-status');
  try {
    const topics = await legalTopicsPromise;
    const shown = new Set();
    container.replaceChildren(...topics.map((topic) => renderLegalTopic(topic, shown)));
    status.hidden = true;
  } catch {
    // Let the next visit try again rather than caching the failure.
    legalTopicsPromise = null;
    container.replaceChildren();
    status.hidden = false;
    status.textContent = '법률 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.';
  }
}

function renderMissingRatio(reason) {
  const warning = document.createElement('p');
  warning.className = 'ratio-warning';
  warning.textContent = '표본을 늘리려고 면적 범위를 넓히거나 가격을 추정하지 않습니다.';

  $('#ratio-content').replaceChildren(unknownState(reason.heading, reason.lines), warning);
}

function renderResult() {
  const trades = contract.trades ?? [];
  const result = jeonseRatio(contract.deposit, trades, contract.area);
  const decision = verdict(result);
  const size = similarPrices(trades, contract.area).length;
  // Ministry-supplied text is never inserted as HTML.
  $('#contract-summary').textContent = `${contract.sido} ${contract.district === contract.sido ? '' : contract.district} · ${contract.apartment} · 전용 ${format(contract.area)}㎡ · ${contract.rent === 0 ? '전세' : '월세'} · 보증금 ${money(contract.deposit)}${contract.rent > 0 ? ` · 월세 ${money(contract.rent)}` : ''}`;
  // Where the numbers came from, including rows that were removed. A report
  // that quietly drops cancelled deals cannot be checked against the source.
  const provenance = [`국토교통부 실거래가 · ${contract.rangeLabel}`,
    `전월세 ${format((contract.rents ?? []).length)}건`, `매매 ${format(trades.length)}건`];
  if (contract.cancelledCount > 0) provenance.push(`해제 거래 ${format(contract.cancelledCount)}건 제외`);
  $('#data-provenance').textContent = provenance.join(' · ');

  $('#monthly-rent-note').hidden = contract.rent === 0;
  $('#ratio-card').dataset.verdict = decision.level;
  if (decision.level === 'unknown') {
    renderMissingRatio(missingRatioReason({
      name: contract.apartment,
      rangeLabel: contract.rangeLabel,
      area: contract.area,
      tradeCount: trades.length,
      sampleSize: size,
    }));
  } else {
    // Truncate to one decimal so rounding never displays the next verdict boundary.
    const displayRatio = Math.floor(result.ratio * 10) / 10;
    $('#ratio-content').innerHTML = `<div class="ratio-value">${displayRatio.toFixed(1)}<small>%</small></div><div class="ratio-status"><span class="verdict-pill ${decision.level}">${decision.label}</span></div>${gauge(result.ratio)}
      <p class="ratio-calculation">보증금 ${money(contract.deposit)} ÷ 매매 중위가 ${money(result.medianPrice)} · 매매 표본 ${format(size)}건<br>소수점 둘째 자리 이하 버림 · 판정은 원래 계산값 기준${result.ratio > 100 ? ' · 게이지 상한 초과' : ''}</p>
      <p class="ratio-warning">60% 미만 안전 · 60~70% 미만 보통 · 70~80% 미만 주의 · 80% 이상 위험<br>이 비율만으로 보증금 반환의 안전성을 보장하지 않습니다.</p>`;
  }
  // The headline card: what other tenants in this complex actually paid.
  renderMarket();
  // What the complex has been trading at lately, in all three forms.
  renderRecent();
  $$('.check-item input').forEach((checkbox) => { checkbox.checked = false; });
  updateChecklist();

  // Precedents do not depend on the contract, so this is fire-and-forget: the
  // report renders immediately and the legal section fills in when it arrives.
  loadLegalTopics();
}

function updateChecklist() {
  $('#checklist-count').textContent = `${$$('.check-item input:checked').length} / 5 확인`;
}
$$('.check-item input').forEach((checkbox) => checkbox.addEventListener('change', updateChecklist));

$('#filing-dialog-close').addEventListener('click', () => $('#filing-dialog').close());
// Clicking the backdrop lands on the dialog itself: anything inside stops at a
// child. Native ESC-to-close comes free with showModal().
$('#filing-dialog').addEventListener('click', (event) => {
  if (event.target === $('#filing-dialog')) $('#filing-dialog').close();
});
// Leaving the report while a filing list is open would otherwise strand the
// modal over the landing page.
window.addEventListener('hashchange', () => $('#filing-dialog').close());

async function loadRegions() {
  try {
    const response = await fetch('/data/lawd.json');
    if (!response.ok) throw new Error('지역 정보 응답 오류');
    regions = await response.json();
    const select = $('#sido-select');
    select.replaceChildren(new Option('시도를 선택해 주세요', ''));
    regions.forEach((group) => select.add(new Option(group.sido, group.sido)));
  } catch {
    $('#sido-select').replaceChildren(new Option('지역 정보를 불러오지 못했습니다', ''));
    $('#form-error').textContent = '지역 정보를 불러오지 못했습니다. 페이지를 새로고침해 주세요.';
  }
}
// Reserve exact space for the fixed legal footer at any font/viewport size.
new ResizeObserver((entries) => {
  document.documentElement.style.setProperty('--footer-height', `${entries[0].target.getBoundingClientRect().height}px`);
}).observe($('#site-footer'));
window.addEventListener('hashchange', route);
loadRegions();
// A browser that restored a checked radio on reload must not leave the rent
// field out of step with it.
syncContractType();
route();
