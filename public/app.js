'use strict';

const $ = (s) => document.querySelector(s);
const MONTHS = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];
const BEAD_RINGS = ['#6d8fd6', '#e8835a', '#7bb37a', '#d16ba5', '#e3b23c', '#4fb3a9'];
const RED_LINE = 100000; // 하루 지출이 이 금액 이상이면 빨간색

const state = {
  data: { categories: [], entries: [], backgrounds: {} },
  view: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  selected: ymd(new Date()),
  scope: 'day',          // 요약: 'day' | 'month'
  formType: 'expense',
  editingId: null,
  signup: false,
};

// ---------- 유틸 ----------
function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const monthKey = (d) => ymd(d).slice(0, 7);
const won = (n) => `${n.toLocaleString('ko-KR')}원`;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const catById = (id) => state.data.categories.find((c) => c.id === id);

async function api(path, opts = {}) {
  const res = await fetch(path, {
    method: opts.method || 'GET',
    headers: opts.raw ? {} : { 'Content-Type': 'application/json' },
    body: opts.raw || (opts.body ? JSON.stringify(opts.body) : undefined),
    credentials: 'same-origin',
  });
  const json = await res.json().catch(() => ({}));
  if (res.status === 401 && !path.startsWith('/api/login')) { showAuth(); throw new Error(json.error || '로그인이 필요합니다.'); }
  if (!res.ok) throw new Error(json.error || '요청에 실패했습니다.');
  return json;
}

function beads(el, text) {
  el.innerHTML = '';
  [...text].forEach((ch, i) => {
    const b = document.createElement('span');
    b.className = ch === ' ' ? 'bead space' : 'bead';
    b.textContent = ch;
    b.style.setProperty('--ring', BEAD_RINGS[i % BEAD_RINGS.length]);
    b.style.transform = `translateY(${(i % 3 - 1) * 4}px)`;
    el.appendChild(b);
  });
}

// ---------- 인증 ----------
function showAuth() {
  $('#app').classList.add('hidden');
  $('#auth').classList.remove('hidden');
  setBackground(null);
}
function renderAuthMode() {
  $('#authSubmit').textContent = state.signup ? '회원가입' : '로그인';
  $('#authToggle').textContent = state.signup ? '이미 계정이 있으신가요? 로그인' : '계정이 없으신가요? 회원가입';
  $('#authPass').autocomplete = state.signup ? 'new-password' : 'current-password';
  $('#authError').textContent = '';
}
$('#authToggle').addEventListener('click', () => { state.signup = !state.signup; renderAuthMode(); });
$('#authForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#authError').textContent = '';
  try {
    const me = await api(state.signup ? '/api/signup' : '/api/login', {
      method: 'POST', body: { username: $('#authUser').value, password: $('#authPass').value },
    });
    $('#authPass').value = '';
    await enterApp(me.username);
  } catch (err) { $('#authError').textContent = err.message; }
});
$('#logoutBtn').addEventListener('click', async () => {
  await api('/api/logout', { method: 'POST' }).catch(() => {});
  showAuth();
});

async function enterApp(username) {
  $('#userName').textContent = username;
  state.data = await api('/api/data');
  $('#auth').classList.add('hidden');
  $('#app').classList.remove('hidden');
  $('#entryDate').value = state.selected;
  render();
}

// ---------- 집계 ----------
function sumEntries(entries) {
  const out = { income: 0, expense: 0, byCat: new Map() };
  for (const e of entries) {
    out[e.type] += e.amount;
    out.byCat.set(e.categoryId, (out.byCat.get(e.categoryId) || 0) + e.amount);
  }
  return out;
}
function entriesFor(scope) {
  const key = scope === 'day' ? state.selected : monthKey(state.view);
  return state.data.entries.filter((e) => e.date.startsWith(key));
}

// ---------- 렌더 ----------
function render() {
  renderCalendar();
  renderSummary();
  renderList();
  renderCategorySelect();
  renderCategories();
  renderBackground();
}

function setBackground(url) {
  $('#bg').style.backgroundImage = url ? `url("${url}")` : '';
}
function renderBackground() {
  const key = monthKey(state.view);
  const bgs = state.data.backgrounds || {};
  const useKey = bgs[key] ? key : bgs.default ? 'default' : null;
  setBackground(useKey ? `/api/backgrounds/${useKey}?v=${encodeURIComponent(bgs[useKey])}` : null);
  $('#bgMonthLabel').textContent = `${state.view.getMonth() + 1}월 사진${bgs[key] ? ' ✓' : ''}`;
}

