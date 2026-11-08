'use strict';

const $ = (s) => document.querySelector(s);
const MONTHS = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];
const BEAD_RINGS = ['#6d8fd6', '#e8835a', '#7bb37a', '#d16ba5', '#e3b23c', '#4fb3a9'];
const RED_LINE = 100000; // 하루 지출이 이 금액 이상이면 빨간색
const BUCKET = 'backgrounds';

const { SUPABASE_URL, SUPABASE_KEY } = window.BUDGET_CONFIG;
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const state = {
  user: null,
  categories: [],
  entries: [],          // 현재 보고 있는 달의 기록만
  backgrounds: {},      // { 'YYYY-MM' | 'default': storage path }
  bgUrls: {},           // { path: signed url }
  view: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  selected: ymd(new Date()),
  scope: 'day',         // 요약: 'day' | 'month'
  formType: 'expense',
  editingId: null,
  signup: false,
  loadSeq: 0,
};

// ---------- 유틸 ----------
function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const monthKey = (d) => ymd(d).slice(0, 7);
const won = (n) => `${n.toLocaleString('ko-KR')}원`;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const catById = (id) => state.categories.find((c) => c.id === id);
const toEntry = (r) => ({ id: r.id, date: r.date, type: r.type, categoryId: r.category_id, amount: Number(r.amount), memo: r.memo || '', createdAt: r.created_at });

// Supabase 오류 → 한국어 메시지
function korean(err) {
  const msg = (err && (err.message || err.error_description)) || String(err);
  const code = err && err.code;
  if (code === '23503') return '이 카테고리로 작성된 기록이 있어 삭제할 수 없습니다. 기록을 먼저 옮기거나 지워 주세요.';
  if (code === '42501' || /row-level security/i.test(msg)) return '권한이 없습니다. 다시 로그인해 주세요.';
  if (code === '42P01' || /relation .* does not exist|Could not find the table/i.test(msg)) return '데이터베이스가 아직 준비되지 않았습니다. supabase/schema.sql 을 먼저 실행해 주세요.';
  if (/Invalid login credentials/i.test(msg)) return '이메일 또는 비밀번호가 올바르지 않습니다.';
  if (/Email not confirmed/i.test(msg)) return '이메일 인증이 아직 완료되지 않았습니다. 메일함을 확인해 주세요.';
  if (/already registered|already been registered/i.test(msg)) return '이미 가입된 이메일입니다.';
  if (/Password should be at least/i.test(msg)) return '비밀번호는 6자 이상이어야 합니다.';
  if (/Signups not allowed/i.test(msg)) return '현재 새 회원가입이 막혀 있습니다.';
  if (/rate limit/i.test(msg)) return '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.';
  if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) return '서버에 연결할 수 없습니다. 인터넷 연결을 확인해 주세요.';
  if (/exceeded the maximum allowed size|Payload too large/i.test(msg)) return '15MB 이하의 사진만 올릴 수 있어요.';
  if (/mime type/i.test(msg)) return 'JPG, PNG, WEBP, GIF, HEIC 이미지만 올릴 수 있어요.';
  return msg;
}
function must({ data, error }) {
  if (error) throw error;
  return data;
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
  state.user = null;
  $('#app').classList.add('hidden');
  $('#auth').classList.remove('hidden');
  setBackground(null);
}
function renderAuthMode() {
  $('#authSubmit').textContent = state.signup ? '회원가입' : '로그인';
  $('#authToggle').textContent = state.signup ? '이미 계정이 있으신가요? 로그인' : '계정이 없으신가요? 회원가입';
  $('#authPass').autocomplete = state.signup ? 'new-password' : 'current-password';
  $('#authError').textContent = '';
  $('#authInfo').textContent = '';
}
$('#authToggle').addEventListener('click', () => { state.signup = !state.signup; renderAuthMode(); });
$('#authForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#authError').textContent = '';
  $('#authInfo').textContent = '';
  const email = $('#authUser').value.trim();
  const password = $('#authPass').value;
  $('#authSubmit').disabled = true;
  try {
    if (state.signup) {
      const data = must(await sb.auth.signUp({
        email, password, options: { emailRedirectTo: location.origin + location.pathname },
      }));
      if (!data.session) {
        $('#authInfo').textContent = '가입 확인 메일을 보냈어요. 메일의 링크를 누른 뒤 로그인해 주세요.';
        state.signup = false;
        $('#authSubmit').textContent = '로그인';
        $('#authToggle').textContent = '계정이 없으신가요? 회원가입';
      }
    } else {
      must(await sb.auth.signInWithPassword({ email, password }));
    }
    $('#authPass').value = '';
  } catch (err) {
    $('#authError').textContent = korean(err);
  } finally {
    $('#authSubmit').disabled = false;
  }
});
$('#logoutBtn').addEventListener('click', async () => {
  await sb.auth.signOut().catch(() => {});
  showAuth();
});

