// 가계부 서버 — Node.js 내장 모듈만 사용 (npm install 불필요)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const DATA_DIR = path.join(__dirname, 'data');
const PUBLIC_DIR = path.join(__dirname, 'public');
const BG_DIR = path.join(DATA_DIR, 'backgrounds');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');
const SESSION_TTL = 1000 * 60 * 60 * 24 * 30; // 30일
const MAX_JSON = 1024 * 1024;
const MAX_IMAGE = 15 * 1024 * 1024;

fs.mkdirSync(BG_DIR, { recursive: true });

// ---------- 저장소 ----------
function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJSON(file, data) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

let users = readJSON(USERS_FILE, {});       // { username: { id, salt, hash, createdAt } }
let sessions = readJSON(SESSIONS_FILE, {}); // { token: { userId, expires } }

const userFile = (id) => path.join(DATA_DIR, `user-${id}.json`);

const DEFAULT_CATEGORIES = [
  { name: '식비', type: 'expense', color: '#e8835a' },
  { name: '카페/간식', type: 'expense', color: '#c49a6c' },
  { name: '교통', type: 'expense', color: '#5a8de8' },
  { name: '쇼핑', type: 'expense', color: '#d16ba5' },
  { name: '생활/주거', type: 'expense', color: '#7bb37a' },
  { name: '문화/여가', type: 'expense', color: '#9b7be8' },
  { name: '기타', type: 'expense', color: '#8a8a8a' },
  { name: '월급', type: 'income', color: '#2e9e6b' },
  { name: '부수입', type: 'income', color: '#4fb3a9' },
];

function loadUserData(id) {
  const d = readJSON(userFile(id), null);
  if (d) return d;
  const fresh = {
    categories: DEFAULT_CATEGORIES.map((c) => ({ id: crypto.randomUUID(), ...c })),
    entries: [],
    backgrounds: {},
  };
  writeJSON(userFile(id), fresh);
  return fresh;
}
const saveUserData = (id, d) => writeJSON(userFile(id), d);

function pruneSessions() {
  const now = Date.now();
  for (const [t, s] of Object.entries(sessions)) if (s.expires < now) delete sessions[t];
}

// ---------- 비밀번호 ----------
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}
function verifyPassword(password, salt, hash) {
  const h = crypto.scryptSync(password, salt, 64);
  return crypto.timingSafeEqual(h, Buffer.from(hash, 'hex'));
}