function renderCalendar() {
  const y = state.view.getFullYear();
  const m = state.view.getMonth();
  beads($('#monthBeads'), MONTHS[m]);
  $('#yearLabel').textContent = y;

  // 날짜별 합계
  const prefix = monthKey(state.view);
  const daily = {};
  for (const e of state.data.entries) {
    if (!e.date.startsWith(prefix)) continue;
    daily[e.date] ??= { income: 0, expense: 0 };
    daily[e.date][e.type] += e.amount;
  }

  const cal = $('#calendar');
  cal.innerHTML = '';
  const lead = (new Date(y, m, 1).getDay() + 6) % 7; // 월요일 시작
  const days = new Date(y, m + 1, 0).getDate();
  const today = ymd(new Date());

  for (let i = 0; i < lead; i++) {
    const d = document.createElement('div');
    d.className = 'day empty';
    cal.appendChild(d);
  }
  for (let day = 1; day <= days; day++) {
    const date = ymd(new Date(y, m, day));
    const t = daily[date];
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'day';
    if (date === today) btn.classList.add('today');
    if (date === state.selected) btn.classList.add('selected');
    if (t) btn.classList.add('has-data');
    if (t && t.expense >= RED_LINE) btn.classList.add('over');
    btn.innerHTML = `<span class="num">${String(day).padStart(2, '0')}</span>`
      + (t && t.income ? `<span class="amt inc">+${t.income.toLocaleString('ko-KR')}</span>` : '')
      + (t && t.expense ? `<span class="amt exp">-${t.expense.toLocaleString('ko-KR')}</span>` : '');
    btn.setAttribute('aria-label', `${m + 1}월 ${day}일`);
    btn.addEventListener('click', () => selectDate(date));
    cal.appendChild(btn);
  }
}

function selectDate(date) {
  state.selected = date;
  state.scope = 'day';
  if (!state.editingId) $('#entryDate').value = date;
  syncTabs();
  render();
}

function syncTabs() {
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.scope === state.scope));
}
document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => {
  state.scope = t.dataset.scope;
  syncTabs();
  renderSummary();
  renderList();
}));

function scopeLabel(scope) {
  if (scope === 'day') {
    const [y, m, d] = state.selected.split('-').map(Number);
    const wd = '일월화수목금토'[new Date(y, m - 1, d).getDay()];
    return `${m}월 ${d}일 (${wd})`;
  }
  return `${state.view.getFullYear()}년 ${state.view.getMonth() + 1}월`;
}

function catBreakdown(type, s) {
  const total = s[type];
  const rows = state.data.categories
    .filter((c) => c.type === type && s.byCat.get(c.id))
    .map((c) => ({ c, v: s.byCat.get(c.id) }))
    .sort((a, b) => b.v - a.v);
  if (!rows.length) return '';
  return `<p class="sub-head">${type === 'expense' ? '지출' : '수입'} 카테고리별</p><ul class="cat-sum">`
    + rows.map(({ c, v }) => `<li><div class="top"><span>${esc(c.name)}</span><b>${won(v)}</b></div>`
      + `<div class="bar"><i style="width:${(v / total) * 100}%;background:${c.color}"></i></div></li>`).join('')
    + '</ul>';
}

function renderSummary() {
  const s = sumEntries(entriesFor(state.scope));
  const over = state.scope === 'day' && s.expense >= RED_LINE;
  const net = s.income - s.expense;
  $('#summary').innerHTML = `
    <p class="summary-title">${scopeLabel(state.scope)}</p>
    <div class="totals">
      <div class="total inc"><small>총 수입</small><b>${won(s.income)}</b></div>
      <div class="total exp${over ? ' over' : ''}"><small>총 지출</small><b>${won(s.expense)}</b></div>
      <div class="total"><small>합계</small><b>${net >= 0 ? '+' : ''}${won(net)}</b></div>
    </div>
    ${catBreakdown('expense', s)}${catBreakdown('income', s)}
    ${!s.income && !s.expense ? '<p class="empty-msg">아직 기록이 없어요.</p>' : ''}`;
}

