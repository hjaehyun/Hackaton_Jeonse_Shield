import { jeonseRatio, verdict, tradeDistribution, similarPrices } from './lib/ratio.js';

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const format = (number) => new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 2 }).format(number);
const money = (number) => `${format(number)}만원`;
// Fixed fictional transactions. Not generated from or matched to user-entered prices/names.
const mockTrades = [
  { name: '가상 단지', area: 82, price: 48000 },
  { name: '가상 단지', area: 84, price: 51000 },
  { name: '가상 단지', area: 84.5, price: 53000 },
  { name: '가상 단지', area: 83, price: 56000 },
  { name: '가상 단지', area: 85, price: 58000 },
  { name: '가상 단지', area: 84, price: 60000 },
  { name: '가상 단지', area: 84, price: 60000 },
  { name: '가상 단지', area: 86, price: 62000 },
  { name: '가상 단지', area: 83.5, price: 64000 },
  { name: '가상 단지', area: 84, price: 66000 },
  { name: '가상 단지', area: 85, price: 68000 },
  { name: '가상 단지', area: 84, price: 72000 },
  { name: '가상 단지', area: 59, price: 39000 },
  { name: '가상 단지', area: 59.5, price: 41000 },
];
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

function validate(number) {
  clearError();
  if (number === 1) {
    if (!regions.length) return fail('#sido-select', '지역 정보를 불러오지 못했습니다. 페이지를 새로고침해 주세요.');
    const group = regions.find((entry) => entry.sido === $('#sido-select').value);
    if (!group) return fail('#sido-select', '시도를 선택해 주세요.');
    if (!group.items.some((item) => item.code === $('#district-select').value)) return fail('#district-select', '시군구를 선택해 주세요.');
  }
  if (number === 2 && !$('#apartment-input').value.trim()) return fail('#apartment-input', '아파트 단지명을 입력해 주세요.');
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
  contract = {
    sido: group.sido, district: district.name, lawdCd: district.code,
    apartment: $('#apartment-input').value.trim(), area: Number($('#area-input').value),
    deposit: Number($('#deposit-input').value), rent: Number($('#rent-input').value),
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
  clearError();
});
$('#new-diagnosis').addEventListener('click', () => {
  contract = null;
  step = 1;
  $('#diagnosis-form').reset();
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

function renderResult() {
  const result = jeonseRatio(contract.deposit, mockTrades, contract.area);
  const decision = verdict(result);
  const size = similarPrices(mockTrades, contract.area).length;
  const stats = tradeDistribution(mockTrades, contract.area);
  // User-provided text is never inserted as HTML.
  $('#contract-summary').textContent = `${contract.sido} ${contract.district === contract.sido ? '' : contract.district} · ${contract.apartment} · 전용 ${format(contract.area)}㎡ · ${contract.rent === 0 ? '전세' : '월세'} · 보증금 ${money(contract.deposit)}${contract.rent > 0 ? ` · 월세 ${money(contract.rent)}` : ''}`;
  $('#monthly-rent-note').hidden = contract.rent === 0;
  $('#sample-count').textContent = `표본 ${size}건`;
  $('#ratio-card').dataset.verdict = decision.level;
  if (decision.level === 'unknown') {
    $('#ratio-content').innerHTML = `<div class="unknown-state"><span class="unknown-symbol" aria-hidden="true">—</span><h3>표본 부족 — 판정 불가</h3><p>유사 면적 매매 거래 표본 ${size}건<br>표본 3건 미만으로 전세가율을 표시하지 않습니다.</p></div><p class="ratio-warning">표본을 늘리려고 면적 범위를 넓히거나 가격을 추정하지 않습니다.</p>`;
    $('#distribution-content').innerHTML = '<div class="unknown-state"><span class="unknown-symbol" aria-hidden="true">—</span><h3>거래 분포를 표시할 수 없습니다</h3><p>표본 3건 이상이 필요합니다.<br>매매가격 통계와 보증금 위치를 표시하지 않습니다.</p></div>';
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
