import { jeonseRatio, verdict, tradeDistribution, similarPrices } from './lib/ratio.js';
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
    for (const [selector, label, minimum, integer] of [
      ['#area-input', '전용면적', 0.01, false], ['#deposit-input', '보증금', 1, true], ['#rent-input', '월세', 0, true],
    ]) {
      const field = $(selector);
      const value = Number(field.value);
      if (!field.value.trim() || !Number.isFinite(value) || value < minimum || value > Number.MAX_SAFE_INTEGER || (integer && !Number.isSafeInteger(value)) || !field.validity.valid) {
        return fail(selector, `${label}${label === '보증금' ? '은' : '는'} ${minimum === 0 ? '0 이상' : '0보다 큰'} ${integer ? '정수' : '숫자(소수점 둘째 자리까지)'}로 입력해 주세요.`);
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
    deposit: Number($('#deposit-input').value), rent: Number($('#rent-input').value),
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
  monthlyRows = null;
  $('#sido-select').dispatchEvent(new Event('change'));
});

function gauge(ratio) {
  const position = Math.max(0, Math.min(100, ratio));
  return `<div class="gauge-wrap" role="img" aria-label="전세가율 ${format(ratio)}퍼센트. 게이지 범위 0에서 100퍼센트. 기준 60, 70, 80퍼센트.">
    <div class="ratio-gauge"><span></span><span></span><span></span><span></span></div><span class="gauge-marker" style="left:${position}%"></span>
    <div class="gauge-ticks"><span style="left:0">0</span><span style="left:60%">60</span><span style="left:70%">70</span><span style="left:80%">80</span><span style="left:100%">100%</span></div></div>`;
}

function renderDistribution(stats, deposit) {
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
  return `<svg class="box-plot" viewBox="0 0 400 153" role="img" aria-label="매매 분포: 최저 ${money(stats.min)}, 하위25% ${money(stats.q1)}, 중위 ${money(stats.median)}, 상위25% ${money(stats.q3)}, 최고 ${money(stats.max)}. 내 보증금 ${money(deposit)}.">
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
    <p class="distribution-note">25%·75%는 실제 관측값(nearest-rank)을 사용합니다.<br>내 보증금 마커는 매매가와의 비교이며 전월세 백분위가 아닙니다.</p>`;
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

// 판시사항 runs from 100 to 800 characters. Printed in full on a phone one
// decision fills the screen and none of them get read, so the quote is clamped
// and the rest is one tap away. Nothing is cut from the text itself — this is
// presentation, not summarising.
const CLAMP_AFTER = 200;

function renderPrecedent(precedent) {
  const card = document.createElement('article');
  card.className = 'precedent';

  const meta = document.createElement('p');
  meta.className = 'precedent-meta';
  meta.textContent = `${precedent.court} ${precedent.decidedOn} 선고 ${precedent.caseNumber}`;

  // The court's own words. Ministry text is never inserted as markup.
  const quote = document.createElement('blockquote');
  quote.textContent = precedent.summary;

  if (precedent.summary.length > CLAMP_AFTER) {
    quote.classList.add('clamped');
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'more-toggle';
    toggle.textContent = '판시사항 전체 보기';
    toggle.setAttribute('aria-expanded', 'false');
    toggle.addEventListener('click', () => {
      const expanded = quote.classList.toggle('clamped') === false;
      toggle.textContent = expanded ? '접기' : '판시사항 전체 보기';
      toggle.setAttribute('aria-expanded', String(expanded));
    });
    card.append(meta, quote, toggle);
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

  const refs = document.createElement('p');
  refs.className = 'precedent-refs';
  refs.textContent = `참조조문 ${precedent.references}`;

  const link = document.createElement('a');
  link.href = precedent.link;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = '판례 전문 보기 (국가법령정보센터)';

  card.append(meta, quote, refs, link);
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
  const stats = tradeDistribution(trades, contract.area);
  // Ministry-supplied text is never inserted as HTML.
  $('#contract-summary').textContent = `${contract.sido} ${contract.district === contract.sido ? '' : contract.district} · ${contract.apartment} · 전용 ${format(contract.area)}㎡ · ${contract.rent === 0 ? '전세' : '월세'} · 보증금 ${money(contract.deposit)}${contract.rent > 0 ? ` · 월세 ${money(contract.rent)}` : ''}`;
  // Where the numbers came from, including rows that were removed. A report
  // that quietly drops cancelled deals cannot be checked against the source.
  const provenance = [`국토교통부 실거래가 · ${contract.rangeLabel}`, `매매 ${format(trades.length)}건`];
  if (contract.cancelledCount > 0) provenance.push(`해제 거래 ${format(contract.cancelledCount)}건 제외`);
  $('#data-provenance').textContent = provenance.join(' · ');

  $('#monthly-rent-note').hidden = contract.rent === 0;
  $('#sample-count').textContent = `표본 ${size}건`;
  $('#ratio-card').dataset.verdict = decision.level;
  if (decision.level === 'unknown') {
    const reason = missingRatioReason({
      name: contract.apartment,
      rangeLabel: contract.rangeLabel,
      area: contract.area,
      tradeCount: trades.length,
      sampleSize: size,
    });
    renderMissingRatio(reason);
    // Same reason as the ratio card. Two cards explaining one blank report
    // differently is how a reader concludes the page is broken.
    $('#distribution-content').replaceChildren(unknownState(
      '거래 분포를 표시할 수 없습니다',
      reason.kind === 'no-sales' ? ['매매 거래가 없어 분포를 그릴 수 없습니다.']
        : reason.kind === 'no-comparable' ? [`전용 ${format(contract.area)}㎡ 부근 거래가 없어 분포를 그릴 수 없습니다.`]
        : ['표본 3건 이상이 필요합니다.', '매매가격 통계와 보증금 위치를 표시하지 않습니다.'],
    ));
  } else {
    // Truncate to one decimal so rounding never displays the next verdict boundary.
    const displayRatio = Math.floor(result.ratio * 10) / 10;
    $('#ratio-content').innerHTML = `<div class="ratio-value">${displayRatio.toFixed(1)}<small>%</small></div><div class="ratio-status"><span class="verdict-pill ${decision.level}">${decision.label}</span></div>${gauge(result.ratio)}
      <p class="ratio-calculation">보증금 ${money(contract.deposit)} ÷ 매매 중위가 ${money(result.medianPrice)}<br>소수점 둘째 자리 이하 버림 · 판정은 원래 계산값 기준${result.ratio > 100 ? ' · 게이지 상한 초과' : ''}</p>
      <p class="ratio-warning">60% 미만 안전 · 60~70% 미만 보통 · 70~80% 미만 주의 · 80% 이상 위험<br>이 비율만으로 보증금 반환의 안전성을 보장하지 않습니다.</p>`;
    $('#distribution-content').innerHTML = renderDistribution(stats, contract.deposit);
  }
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
route();