// ---------- HTTP 도우미 ----------
function send(res, status, body, headers = {}) {
  const isJSON = typeof body === 'object' && !Buffer.isBuffer(body);
  res.writeHead(status, {
    'Content-Type': isJSON ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  res.end(isJSON ? JSON.stringify(body) : body);
}
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(Object.assign(new Error('too large'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
async function readJSONBody(req) {
  const buf = await readBody(req, MAX_JSON);
  try { return JSON.parse(buf.toString('utf8') || '{}'); }
  catch { throw Object.assign(new Error('잘못된 요청입니다.'), { status: 400 }); }
}
function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}
function getSession(req) {
  const token = parseCookies(req).bb_session;
  if (!token) return null;
  const s = sessions[token];
  if (!s || s.expires < Date.now()) return null;
  return { token, ...s };
}
function sessionCookie(token, maxAgeSec) {
  return `bb_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAgeSec}`;
}
const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });

// ---------- 검증 ----------
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^(\d{4}-\d{2}|default)$/;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

function cleanEntry(body, data) {
  const { date, type, categoryId, amount, memo } = body;
  if (!DATE_RE.test(date || '')) throw bad('날짜 형식이 올바르지 않습니다.');
  if (type !== 'expense' && type !== 'income') throw bad('구분이 올바르지 않습니다.');
  const amt = Math.round(Number(amount));
  if (!Number.isFinite(amt) || amt <= 0 || amt > 1e12) throw bad('금액을 확인해 주세요.');
  const cat = data.categories.find((c) => c.id === categoryId);
  if (!cat || cat.type !== type) throw bad('카테고리를 선택해 주세요.');
  return { date, type, categoryId, amount: amt, memo: String(memo || '').slice(0, 200) };
}
function cleanCategory(body) {
  const name = String(body.name || '').trim().slice(0, 30);
  if (!name) throw bad('카테고리 이름을 입력해 주세요.');
  if (body.type !== 'expense' && body.type !== 'income') throw bad('구분이 올바르지 않습니다.');
  const color = COLOR_RE.test(body.color || '') ? body.color : '#8a8a8a';
  return { name, type: body.type, color };
}

// 이미지 형식 판별 (매직 넘버)
function imageExt(buf) {
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'jpg';
  if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP') return 'webp';
  if (buf.slice(0, 3).toString() === 'GIF') return 'gif';
  return null;
}
const IMG_TYPES = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' };

// ---------- API ----------
async function handleApi(req, res, url) {
  const p = url.pathname;
  const m = req.method;

  if (m !== 'GET' && m !== 'HEAD') {
    // 간단한 CSRF 방어: 같은 출처에서 온 요청만 허용
    const origin = req.headers.origin;
    if (origin && new URL(origin).host !== req.headers.host) throw bad('허용되지 않은 요청입니다.', 403);
  }

  if (p === '/api/signup' && m === 'POST') {
    const { username, password } = await readJSONBody(req);
    const u = String(username || '').trim();
    if (!/^[a-zA-Z0-9_가-힣]{2,20}$/.test(u)) throw bad('아이디는 2~20자의 한글/영문/숫자/_ 만 가능합니다.');
    if (typeof password !== 'string' || password.length < 6) throw bad('비밀번호는 6자 이상이어야 합니다.');
    if (users[u]) throw bad('이미 사용 중인 아이디입니다.', 409);
    const id = crypto.randomUUID();
    users[u] = { id, ...hashPassword(password), createdAt: new Date().toISOString() };
    writeJSON(USERS_FILE, users);
    loadUserData(id);
    return login(res, u, id);
  }

  if (p === '/api/login' && m === 'POST') {
    const { username, password } = await readJSONBody(req);
    const u = users[String(username || '').trim()];
    if (!u || typeof password !== 'string' || !verifyPassword(password, u.salt, u.hash)) {
      throw bad('아이디 또는 비밀번호가 올바르지 않습니다.', 401);
    }
    return login(res, String(username).trim(), u.id);
  }

  if (p === '/api/logout' && m === 'POST') {
    const s = getSession(req);
    if (s) { delete sessions[s.token]; writeJSON(SESSIONS_FILE, sessions); }
    return send(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie('', 0) });
  }

  // ---- 이하 로그인 필요 ----
  const session = getSession(req);
  if (!session) throw bad('로그인이 필요합니다.', 401);
  const uid = session.userId;
  const username = Object.keys(users).find((k) => users[k].id === uid);
  if (!username) throw bad('로그인이 필요합니다.', 401);

  if (p === '/api/me' && m === 'GET') return send(res, 200, { username });

  const data = loadUserData(uid);

  if (p === '/api/data' && m === 'GET') return send(res, 200, data);

  // 기록
  if (p === '/api/entries' && m === 'POST') {
    const entry = { id: crypto.randomUUID(), ...cleanEntry(await readJSONBody(req), data), createdAt: Date.now() };
    data.entries.push(entry);
    saveUserData(uid, data);
    return send(res, 201, entry);
  }
  let mt = p.match(/^\/api\/entries\/([\w-]+)$/);
  if (mt) {
    const idx = data.entries.findIndex((e) => e.id === mt[1]);
    if (idx < 0) throw bad('기록을 찾을 수 없습니다.', 404);
    if (m === 'PUT') {
      data.entries[idx] = { ...data.entries[idx], ...cleanEntry(await readJSONBody(req), data) };
      saveUserData(uid, data);
      return send(res, 200, data.entries[idx]);
    }
    if (m === 'DELETE') {
      data.entries.splice(idx, 1);
      saveUserData(uid, data);
      return send(res, 200, { ok: true });
    }
  }

  // 카테고리
  if (p === '/api/categories' && m === 'POST') {
    const c = { id: crypto.randomUUID(), ...cleanCategory(await readJSONBody(req)) };
    data.categories.push(c);
    saveUserData(uid, data);
    return send(res, 201, c);
  }
  mt = p.match(/^\/api\/categories\/([\w-]+)$/);
  if (mt) {
    const idx = data.categories.findIndex((c) => c.id === mt[1]);
    if (idx < 0) throw bad('카테고리를 찾을 수 없습니다.', 404);
    const used = data.entries.some((e) => e.categoryId === mt[1]);
    if (m === 'PUT') {
      const next = cleanCategory(await readJSONBody(req));
      if (used && next.type !== data.categories[idx].type) throw bad('기록이 있는 카테고리는 지출/수입 구분을 바꿀 수 없습니다.');
      data.categories[idx] = { ...data.categories[idx], ...next };
      saveUserData(uid, data);
      return send(res, 200, data.categories[idx]);
    }
    if (m === 'DELETE') {
      if (used) throw bad('이 카테고리로 작성된 기록이 있어 삭제할 수 없습니다. 기록을 먼저 옮기거나 지워 주세요.');
      data.categories.splice(idx, 1);
      saveUserData(uid, data);
      return send(res, 200, { ok: true });
    }
  }

  // 배경 사진: key = 'YYYY-MM' (월별) 또는 'default' (기본)
  mt = p.match(/^\/api\/backgrounds\/([\w-]+)$/);
  if (mt) {
    const key = mt[1];
    if (!MONTH_RE.test(key)) throw bad('잘못된 배경 키입니다.');
    if (m === 'GET') {
      const file = data.backgrounds[key];
      if (!file) throw bad('배경이 없습니다.', 404);
      const buf = fs.readFileSync(path.join(BG_DIR, file));
      return send(res, 200, buf, { 'Content-Type': IMG_TYPES[path.extname(file).slice(1)], 'Cache-Control': 'private, max-age=31536000, immutable' });
    }
    if (m === 'PUT') {
      const buf = await readBody(req, MAX_IMAGE);
      const ext = imageExt(buf);
      if (!ext) throw bad('JPG, PNG, WEBP, GIF 이미지만 올릴 수 있습니다.');
      const file = `${uid}-${key}-${Date.now()}.${ext}`;
      fs.writeFileSync(path.join(BG_DIR, file), buf);
      if (data.backgrounds[key]) fs.rmSync(path.join(BG_DIR, data.backgrounds[key]), { force: true });
      data.backgrounds[key] = file;
      saveUserData(uid, data);
      return send(res, 200, { ok: true, file });
    }
    if (m === 'DELETE') {
      if (data.backgrounds[key]) fs.rmSync(path.join(BG_DIR, data.backgrounds[key]), { force: true });
      delete data.backgrounds[key];
      saveUserData(uid, data);
      return send(res, 200, { ok: true });
    }
  }

  throw bad('찾을 수 없습니다.', 404);
}

function login(res, username, userId) {
  pruneSessions();
  const token = crypto.randomBytes(32).toString('hex');
  sessions[token] = { userId, expires: Date.now() + SESSION_TTL };
  writeJSON(SESSIONS_FILE, sessions);
  send(res, 200, { username }, { 'Set-Cookie': sessionCookie(token, SESSION_TTL / 1000) });
}

// ---------- 정적 파일 ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return send(res, 403, 'Forbidden');
  fs.readFile(file, (err, buf) => {
    if (err) return send(res, 404, 'Not found');
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
    res.end(buf);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) await handleApi(req, res, url);
    else serveStatic(req, res, url);
  } catch (e) {
    if (!e.status) console.error(e);
    if (!res.headersSent) send(res, e.status || 500, { error: e.status ? e.message : '서버 오류가 발생했습니다.' });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`\n  📒 가계부가 실행되었습니다 → http://localhost:${PORT}\n`);
});