// 로그인 상태 변화 감지 (콜백 안에서 바로 await 하지 않도록 setTimeout 사용)
sb.auth.onAuthStateChange((event, session) => {
  setTimeout(() => {
    if (session && session.user) {
      if (!state.user || state.user.id !== session.user.id) enterApp(session.user);
    } else if (state.user || event === 'INITIAL_SESSION' || event === 'SIGNED_OUT') {
      showAuth();
    }
  }, 0);
});

async function enterApp(user) {
  state.user = user;
  $('#userName').textContent = user.email || '';
  $('#auth').classList.add('hidden');
  $('#app').classList.remove('hidden');
  $('#entryDate').value = state.selected;
  try {
    const [cats, bgs] = await Promise.all([
      sb.from('categories').select('*').order('created_at').then(must),
      sb.from('backgrounds').select('*').then(must),
    ]);
    state.categories = cats;
    state.backgrounds = Object.fromEntries(bgs.map((b) => [b.key, b.path]));
    await loadMonth();
  } catch (err) {
    alert(korean(err));
  }
}

// 보고 있는 달의 기록 불러오기
async function loadMonth() {
  const seq = ++state.loadSeq;
  const y = state.view.getFullYear();
  const m = state.view.getMonth();
  const from = ymd(new Date(y, m, 1));
  const to = ymd(new Date(y, m + 1, 0));
  render(); // 먼저 달력 틀을 그려 둠
  try {
    const rows = await sb.from('entries').select('*').gte('date', from).lte('date', to)
      .order('date').order('created_at').then(must);
    if (seq !== state.loadSeq) return; // 그새 다른 달로 이동함
    state.entries = rows.map(toEntry);
    render();
  } catch (err) {
    if (seq === state.loadSeq) alert(korean(err));
  }
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
  return state.entries.filter((e) => e.date.startsWith(key));
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
async function renderBackground() {
  const key = monthKey(state.view);
  const bgs = state.backgrounds;
  $('#bgMonthLabel').textContent = `${state.view.getMonth() + 1}월 사진${bgs[key] ? ' ✓' : ''}`;
  const path = bgs[key] || bgs.default;
  if (!path) { setBackground(null); return; }
  if (!state.bgUrls[path]) {
    const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(path, 60 * 60 * 24);
    if (error) { setBackground(null); return; }
    state.bgUrls[path] = data.signedUrl;
  }
  // 그 사이 달이 바뀌었으면 무시
  if ((state.backgrounds[monthKey(state.view)] || state.backgrounds.default) === path) setBackground(state.bgUrls[path]);
}

function renderCalendar() {
  const y = state.view.getFullYear();
  const m = state.view.getMonth();
  beads($('#monthBeads'), MONTHS[m]);
  $('#yearLabel').textContent = y;

  const daily = {};
  for (const e of state.entries) {
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
  const rows = state.categories
    .filter((c) => c.type === type && s.byCat.get(c.id))
    .map((c) => ({ c, v: s.byCat.get(c.id) }))
    .sort((a, b) => b.v - a.v);
  if (!rows.length) return '';
  return `<p class="sub-head">${type === 'expense' ? '지출' : '수입'} 카테고리별</p><ul class="cat-sum">`
    + rows.map(({ c, v }) => `<li><div class="top"><span>${esc(c.name)}</span><b>${won(v)}</b></div>`
      + `<div class="bar"><i style="width:${(v / total) * 100}%;background:${esc(c.color)}"></i></div></li>`).join('')
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
    .sort((a, b) => b.date.localeCompare(a.date) || String(b.createdAt).localeCompare(String(a.createdAt)));
  $('#listTitle').textContent = `${scopeLabel(state.scope)} 내역 (${list.length})`;
  const ul = $('#entryList');
  ul.innerHTML = list.length ? '' : '<li class="empty-msg">내역이 없어요.</li>';
  for (const e of list) {
    const c = catById(e.categoryId) || { name: '(삭제됨)', color: '#999999' };
    const li = document.createElement('li');
    li.className = 'entry';
    const dateTag = state.scope === 'month' ? `${Number(e.date.slice(8))}일 · ` : '';
    li.innerHTML = `
      <span class="swatch" style="background:${esc(c.color)}"></span>
      <div class="info"><div class="cat">${dateTag}${esc(c.name)}</div><div class="memo">${esc(e.memo)}</div></div>
      <div class="right">
        <div class="money ${e.type === 'income' ? 'inc' : 'exp'}">${e.type === 'income' ? '+' : '-'}${won(e.amount)}</div>
        <div class="acts"><button class="link" data-act="edit">수정</button><button class="link" data-act="del">삭제</button></div>
      </div>`;
    li.querySelector('[data-act=edit]').addEventListener('click', () => startEdit(e));
    li.querySelector('[data-act=del]').addEventListener('click', async () => {
      if (!confirm('이 기록을 삭제할까요?')) return;
      try {
        must(await sb.from('entries').delete().eq('id', e.id));
        state.entries = state.entries.filter((x) => x.id !== e.id);
        if (state.editingId === e.id) resetForm();
        render();
      } catch (err) { alert(korean(err)); }
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
  const cats = state.categories.filter((c) => c.type === state.formType);
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
  const date = $('#entryDate').value;
  const amount = Number($('#entryAmount').value.replace(/[^\d]/g, ''));
  const categoryId = $('#entryCategory').value;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { $('#entryError').textContent = '날짜를 선택해 주세요.'; return; }
  if (!amount || amount <= 0) { $('#entryError').textContent = '금액을 입력해 주세요.'; return; }
  if (!categoryId) { $('#entryError').textContent = '카테고리를 선택해 주세요.'; return; }
  const row = { date, type: state.formType, category_id: categoryId, amount, memo: $('#entryMemo').value.trim().slice(0, 200) };
  $('#entrySubmit').disabled = true;
  try {
    if (state.editingId) {
      must(await sb.from('entries').update(row).eq('id', state.editingId).select().single());
    } else {
      must(await sb.from('entries').insert(row).select().single());
    }
    // 기록한 날짜(의 달)로 이동 후 다시 불러오기
    state.selected = date;
    const [y, m] = date.split('-').map(Number);
    state.view = new Date(y, m - 1, 1);
    resetForm();
    await loadMonth();
    $('#entryAmount').focus();
  } catch (err) {
    $('#entryError').textContent = korean(err);
  } finally {
    $('#entrySubmit').disabled = false;
  }
});

// ---------- 카테고리 설정 ----------
function renderCategories() {
  const ul = $('#catList');
  ul.innerHTML = '';
  const sorted = [...state.categories].sort((a, b) => (a.type === b.type ? 0 : a.type === 'expense' ? -1 : 1));
  for (const c of sorted) {
    const li = document.createElement('li');
    li.innerHTML = `
      <input type="color" value="${esc(c.color)}" aria-label="색상" />
      <input value="${esc(c.name)}" maxlength="30" aria-label="이름" />
      <span class="type-badge ${c.type === 'income' ? 'income' : 'expense'}">${c.type === 'income' ? '수입' : '지출'}</span>
      <button class="btn small" title="삭제">✕</button>`;
    const [color, name] = li.querySelectorAll('input');
    const save = async () => {
      const newName = name.value.trim();
      if (!newName) { name.value = c.name; return; }
      if (newName === c.name && color.value === c.color) return;
      try {
        const u = must(await sb.from('categories').update({ name: newName, color: color.value }).eq('id', c.id).select().single());
        Object.assign(c, u);
        $('#catError').textContent = '';
        renderCalendar(); renderSummary(); renderList(); renderCategorySelect();
      } catch (err) { $('#catError').textContent = korean(err); name.value = c.name; color.value = c.color; }
    };
    name.addEventListener('change', save);
    color.addEventListener('change', save);
    li.querySelector('button').addEventListener('click', async () => {
      if (!confirm(`'${c.name}' 카테고리를 삭제할까요?`)) return;
      try {
        must(await sb.from('categories').delete().eq('id', c.id));
        state.categories = state.categories.filter((x) => x.id !== c.id);
        $('#catError').textContent = '';
        render();
      } catch (err) { $('#catError').textContent = korean(err); }
    });
    ul.appendChild(li);
  }
}
$('#catForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = $('#catName').value.trim();
  if (!name) return;
  try {
    const c = must(await sb.from('categories')
      .insert({ name, type: $('#catType').value, color: $('#catColor').value }).select().single());
    state.categories.push(c);
    $('#catName').value = '';
    $('#catError').textContent = '';
    render();
  } catch (err) { $('#catError').textContent = korean(err); }
});

// ---------- 배경 사진 ----------
async function uploadBg(key, file) {
  $('#bgError').textContent = '';
  if (!file) return;
  if (file.size > 15 * 1024 * 1024) { $('#bgError').textContent = '15MB 이하의 사진만 올릴 수 있어요.'; return; }
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
  const path = `${state.user.id}/${key}-${Date.now()}.${ext}`;
  const old = state.backgrounds[key];
  try {
    $('#bgMonthLabel').textContent = '업로드 중…';
    must(await sb.storage.from(BUCKET).upload(path, file, { contentType: file.type || undefined, upsert: false }));
    must(await sb.from('backgrounds').upsert({ user_id: state.user.id, key, path }));
    state.backgrounds[key] = path;
    if (old) await sb.storage.from(BUCKET).remove([old]);
  } catch (err) {
    $('#bgError').textContent = korean(err);
  }
  renderBackground();
}
async function removeBg(key) {
  const path = state.backgrounds[key];
  if (!path) return;
  try {
    must(await sb.from('backgrounds').delete().eq('key', key));
    await sb.storage.from(BUCKET).remove([path]);
    delete state.backgrounds[key];
    renderBackground();
  } catch (err) { $('#bgError').textContent = korean(err); }
}
$('#bgMonthFile').addEventListener('change', (e) => { uploadBg(monthKey(state.view), e.target.files[0]); e.target.value = ''; });
$('#bgDefaultFile').addEventListener('change', (e) => { uploadBg('default', e.target.files[0]); e.target.value = ''; });
$('#bgMonthRemove').addEventListener('click', () => removeBg(monthKey(state.view)));
$('#bgDefaultRemove').addEventListener('click', () => removeBg('default'));

// ---------- 달 이동 ----------
function moveMonth(delta) {
  state.view = new Date(state.view.getFullYear(), state.view.getMonth() + delta, 1);
  if (!state.selected.startsWith(monthKey(state.view))) state.selected = ymd(state.view);
  if (!state.editingId) $('#entryDate').value = state.selected;
  state.entries = [];
  loadMonth();
}
$('#prevMonth').addEventListener('click', () => moveMonth(-1));
$('#nextMonth').addEventListener('click', () => moveMonth(1));
$('#todayBtn').addEventListener('click', () => {
  const now = new Date();
  const sameMonth = monthKey(now) === monthKey(state.view);
  state.view = new Date(now.getFullYear(), now.getMonth(), 1);
  state.selected = ymd(now);
  state.scope = 'day';
  syncTabs();
  if (!state.editingId) $('#entryDate').value = state.selected;
  if (sameMonth) render(); else { state.entries = []; loadMonth(); }
});
document.addEventListener('keydown', (e) => {
  if (e.target.matches('input, select, textarea')) return;
  if (e.key === 'ArrowLeft') moveMonth(-1);
  if (e.key === 'ArrowRight') moveMonth(1);
});

// ---------- 시작 ----------
beads($('#authForm .beads'), 'BUDGET BOOK');
renderAuthMode();