function renderList() {
  const list = entriesFor(state.scope).slice()
    .sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || 0) - (a.createdAt || 0));
  $('#listTitle').textContent = `${scopeLabel(state.scope)} 내역 (${list.length})`;
  const ul = $('#entryList');
  ul.innerHTML = list.length ? '' : '<li class="empty-msg">내역이 없어요.</li>';
  for (const e of list) {
    const c = catById(e.categoryId) || { name: '(삭제됨)', color: '#999' };
    const li = document.createElement('li');
    li.className = 'entry';
    const dateTag = state.scope === 'month' ? `${Number(e.date.slice(8))}일 · ` : '';
    li.innerHTML = `
      <span class="swatch" style="background:${c.color}"></span>
      <div class="info"><div class="cat">${dateTag}${esc(c.name)}</div><div class="memo">${esc(e.memo || '')}</div></div>
      <div class="right">
        <div class="money ${e.type === 'income' ? 'inc' : 'exp'}">${e.type === 'income' ? '+' : '-'}${won(e.amount)}</div>
        <div class="acts"><button class="link" data-act="edit">수정</button><button class="link" data-act="del">삭제</button></div>
      </div>`;
    li.querySelector('[data-act=edit]').addEventListener('click', () => startEdit(e));
    li.querySelector('[data-act=del]').addEventListener('click', async () => {
      if (!confirm('이 기록을 삭제할까요?')) return;
      try {
        await api(`/api/entries/${e.id}`, { method: 'DELETE' });
        state.data.entries = state.data.entries.filter((x) => x.id !== e.id);
        if (state.editingId === e.id) resetForm();
        render();
      } catch (err) { alert(err.message); }
    });
    ul.appendChild(li);
  }
}

// ---------- 기록 폼 ----------
function setFormType(type) {
  state.formType = type;
  document.querySelectorAll('.seg').forEach((s) => s.classList.toggle('active', s.dataset.type === type));
  renderCategorySelect();
}
document.querySelectorAll('.seg').forEach((s) => s.addEventListener('click', () => setFormType(s.dataset.type)));

function renderCategorySelect(selectedId) {
  const sel = $('#entryCategory');
  const keep = selectedId || sel.value;
  const cats = state.data.categories.filter((c) => c.type === state.formType);
  sel.innerHTML = cats.length ? '' : '<option value="">카테고리를 먼저 추가해 주세요</option>';
  for (const c of cats) {
    const o = document.createElement('option');
    o.value = c.id;
    o.textContent = c.name;
    sel.appendChild(o);
  }
  if (cats.some((c) => c.id === keep)) sel.value = keep;
}

// 금액 입력 시 자동 콤마
$('#entryAmount').addEventListener('input', (e) => {
  const n = e.target.value.replace(/[^\d]/g, '');
  e.target.value = n ? Number(n).toLocaleString('ko-KR') : '';
});

function startEdit(e) {
  state.editingId = e.id;
  setFormType(e.type);
  renderCategorySelect(e.categoryId);
  $('#entryDate').value = e.date;
  $('#entryAmount').value = e.amount.toLocaleString('ko-KR');
  $('#entryMemo').value = e.memo || '';
  $('#formTitle').textContent = '기록 수정';
  $('#entrySubmit').textContent = '저장';
  $('#entryCancel').classList.remove('hidden');
  $('#entryAmount').focus();
}
function resetForm() {
  state.editingId = null;
  $('#entryAmount').value = '';
  $('#entryMemo').value = '';
  $('#entryDate').value = state.selected;
  $('#formTitle').textContent = '기록하기';
  $('#entrySubmit').textContent = '추가';
  $('#entryCancel').classList.add('hidden');
  $('#entryError').textContent = '';
}
$('#entryCancel').addEventListener('click', resetForm);

$('#entryForm').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  $('#entryError').textContent = '';
  const body = {
    date: $('#entryDate').value,
    type: state.formType,
    categoryId: $('#entryCategory').value,
    amount: Number($('#entryAmount').value.replace(/[^\d]/g, '')),
    memo: $('#entryMemo').value.trim(),
  };
  try {
    if (state.editingId) {
      const updated = await api(`/api/entries/${state.editingId}`, { method: 'PUT', body });
      state.data.entries = state.data.entries.map((x) => (x.id === updated.id ? updated : x));
    } else {
      state.data.entries.push(await api('/api/entries', { method: 'POST', body }));
    }
    // 기록한 날짜로 이동
    state.selected = body.date;
    const [y, m] = body.date.split('-').map(Number);
    state.view = new Date(y, m - 1, 1);
    resetForm();
    render();
    $('#entryAmount').focus();
  } catch (err) { $('#entryError').textContent = err.message; }
});

// ---------- 카테고리 설정 ----------
function renderCategories() {
  const ul = $('#catList');
  ul.innerHTML = '';
  const sorted = [...state.data.categories].sort((a, b) => (a.type === b.type ? 0 : a.type === 'expense' ? -1 : 1));
  for (const c of sorted) {
    const li = document.createElement('li');
    li.innerHTML = `
      <input type="color" value="${c.color}" aria-label="색상" />
      <input value="${esc(c.name)}" maxlength="30" aria-label="이름" />
      <span class="type-badge ${c.type}">${c.type === 'expense' ? '지출' : '수입'}</span>
      <button class="btn small" title="삭제">✕</button>`;
    const [color, name] = li.querySelectorAll('input');
    const save = async () => {
      if (name.value.trim() === c.name && color.value === c.color) return;
      try {
        const u = await api(`/api/categories/${c.id}`, { method: 'PUT', body: { name: name.value, color: color.value, type: c.type } });
        Object.assign(c, u);
        $('#catError').textContent = '';
        renderCalendar(); renderSummary(); renderList(); renderCategorySelect();
      } catch (err) { $('#catError').textContent = err.message; name.value = c.name; color.value = c.color; }
    };
    name.addEventListener('change', save);
    color.addEventListener('change', save);
    li.querySelector('button').addEventListener('click', async () => {
      if (!confirm(`'${c.name}' 카테고리를 삭제할까요?`)) return;
      try {
        await api(`/api/categories/${c.id}`, { method: 'DELETE' });
        state.data.categories = state.data.categories.filter((x) => x.id !== c.id);
        $('#catError').textContent = '';
        render();
      } catch (err) { $('#catError').textContent = err.message; }
    });
    ul.appendChild(li);
  }
}
$('#catForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const c = await api('/api/categories', { method: 'POST', body: { name: $('#catName').value, type: $('#catType').value, color: $('#catColor').value } });
    state.data.categories.push(c);
    $('#catName').value = '';
    $('#catError').textContent = '';
    render();
  } catch (err) { $('#catError').textContent = err.message; }
});

// ---------- 배경 사진 ----------
async function uploadBg(key, file) {
  $('#bgError').textContent = '';
  if (!file) return;
  if (file.size > 15 * 1024 * 1024) { $('#bgError').textContent = '15MB 이하의 사진만 올릴 수 있어요.'; return; }
  try {
    const r = await api(`/api/backgrounds/${key}`, { method: 'PUT', raw: file });
    state.data.backgrounds[key] = r.file;
    renderBackground();
  } catch (err) { $('#bgError').textContent = err.message; }
}
async function removeBg(key) {
  try {
    await api(`/api/backgrounds/${key}`, { method: 'DELETE' });
    delete state.data.backgrounds[key];
    renderBackground();
  } catch (err) { $('#bgError').textContent = err.message; }
}
$('#bgMonthFile').addEventListener('change', (e) => { uploadBg(monthKey(state.view), e.target.files[0]); e.target.value = ''; });
$('#bgDefaultFile').addEventListener('change', (e) => { uploadBg('default', e.target.files[0]); e.target.value = ''; });
$('#bgMonthRemove').addEventListener('click', () => removeBg(monthKey(state.view)));
$('#bgDefaultRemove').addEventListener('click', () => removeBg('default'));

// ---------- 달 이동 ----------
function moveMonth(delta) {
  state.view = new Date(state.view.getFullYear(), state.view.getMonth() + delta, 1);
  // 선택 날짜도 그 달 안으로 맞춤
  if (!state.selected.startsWith(monthKey(state.view))) state.selected = ymd(state.view);
  if (!state.editingId) $('#entryDate').value = state.selected;
  render();
}
$('#prevMonth').addEventListener('click', () => moveMonth(-1));
$('#nextMonth').addEventListener('click', () => moveMonth(1));
$('#todayBtn').addEventListener('click', () => {
  const now = new Date();
  state.view = new Date(now.getFullYear(), now.getMonth(), 1);
  selectDate(ymd(now));
});
document.addEventListener('keydown', (e) => {
  if (e.target.matches('input, select, textarea')) return;
  if (e.key === 'ArrowLeft') moveMonth(-1);
  if (e.key === 'ArrowRight') moveMonth(1);
});

// ---------- 시작 ----------
beads($('#authForm .beads'), 'BUDGET BOOK');
renderAuthMode();
api('/api/me').then((me) => enterApp(me.username)).catch(() => showAuth());
