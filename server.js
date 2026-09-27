'use strict';
/* ============================================================
   课堂互动乐园 - 后端服务器
   纯 Node 内置模块实现（http / node:sqlite / crypto / WebSocket 手写帧解析）
   零 npm 依赖
   ============================================================ */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const PORT = process.env.PORT || 8787;
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const PUBLIC_DIR = path.join(ROOT, 'public');
const SECRET_FILE = path.join(DATA_DIR, 'secret');
const DB_FILE = path.join(DATA_DIR, 'app.db');

fs.mkdirSync(DATA_DIR, { recursive: true });

// ---------- 密钥 ----------
let SECRET;
try { SECRET = fs.readFileSync(SECRET_FILE, 'utf8'); }
catch { SECRET = crypto.randomBytes(32).toString('hex'); fs.writeFileSync(SECRET_FILE, SECRET); }

// ---------- 管理员密钥（数据导出/迁移用，首次启动自动生成）----------
const ADMIN_KEY_FILE = path.join(DATA_DIR, 'adminkey');
let ADMIN_KEY = process.env.ADMIN_KEY || '';
if (!ADMIN_KEY) {
  try { ADMIN_KEY = fs.readFileSync(ADMIN_KEY_FILE, 'utf8').trim(); }
  catch { ADMIN_KEY = crypto.randomBytes(16).toString('hex'); fs.writeFileSync(ADMIN_KEY_FILE, ADMIN_KEY); }
}
const ALL_TABLES = ['users', 'classes', 'questions', 'assignments', 'assignment_questions', 'submissions',
  'points_ledger', 'notifications', 'shop_items', 'inventory', 'pets', 'pet_posts', 'battle_results', 'delay_uses'];

// ---------- 数据库 ----------
const db = new DatabaseSync(DB_FILE);
db.exec(`
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  role TEXT NOT NULL,            -- teacher | student
  name TEXT NOT NULL,
  class_id INTEGER,
  species TEXT,
  pet_name TEXT,
  credits INTEGER DEFAULT 0,
  hat TEXT DEFAULT '',
  acc TEXT DEFAULT '',
  title TEXT DEFAULT '',
  created_at INTEGER
);
CREATE TABLE IF NOT EXISTS classes(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  grade TEXT NOT NULL DEFAULT '未设置',
  code TEXT UNIQUE NOT NULL,
  teacher_id INTEGER NOT NULL,
  created_at INTEGER
);
CREATE TABLE IF NOT EXISTS questions(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  teacher_id INTEGER NOT NULL,
  type TEXT NOT NULL,            -- choice | fill | judge | short
  content TEXT NOT NULL,
  options TEXT DEFAULT '[]',
  answer TEXT NOT NULL,
  created_at INTEGER
);
CREATE TABLE IF NOT EXISTS assignments(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  teacher_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  class_ids TEXT DEFAULT '[]',
  mode TEXT NOT NULL DEFAULT 'normal',   -- normal | battle
  deadline INTEGER NOT NULL,
  published INTEGER DEFAULT 0,
  published_at INTEGER,
  created_at INTEGER
);
CREATE TABLE IF NOT EXISTS assignment_questions(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  assignment_id INTEGER NOT NULL,
  question_id INTEGER NOT NULL,
  points INTEGER DEFAULT 10,
  ord INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS submissions(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  assignment_id INTEGER NOT NULL,
  student_id INTEGER NOT NULL,
  answers TEXT DEFAULT '[]',     -- [{qid, answer, correct, points}]
  score INTEGER DEFAULT 0,
  battle_score INTEGER DEFAULT 0,
  battle_opponent TEXT DEFAULT '',
  rank INTEGER DEFAULT 0,        -- 1/2/3 前三名
  rank_bonus INTEGER DEFAULT 0,
  graded INTEGER DEFAULT 1,      -- 0 表示含简答题待批改
  grade TEXT DEFAULT '',
  comment TEXT DEFAULT '',
  objective_score INTEGER DEFAULT 0,
  submitted_at INTEGER
);
CREATE TABLE IF NOT EXISTS points_ledger(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL,
  amount INTEGER NOT NULL,
  reason TEXT NOT NULL,
  ref TEXT DEFAULT '',
  created_at INTEGER
);
CREATE TABLE IF NOT EXISTS notifications(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  teacher_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  content TEXT NOT NULL,
  read INTEGER DEFAULT 0,
  created_at INTEGER
);
CREATE TABLE IF NOT EXISTS shop_items(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL,        -- food | tool | pet | dress
  name TEXT NOT NULL,
  emoji TEXT NOT NULL,
  price INTEGER NOT NULL,
  effect TEXT DEFAULT '{}',      -- {hunger,happiness,exp,delay_min}
  min_level INTEGER DEFAULT 1,
  description TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS inventory(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL,
  item_id INTEGER NOT NULL,
  qty INTEGER DEFAULT 1
);
CREATE TABLE IF NOT EXISTS pets(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER UNIQUE NOT NULL,
  species TEXT NOT NULL,
  name TEXT NOT NULL,
  level INTEGER DEFAULT 1,
  exp INTEGER DEFAULT 0,
  hunger REAL DEFAULT 100,
  happiness REAL DEFAULT 80,
  alive INTEGER DEFAULT 1,
  skin TEXT DEFAULT '',
  room_item TEXT DEFAULT '',
  last_decay INTEGER,
  created_at INTEGER
);
CREATE TABLE IF NOT EXISTS pet_posts(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL,
  content TEXT NOT NULL,
  likes TEXT DEFAULT '[]',
  created_at INTEGER
);
CREATE TABLE IF NOT EXISTS battle_results(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  assignment_id INTEGER NOT NULL,
  p1 INTEGER, p2 INTEGER,
  winner INTEGER,
  p1_score INTEGER, p2_score INTEGER,
  created_at INTEGER
);
CREATE TABLE IF NOT EXISTS delay_uses(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  assignment_id INTEGER NOT NULL,
  student_id INTEGER NOT NULL,
  count INTEGER DEFAULT 0
);
`);

// ---------- 种子数据：商店 ----------
const shopSeed = [
  { c: 'food', name: '小鱼干', emoji: '🍖', price: 10, eff: { hunger: 20, exp: 2 }, lv: 1, d: '美味的小零食，恢复少量饥饿值' },
  { c: 'food', name: '猫罐头', emoji: '🥫', price: 20, eff: { hunger: 40, exp: 5 }, lv: 1, d: '营养丰富的罐头，宠物最爱' },
  { c: 'food', name: '豪华大餐', emoji: '🍱', price: 40, eff: { hunger: 80, exp: 10 }, lv: 1, d: '五星级大餐，吃完整天元气满满' },
  { c: 'food', name: '宠物蛋糕', emoji: '🎂', price: 60, eff: { hunger: 100, happiness: 15, exp: 15 }, lv: 6, d: '庆祝专用蛋糕，饥饿值直接拉满' },
  { c: 'tool', name: '延时铃', emoji: '🔔', price: 30, eff: { delay_min: 30 }, lv: 1, d: '使用后可将某个作业的截止时间延长 30 分钟（每个作业最多 4 次）' },
  { c: 'pet', name: '猫薄荷', emoji: '🌿', price: 25, eff: { happiness: 30 }, lv: 1, d: '宠物闻到就开心得打滚' },
  { c: 'pet', name: '猫爬架', emoji: '🪜', price: 35, eff: { happiness: 25, exp: 8 }, lv: 1, d: '爬上爬下超快乐，还能锻炼身体' },
  { c: 'pet', name: '毛线球', emoji: '🧶', price: 15, eff: { happiness: 10 }, lv: 1, d: '经典玩具，怎么玩都玩不腻' },
  { c: 'pet', name: '玩具小鱼', emoji: '🐟', price: 20, eff: { happiness: 15 }, lv: 1, d: '会动的小鱼玩具，宠物疯狂追逐' },
  { c: 'dress', name: '蝴蝶结', emoji: '🎀', price: 25, eff: { happiness: 10 }, lv: 3, d: '可爱的小蝴蝶结，3级解锁装扮后可用' },
  { c: 'dress', name: '绅士帽', emoji: '🎩', price: 30, eff: { happiness: 12 }, lv: 3, d: '戴上一秒变绅士' },
  { c: 'dress', name: '皇冠', emoji: '👑', price: 60, eff: { happiness: 20 }, lv: 6, d: '王者风范，6级解锁' },
  { c: 'dress', name: '超人披风', emoji: '🦸', price: 80, eff: { happiness: 25 }, lv: 6, d: '披上披风，拯救世界' },
];
const sc = db.prepare('SELECT COUNT(*) AS n FROM shop_items').get();
if (sc.n === 0) {
  const ins = db.prepare('INSERT INTO shop_items(category,name,emoji,price,effect,min_level,description) VALUES(?,?,?,?,?,?,?)');
  for (const s of shopSeed) ins.run(s.c, s.name, s.emoji, s.price, JSON.stringify(s.eff), s.lv, s.d);
}

// ---------- 宠物品种 ----------
const SPECIES = {
  cat: { name: '猫咪', stages: [['🐱', '小奶猫'], ['😺', '大猫咪'], ['👑', '猫王'], ['🐯', '虎神·传说']] },
  dog: { name: '狗狗', stages: [['🐶', '小奶狗'], ['🐕', '大狗狗'], ['👑', '狗王'], ['🐺', '狼神·传说']] },
  dragon: { name: '小龙', stages: [['🐲', '小龙宝宝'], ['🐉', '大飞龙'], ['👑', '龙王'], ['🌋', '炎帝龙·传说']] },
  fox: { name: '狐狸', stages: [['🦊', '小狐狸'], ['✨🦊', '灵狐'], ['👑', '狐王'], ['🌟', '九尾仙狐·传说']] },
  dino: { name: '恐龙', stages: [['🦕', '小恐龙'], ['🦖', '大恐龙'], ['👑', '恐龙王'], ['🌋', '泰坦龙·传说']] },
  penguin: { name: '企鹅', stages: [['🐧', '小企鹅'], ['🎩🐧', '企鹅绅士'], ['👑', '企鹅王'], ['❄️', '冰霜帝企鹅·传说']] },
};
const LEVELS = [0, 60, 150, 280, 450, 660, 900, 1180, 1500, 1900]; // 10 级所需经验
const LEVEL_UNLOCKS = {
  2: '🏡 宠物小窝',
  3: '💬 宠物对话 · 安抚心情',
  4: '🎀 宠物装扮',
  5: '🌐 宠物社交广场',
  6: '🏅 专属称号',
  7: '👑 高级装扮（皇冠/披风）',
  8: '🎮 宠物运动会',
  9: '🖼️ 传说皮肤',
  10: '🎁 每日神秘礼盒',
};
const TITLES = [
  { name: '萌新铲屎官', min: 0 },
  { name: '答题小能手', min: 100 },
  { name: '学霸饲养员', min: 300 },
  { name: '学分收割机', min: 600 },
  { name: '卷王之王', min: 1000 },
  { name: '传说驯兽师', min: 2000 },
];
const PET_CHAT_COMFORT = ['抱抱你～不管结果怎么样，主人都已经很棒啦！', '别难过啦，我会一直陪着你哒 ❤️', '深呼吸～我们一起慢慢来，没关系的！', '你已经很努力了，剩下的事情明天再想吧！'];
const PET_CHAT_HAPPY = ['今天也是元气满满的一天！✨', '主人最棒啦！我们一起加油！', '嘿嘿，有你在真好～', '想和主人一起看晚霞～'];
const PET_CHAT_HUNGRY = ['主人…我的肚子咕咕叫了 🥺 去商店买点吃的吧～', '好饿好饿，饿得能吃掉一头牛！'];
const PET_CHAT_SAD = ['最近有点无聊，陪我玩玩玩具好不好～', '今天心情一般般…主人陪我聊聊天吧。'];
const PET_CHAT_DEAD = ['……（宠物已经离开了，快用 30 学分复活它吧）'];

// ---------- 工具函数 ----------
const now = () => Date.now();
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const json = (res, code, obj) => {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
};
const hashPwd = (pwd) => crypto.scryptSync(String(pwd), SECRET.slice(0, 16), 32).toString('hex');
const genCode = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = Array.from({ length: 6 }, () => chars[crypto.randomInt(chars.length)]).join('');
  } while (db.prepare('SELECT 1 FROM classes WHERE code=?').get(code));
  return code;
};
const signToken = (uid, role) => {
  const payload = Buffer.from(JSON.stringify({ uid, role, exp: Math.floor(now() / 1000) + 30 * 86400 })).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
};
const verifyToken = (token) => {
  if (!token) return null;
  const [p, s] = token.split('.');
  if (!p || !s) return null;
  const expect = crypto.createHmac('sha256', SECRET).update(p).digest('base64url');
  if (expect.length !== s.length || !crypto.timingSafeEqual(Buffer.from(s), Buffer.from(expect))) return null;
  try {
    const data = JSON.parse(Buffer.from(p, 'base64url').toString());
    if (data.exp < Math.floor(now() / 1000)) return null;
    return data;
  } catch { return null; }
};
const getUser = (uid) => db.prepare('SELECT id,username,role,name,class_id,species,pet_name,credits,hat,acc,title FROM users WHERE id=?').get(uid);
const addCredits = (sid, amount, reason, ref) => {
  db.prepare('UPDATE users SET credits = credits + ? WHERE id=?').run(amount, sid);
  db.prepare('INSERT INTO points_ledger(student_id,amount,reason,ref,created_at) VALUES(?,?,?,?,?)').run(sid, amount, reason, ref, now());
  broadcastLeaderboard(sid);
};
const notifyTeacher = (tid, type, content) => {
  db.prepare('INSERT INTO notifications(teacher_id,type,content,created_at) VALUES(?,?,?,?)').run(tid, type, content, now());
  for (const ws of subs.get('t:' + tid) || []) sendWS(ws, { t: 'notify', data: { type, content } });
};

// ---------- 宠物衰减 ----------
function decayPet(p) {
  if (!p) return null;
  const elapsed = (now() - (p.last_decay || now())) / 3600000; // 小时
  if (elapsed > 0.01) {
    let hunger = Math.max(0, p.hunger - elapsed * 4);      // 100 → 0 约 25 小时
    let happiness = Math.max(0, p.happiness - elapsed * 1.4); // 100 → 0 约 3 天
    let alive = p.alive;
    if (hunger <= 0 && alive === 1) {
      alive = 0;
      const tid = db.prepare('SELECT teacher_id FROM classes WHERE id=(SELECT class_id FROM users WHERE id=?)').get(p.student_id)?.teacher_id;
      if (tid) notifyTeacher(tid, 'system', `😿 ${getUser(p.student_id)?.name} 的宠物「${p.name}」因为太久没吃东西饿晕了`);
    }
    db.prepare('UPDATE pets SET hunger=?, happiness=?, alive=?, last_decay=? WHERE student_id=?')
      .run(hunger, happiness, alive, now(), p.student_id);
    p.hunger = hunger; p.happiness = happiness; p.alive = alive;
  }
  return p;
}
const getPet = (sid) => decayPet(db.prepare('SELECT * FROM pets WHERE student_id=?').get(sid));
const growthRate = (p) => (p.happiness >= 70 ? 1.5 : p.happiness < 30 ? 0.5 : 1);
function addExp(sid, baseExp) {
  const p = getPet(sid);
  if (!p || !p.alive) return;
  const gained = Math.round(baseExp * growthRate(p));
  let exp = p.exp + gained, level = p.level, leveled = false;
  while (level < 10 && exp >= LEVELS[level]) { exp -= LEVELS[level]; level++; leveled = true; }
  if (level >= 10) exp = Math.min(exp, LEVELS[9]);
  db.prepare('UPDATE pets SET exp=?, level=? WHERE student_id=?').run(exp, level, sid);
  if (leveled) notifyLevelUp(sid, level);
}
const notifyLevelUp = (sid, level) => {
  const u = getUser(sid);
  const unlock = LEVEL_UNLOCKS[level] || '';
  const [emoji, stageName] = SPECIES[u.species]?.stages[Math.min(3, level >= 10 ? 3 : level >= 7 ? 2 : level >= 4 ? 1 : 0)] || ['🐾', ''];
  for (const ws of subs.get('u:' + sid) || []) sendWS(ws, { t: 'levelup', data: { level, unlock, emoji, stageName } });
};

// ---------- 排行榜 ----------
let leaderboardCache = {};
function leaderboard(classId) {
  const key = classId || 'all';
  const cached = leaderboardCache[key];
  if (cached && now() - cached.t < 3000) return cached.data;
  const rows = classId
    ? db.prepare(`SELECT id, name, credits, title FROM users WHERE role='student' AND class_id=? ORDER BY credits DESC`).all(classId)
    : db.prepare(`SELECT id, name, credits, title FROM users WHERE role='student' ORDER BY credits DESC`).all();
  const data = rows.map((r, i) => ({ rank: i + 1, ...r, icon: i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '' }));
  leaderboardCache[key] = { t: now(), data };
  return data;
}
let lastLbPush = {};
function broadcastLeaderboard(sid) {
  const u = getUser(sid);
  if (!u || u.role !== 'student') return;
  const nowMs = now();
  if (nowMs - (lastLbPush[sid] || 0) < 1500) return; // 节流
  lastLbPush[sid] = nowMs;
  leaderboardCache = {};
  for (const ws of subs.get('lb') || []) sendWS(ws, { t: 'lb', data: leaderboard(null) });
  if (u.class_id) for (const ws of subs.get('lb:' + u.class_id) || []) sendWS(ws, { t: 'lb', data: leaderboard(u.class_id) });
}

// ---------- WebSocket（手写 RFC6455）----------
const subs = new Map();       // topic -> Set(ws)
const wsUser = new Map();     // ws -> {uid, role}
function sendWS(ws, obj) {
  try {
    const payload = Buffer.from(JSON.stringify(obj));
    const len = payload.length;
    let header;
    if (len < 126) header = Buffer.from([0x81, len]);
    else if (len < 65536) { header = Buffer.alloc(4); header[0] = 0x81; header[1] = 126; header.writeUInt16BE(len, 2); }
    else { header = Buffer.alloc(10); header[0] = 0x81; header[1] = 127; header.writeBigUInt64BE(BigInt(len), 2); }
    ws.write(Buffer.concat([header, payload]));
  } catch { /* 连接已断开 */ }
}
function handleWSMessage(ws, text) {
  let msg;
  try { msg = JSON.parse(text); } catch { return; }
  const user = wsUser.get(ws);
  if (!user) return;
  if (msg.t === 'sub' && msg.topic) {
    if (!subs.has(msg.topic)) subs.set(msg.topic, new Set());
    subs.get(msg.topic).add(ws);
    if (msg.topic === 'lb') sendWS(ws, { t: 'lb', data: leaderboard(null) });
    else if (msg.topic.startsWith('lb:')) sendWS(ws, { t: 'lb', data: leaderboard(Number(msg.topic.slice(3))) });
    sendWS(ws, { t: 'ok', topic: msg.topic });
  } else if (msg.t === 'unsub' && msg.topic) {
    subs.get(msg.topic)?.delete(ws);
  } else if (msg.t === 'battle') {
    handleBattleMessage(ws, user, msg);
  } else if (msg.t === 'ping') {
    sendWS(ws, { t: 'pong' });
  }
}
function dropWS(ws) {
  const user = wsUser.get(ws);
  if (!user) return;
  wsUser.delete(ws);
  for (const set of subs.values()) set.delete(ws);
  for (const [aid, queue] of battleQueue) battleQueue.set(aid, queue.filter(x => x.ws !== ws));
  handleBattleLeave(ws, user);
}
const server = http.createServer(handleRequest);
server.on('upgrade', (req, socket) => {
  if (req.url.split('?')[0] !== '/ws') { socket.destroy(); return; }
  const key = req.headers['sec-websocket-key'];
  if (!key) { socket.destroy(); return; }
  const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  const url = new URL(req.url, 'http://localhost');
  const token = url.searchParams.get('token');
  const auth = verifyToken(token);
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
  const ws = socket;
  wsUser.set(ws, { uid: auth?.uid, role: auth?.role });
  ws._buf = Buffer.alloc(0);
  ws._frag = null;
  ws._heartbeat = setInterval(() => {
    try { socket.write(Buffer.from([0x89, 0x00])); } catch { socket.destroy(); }
  }, 30000);
  ws.on('data', (chunk) => {
    ws._buf = Buffer.concat([ws._buf, chunk]);
    while (ws._buf.length >= 2) {
      const b0 = ws._buf[0], b1 = ws._buf[1];
      const fin = (b0 & 0x80) !== 0;
      const opcode = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f, off = 2;
      if (len === 126) { if (ws._buf.length < 4) break; len = ws._buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (ws._buf.length < 10) break; len = Number(ws._buf.readBigUInt64BE(2)); off = 10; }
      let maskKey;
      if (masked) { if (ws._buf.length < off + 4) break; maskKey = ws._buf.slice(off, off + 4); off += 4; }
      if (ws._buf.length < off + len) break;
      let payload = ws._buf.slice(off, off + len);
      ws._buf = ws._buf.slice(off + len);
      if (masked) payload = Buffer.from(payload.map((b, i) => b ^ maskKey[i % 4]));
      if (!fin) { ws._frag = ws._frag ? Buffer.concat([ws._frag, payload]) : payload; continue; }
      if (ws._frag) { payload = Buffer.concat([ws._frag, payload]); ws._frag = null; }
      if (opcode === 0x8) { socket.end(); return; }        // close
      if (opcode === 0x9) {                                 // ping
        const pong = Buffer.alloc(2 + payload.length); pong[0] = 0x8A; pong[1] = payload.length; payload.copy(pong, 2);
        try { socket.write(pong); } catch {}
        continue;
      }
      if (opcode === 0x1) { try { handleWSMessage(ws, payload.toString()); } catch (e) { console.error('[ws-msg]', e); } }
    }
  });
  socket.on('close', () => { clearInterval(ws._heartbeat); dropWS(ws); });
  socket.on('error', () => { clearInterval(ws._heartbeat); dropWS(ws); });
});

// ---------- 对战引擎 ----------
const battleQueue = new Map();   // assignmentId -> [ws]
const battleRooms = new Map();   // roomId -> room
let roomSeq = 1;

function battleRoomFor(ws) {
  for (const room of battleRooms.values()) if (room.ws1 === ws || room.ws2 === ws) return room;
  return null;
}
function battlePlayer(room, ws) { return room.ws1 === ws ? 'p1' : room.ws2 === ws ? 'p2' : null; }

function joinBattle(ws, user, assignmentId) {
  if (!user.uid) return sendWS(ws, { t: 'battle', a: 'error', msg: '请先登录' });
  const a = db.prepare('SELECT * FROM assignments WHERE id=? AND published=1').get(assignmentId);
  if (!a || a.mode !== 'battle') return sendWS(ws, { t: 'battle', a: 'error', msg: '作业不存在或不是对战模式' });
  if (a.deadline < now()) return sendWS(ws, { t: 'battle', a: 'error', msg: '作业已截止' });
  const qs = db.prepare(`SELECT q.id, q.type, q.content, q.options, q.answer, aq.points FROM assignment_questions aq JOIN questions q ON q.id=aq.question_id WHERE aq.assignment_id=? AND q.type!='short' ORDER BY aq.ord`).all(assignmentId);
  if (!qs.length) return sendWS(ws, { t: 'battle', a: 'error', msg: '对战作业需要至少一道客观题（选择/填空/判断）' });
  const done = db.prepare('SELECT 1 FROM submissions WHERE assignment_id=? AND student_id=?').get(assignmentId, user.uid);
  if (done) return sendWS(ws, { t: 'battle', a: 'error', msg: '你已经完成过这次对战作业了' });
  const queue = battleQueue.get(assignmentId) || [];
  const other = queue.find(x => x.ws !== ws && wsUser.get(x.ws)?.uid !== user.uid && wsUser.get(x.ws)?.uid);
  if (other) {
    battleQueue.set(assignmentId, queue.filter(x => x.ws !== other.ws));
    createBattleRoom(ws, other.ws, assignmentId, qs);
  } else {
    queue.push({ ws, uid: user.uid, joined: now() });
    battleQueue.set(assignmentId, queue);
    sendWS(ws, { t: 'battle', a: 'waiting', pos: queue.length, assignmentId });
  }
}
function createBattleRoom(ws1, ws2, assignmentId, qs) {
  const room = {
    id: roomSeq++, assignmentId, ws1, ws2,
    qs: qs.map(q => ({ id: q.id, type: q.type, content: q.content, options: JSON.parse(q.options || '[]'), points: q.points, answer: q.answer })),
    idx: 0, p1Answers: [], p2Answers: [], timer: null, over: false,
  };
  battleRooms.set(room.id, room);
  const u1 = getUser(wsUser.get(ws1).uid), u2 = getUser(wsUser.get(ws2).uid);
  for (const ws of [ws1, ws2]) {
    const me = ws === ws1 ? u1 : u2, opp = ws === ws1 ? u2 : u1;
    sendWS(ws, { t: 'battle', a: 'start', roomId: room.id, assignmentId, opponent: { name: opp.name, credits: opp.credits }, total: qs.length, question: publicQuestion(room.qs[0]), score: 0, oppScore: 0 });
  }
  room.timer = setTimeout(() => { try { resolveRound(room, 'timeout'); } catch (e) { console.error('[battle-timer]', e); } }, 60000);
}
function publicQuestion(q) { return { id: q.id, type: q.type, content: q.content, options: q.options, points: q.points }; }
function resolveRound(room, reason) {
  if (room.over) return;
  const q = room.qs[room.idx];
  const a1 = room.p1Answers[room.idx], a2 = room.p2Answers[room.idx];
  const norm = s => String(s).trim().toLowerCase();
  const c1 = a1 !== undefined && norm(a1) === norm(q.answer);
  const c2 = a2 !== undefined && norm(a2) === norm(q.answer);
  let s1 = 0, s2 = 0;
  if (reason === 'timeout') {
    if (a1 !== undefined) s1 = c1 ? 3 : 0;
    if (a2 !== undefined) s2 = c2 ? 3 : 0;
  } else if (c1 && c2) { // 都比对，更快者满分
    if (room.t1 <= room.t2) { s1 = 3; s2 = 1; } else { s1 = 1; s2 = 3; }
  } else if (c1) s1 = 3;
  else if (c2) s2 = 3;
  room.s1 = (room.s1 || 0) + s1; room.s2 = (room.s2 || 0) + s2;
  const result = {
    a: 'round', idx: room.idx, myCorrect: ws => ws === room.ws1 ? c1 : c2,
    oppCorrect: ws => ws === room.ws1 ? c2 : c1,
    myScore: ws => ws === room.ws1 ? s1 : s2,
    oppScore: ws => ws === room.ws1 ? s2 : s1,
    correctAnswer: q.answer, answer: q.type === 'choice' ? String.fromCharCode(65 + q.answer) : q.answer,
  };
  for (const ws of [room.ws1, room.ws2]) {
    sendWS(ws, { t: 'battle', ...result, myScore: result.myScore(ws), oppScore: result.oppScore(ws), myCorrect: result.myCorrect(ws), oppCorrect: result.oppCorrect(ws), total1: room.s1, total2: room.s2 });
  }
  room.idx++;
  if (room.idx >= room.qs.length) return endBattle(room);
  for (const ws of [room.ws1, room.ws2]) sendWS(ws, { t: 'battle', a: 'next', idx: room.idx, total: room.qs.length, question: publicQuestion(room.qs[room.idx]) });
  room.timer = setTimeout(() => { try { resolveRound(room, 'timeout'); } catch (e) { console.error('[battle-timer]', e); } }, 60000);
}
function handleBattleMessage(ws, user, msg) {
  if (msg.a === 'join') return joinBattle(ws, user, msg.assignmentId);
  if (msg.a === 'cancel') {
    for (const [aid, queue] of battleQueue) battleQueue.set(aid, queue.filter(x => x.ws !== ws));
    return;
  }
  const room = battleRoomFor(ws);
  if (!room) return;
  const player = battlePlayer(room, ws);
  if (msg.a === 'answer' && player) {
    const i = room.idx;
    if (player === 'p1') { if (room.p1Answers[i] === undefined) { room.p1Answers[i] = msg.ans; room.t1 = now(); } }
    else { if (room.p2Answers[i] === undefined) { room.p2Answers[i] = msg.ans; room.t2 = now(); } }
    if (room.p1Answers[i] !== undefined && room.p2Answers[i] !== undefined) { clearTimeout(room.timer); resolveRound(room, 'both'); }
  }
  if (msg.a === 'leave') return handleBattleLeave(ws, user);
}
function handleBattleLeave(ws) {
  const room = battleRoomFor(ws);
  if (!room || room.over) return;
  clearTimeout(room.timer);
  const quitter = battlePlayer(room, ws);
  // 弃权：剩余题目对方每题得 1 分
  while (room.idx < room.qs.length) {
    if (quitter === 'p1') room.s2 = (room.s2 || 0) + 1; else room.s1 = (room.s1 || 0) + 1;
    room.idx++;
  }
  room.forfeitBy = quitter;
  endBattle(room);
}
function endBattle(room) {
  if (room.over) return;
  room.over = true;
  clearTimeout(room.timer);
  battleRooms.delete(room.id);
  const u1 = wsUser.get(room.ws1)?.uid, u2 = wsUser.get(room.ws2)?.uid;
  const s1 = room.s1 || 0, s2 = room.s2 || 0;
  const n1 = u1 ? getUser(u1) : null, n2 = u2 ? getUser(u2) : null;
  if (u1) recordBattleSubmission(room, u1, n2?.name || '对手', s1);
  if (u2) recordBattleSubmission(room, u2, n1?.name || '对手', s2);
  db.prepare('INSERT INTO battle_results(assignment_id,p1,p2,winner,p1_score,p2_score,created_at) VALUES(?,?,?,?,?,?,?)')
    .run(room.assignmentId, u1 || 0, u2 || 0, s1 >= s2 ? (u1 || 0) : (u2 || 0), s1, s2, now());
  for (const ws of [room.ws1, room.ws2]) {
    sendWS(ws, { t: 'battle', a: 'end', myTotal: ws === room.ws1 ? s1 : s2, oppTotal: ws === room.ws1 ? s2 : s1, forfeit: room.forfeitBy && (ws === room.ws1 ? room.forfeitBy === 'p1' : room.forfeitBy === 'p2') });
  }
  const a = db.prepare('SELECT title, teacher_id FROM assignments WHERE id=?').get(room.assignmentId);
  if (a) for (const uid of [u1, u2]) if (uid) notifyTeacher(a.teacher_id, 'submit', `⚔️ 对战作业「${a.title}」有学生完成了对战`);
}
function recordBattleSubmission(room, uid, oppName, score) {
  if (!uid) return;
  const u = getUser(uid);
  if (!u) return;
  const r = db.prepare(`INSERT INTO submissions(assignment_id,student_id,answers,score,battle_score,battle_opponent,rank,rank_bonus,submitted_at) VALUES(?,?,?,?,?,?,?,?,?)`)
    .run(room.assignmentId, uid, '[]', score, score, oppName, 0, 0, now());
  const ranked = rankBonusFor(room.assignmentId, uid);
  if (ranked.bonus > 0) db.prepare('UPDATE submissions SET score=score+? WHERE id=?').run(ranked.bonus, Number(r.lastInsertRowid));
  const credits = score * 2 + ranked.bonus;
  addCredits(uid, credits, 'submission', 'assignment:' + room.assignmentId);
  addExp(uid, score);
  const p = getPet(uid);
  if (p) db.prepare('UPDATE pets SET happiness=? WHERE student_id=?').run(Math.max(0, p.happiness + 5), uid);
  const a = db.prepare('SELECT title, teacher_id FROM assignments WHERE id=?').get(room.assignmentId);
  if (a) notifyTeacher(a.teacher_id, 'submit', `⚔️ ${u.name} 完成了对战作业「${a.title}」，对战得分 ${score}`);
}
function rankBonusFor(assignmentId, sid) {
  const sub = db.prepare('SELECT id, rank FROM submissions WHERE assignment_id=? AND student_id=?').get(assignmentId, sid);
  if (!sub) return { rank: 0, bonus: 0 };
  const cnt = db.prepare('SELECT COUNT(*) AS n FROM submissions WHERE assignment_id=? AND rank>0').get(assignmentId).n;
  if (cnt < 3) {
    const rank = cnt + 1;
    const bonus = rank === 1 ? 20 : rank === 2 ? 12 : 8;
    db.prepare('UPDATE submissions SET rank=?, rank_bonus=? WHERE id=?').run(rank, bonus, sub.id);
    return { rank, bonus };
  }
  return { rank: 0, bonus: 0 };
}

// ---------- 题目判分 ----------
const normAns = s => String(s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
function judge(q, ans) {
  if (q.type === 'choice') return normAns(ans) === normAns(q.answer);
  if (q.type === 'judge') return normAns(ans) === normAns(q.answer);
  if (q.type === 'fill') return normAns(ans) === normAns(q.answer);
  return null; // short 简答题需老师批改
}

// ---------- 请求处理 ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.json': 'application/json' };

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => { data += c; if (data.length > 1024 * 1024) { reject(new Error('body too large')); req.destroy(); } });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch { reject(new Error('bad json')); } });
  });
}

async function handleRequest(req, res) {
  try {
    const url = new URL(req.url, 'http://localhost');
    const p = url.pathname;
    if (req.method === 'GET' && p === '/health') return json(res, 200, { ok: true });

    // API（带访问日志，方便排查「权限不足」类问题）
    if (p.startsWith('/api/')) {
      if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type,authorization', 'Access-Control-Allow-Methods': '*' }); return res.end(); }
      const auth = verifyToken((req.headers.authorization || '').replace(/^Bearer /, '') || url.searchParams.get('token'));
      const t0 = now();
      try {
        return await handleAPI(req, res, p, auth, url);
      } catch (e) {
        if (e.code === 401) return json(res, 401, { error: '未登录' });
        if (e.code === 403) return json(res, 403, { error: e.message });
        console.error('[err]', e);
        return json(res, 500, { error: '服务器内部错误: ' + e.message });
      } finally {
        console.log(`[api] ${req.method} ${p} uid=${auth?.uid || '-'} role=${auth?.role || '-'} status=${res.statusCode} ${now() - t0}ms`);
      }
    }

    // 静态文件
    let file = p === '/' ? '/index.html' : p;
    let fp = path.normalize(path.join(PUBLIC_DIR, file));
    if (!fp.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end(); }
    if (!fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { fp = path.join(PUBLIC_DIR, 'index.html'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' });
    return res.end(fs.readFileSync(fp));
  } catch (e) {
    if (e.code === 401) return json(res, 401, { error: '未登录' });
    if (e.code === 403) return json(res, 403, { error: '权限不足' });
    console.error('[err]', e);
    try { json(res, 500, { error: '服务器内部错误: ' + e.message }); } catch {}
  }
}

const requireAuth = (auth) => { if (!auth) { const err = new Error('未登录'); err.code = 401; throw err; } return auth; };
const requireRole = (auth, role) => {
  requireAuth(auth);
  if (auth.role !== role) {
    const err = new Error(role === 'student'
      ? '权限不足：当前登录的是教师账号，请退出后用「学生登录」进入（学生需要班级码注册）'
      : '权限不足：此操作只有教师账号可以使用');
    err.code = 403; throw err;
  }
  return auth;
};

async function handleAPI(req, res, p, auth, url) {
  const method = req.method;
  let body = {};
  if (['POST', 'PUT', 'PATCH'].includes(method)) body = await readBody(req);

  // ================= 认证 =================
  if (p === '/api/auth/register' && method === 'POST') {
    const { role, username, password, name, classCode, species, petName, classes } = body;
    if (!['teacher', 'student'].includes(role)) return json(res, 400, { error: '身份类型错误' });
    if (!username || String(username).length < 3) return json(res, 400, { error: '用户名至少 3 个字符' });
    if (!password || String(password).length < 6) return json(res, 400, { error: '密码至少 6 位' });
    if (!name) return json(res, 400, { error: '请填写姓名' });
    if (db.prepare('SELECT 1 FROM users WHERE username=?').get(username)) return json(res, 400, { error: '用户名已存在' });
    let classId = null;
    if (role === 'student') {
      if (!classCode) return json(res, 400, { error: '请输入班级码' });
      const cls = db.prepare('SELECT id FROM classes WHERE code=?').get(String(classCode).toUpperCase());
      if (!cls) return json(res, 400, { error: '班级码不存在，请找老师确认' });
      classId = cls.id;
      if (!SPECIES[species]) return json(res, 400, { error: '请选择一只宠物' });
    }
    const r = db.prepare('INSERT INTO users(username,password,role,name,class_id,species,pet_name,created_at) VALUES(?,?,?,?,?,?,?,?)')
      .run(username, hashPwd(password), role, name, classId, species || null, petName || (name + '的宠物'), now());
    const uid = Number(r.lastInsertRowid);
    if (role === 'student') {
      db.prepare(`INSERT INTO pets(student_id,species,name,hunger,happiness,last_decay,created_at) VALUES(?,?,?,100,80,?,?)`)
        .run(uid, species, petName || (name + '的宠物'), now(), now());
    } else {
      for (const c of (classes || [])) {
        if (c && c.name) db.prepare('INSERT INTO classes(name,grade,code,teacher_id,created_at) VALUES(?,?,?,?,?)')
          .run(String(c.name).slice(0, 40), String(c.grade || '未设置'), genCode(), uid, now());
      }
    }
    return json(res, 200, { token: signToken(uid, role), user: getUser(uid) });
  }
  if (p === '/api/auth/login' && method === 'POST') {
    const { username, password, classCode } = body;
    const u = db.prepare('SELECT * FROM users WHERE username=?').get(username);
    if (!u || u.password !== hashPwd(password)) return json(res, 400, { error: '用户名或密码错误' });
    if (u.role === 'student') {
      if (!classCode) return json(res, 400, { error: '请输入班级码' });
      const cls = db.prepare('SELECT id FROM classes WHERE code=?').get(String(classCode).toUpperCase());
      if (!cls || cls.id !== u.class_id) return json(res, 400, { error: '班级码不匹配' });
    }
    return json(res, 200, { token: signToken(u.id, u.role), user: getUser(u.id) });
  }
  if (p === '/api/auth/me' && method === 'GET') {
    requireAuth(auth);
    return json(res, 200, { user: getUser(auth.uid) });
  }

  // ================= 教师：班级 =================
  if (p === '/api/classes' && method === 'GET') {
    requireRole(auth, 'teacher');
    const rows = db.prepare(`SELECT c.*, (SELECT COUNT(*) FROM users u WHERE u.class_id=c.id) AS student_count FROM classes c WHERE c.teacher_id=? ORDER BY c.id`).all(auth.uid);
    return json(res, 200, { classes: rows });
  }
  if (p === '/api/classes' && method === 'POST') {
    requireRole(auth, 'teacher');
    const { name, grade } = body;
    if (!name) return json(res, 400, { error: '请填写班级名称' });
    const code = genCode();
    const r = db.prepare('INSERT INTO classes(name,grade,code,teacher_id,created_at) VALUES(?,?,?,?,?)').run(String(name).slice(0, 40), grade || '未设置', code, auth.uid, now());
    return json(res, 200, { cls: db.prepare('SELECT * FROM classes WHERE id=?').get(Number(r.lastInsertRowid)) });
  }
  if (p.startsWith('/api/classes/') && method === 'DELETE') {
    requireRole(auth, 'teacher');
    const id = Number(p.split('/')[3]);
    const c = db.prepare('SELECT * FROM classes WHERE id=? AND teacher_id=?').get(id, auth.uid);
    if (!c) return json(res, 404, { error: '班级不存在' });
    db.prepare('DELETE FROM classes WHERE id=?').run(id);
    db.prepare(`UPDATE users SET class_id=NULL WHERE class_id=?`).run(id);
    return json(res, 200, { ok: true });
  }

  // ================= 教师：题库 =================
  if (p === '/api/questions' && method === 'GET') {
    requireRole(auth, 'teacher');
    const rows = db.prepare('SELECT id,type,content,options,answer,created_at FROM questions WHERE teacher_id=? ORDER BY id DESC').all(auth.uid);
    return json(res, 200, { questions: rows.map(q => ({ ...q, options: JSON.parse(q.options || '[]') })) });
  }
  if (p === '/api/questions' && method === 'POST') {
    requireRole(auth, 'teacher');
    const { type, content, options, answer } = body;
    if (!content) return json(res, 400, { error: '请输入题目内容' });
    if (!['choice', 'fill', 'judge', 'short'].includes(type)) return json(res, 400, { error: '题目类型错误' });
    if (type === 'choice' && (!Array.isArray(options) || options.length < 2)) return json(res, 400, { error: '请填写至少两个选项' });
    if (type !== 'short' && !answer && answer !== 0 && answer !== '0') return json(res, 400, { error: '请填写正确答案' });
    const r = db.prepare('INSERT INTO questions(teacher_id,type,content,options,answer,created_at) VALUES(?,?,?,?,?,?)')
      .run(auth.uid, type, content, JSON.stringify(options || []), String(answer), now());
    return json(res, 200, { question: db.prepare('SELECT * FROM questions WHERE id=?').get(Number(r.lastInsertRowid)) });
  }
  if (p.startsWith('/api/questions/') && method === 'DELETE') {
    requireRole(auth, 'teacher');
    db.prepare('DELETE FROM questions WHERE id=? AND teacher_id=?').run(Number(p.split('/')[3]), auth.uid);
    return json(res, 200, { ok: true });
  }
  if (p === '/api/questions/samples' && method === 'POST') {
    requireRole(auth, 'teacher');
    const samples = [
      { type: 'choice', content: '中国的首都是哪座城市？', options: ['上海', '北京', '广州', '深圳'], answer: '1' },
      { type: 'choice', content: '12 × 15 + 25 = ？', options: ['185', '205', '215', '195'], answer: '1' },
      { type: 'fill', content: '“床前明月光”的下一句是：', options: [], answer: '疑是地上霜' },
      { type: 'judge', content: '地球是太阳系中最大的行星。', options: ['正确', '错误'], answer: '1' },
      { type: 'short', content: '请用自己的话说说：为什么我们要保护环境？（不少于 20 字）', options: [], answer: '' },
      { type: 'choice', content: '下列哪个是质数？', options: ['4', '6', '9', '7'], answer: '3' },
    ];
    const ins = db.prepare('INSERT INTO questions(teacher_id,type,content,options,answer,created_at) VALUES(?,?,?,?,?,?)');
    for (const s of samples) ins.run(auth.uid, s.type, s.content, JSON.stringify(s.options), s.answer, now());
    return json(res, 200, { ok: true, n: samples.length });
  }

  // ================= 教师：作业 =================
  if (p === '/api/assignments' && method === 'GET') {
    requireAuth(auth);
    if (auth.role === 'teacher') {
      const rows = db.prepare('SELECT * FROM assignments WHERE teacher_id=? ORDER BY id DESC').all(auth.uid);
      return json(res, 200, { assignments: rows.map(enrichAssignment) });
    }
    const u = getUser(auth.uid);
    const all = db.prepare(`SELECT * FROM assignments WHERE published=1 ORDER BY id DESC`).all();
    const mine = all.filter(a => { const ids = JSON.parse(a.class_ids || '[]'); return ids.includes(u.class_id) || ids.length === 0; });
    return json(res, 200, { assignments: mine.map(a => enrichAssignment(a, auth.uid)) });
  }
  if (p === '/api/assignments' && method === 'POST') {
    requireRole(auth, 'teacher');
    const { title, description, class_ids, mode, deadline, question_ids } = body;
    if (!title) return json(res, 400, { error: '请输入作业标题' });
    if (!Array.isArray(question_ids) || question_ids.length === 0) return json(res, 400, { error: '请至少选择一道题目' });
    if (!deadline) return json(res, 400, { error: '请设置截止时间' });
    const dl = new Date(deadline).getTime();
    if (isNaN(dl) || dl < now()) return json(res, 400, { error: '截止时间必须晚于现在' });
    const r = db.prepare('INSERT INTO assignments(teacher_id,title,description,class_ids,mode,deadline,created_at) VALUES(?,?,?,?,?,?,?)')
      .run(auth.uid, title, description || '', JSON.stringify(class_ids || []), mode === 'battle' ? 'battle' : 'normal', dl, now());
    const aid = Number(r.lastInsertRowid);
    const ins = db.prepare('INSERT INTO assignment_questions(assignment_id,question_id,points,ord) VALUES(?,?,?,?)');
    question_ids.forEach((q, i) => ins.run(aid, q.id, q.points || 10, i));
    return json(res, 200, { assignment: enrichAssignment(db.prepare('SELECT * FROM assignments WHERE id=?').get(aid)) });
  }
  if (p.startsWith('/api/assignments/') && method === 'DELETE') {
    requireRole(auth, 'teacher');
    db.prepare('DELETE FROM assignments WHERE id=? AND teacher_id=?').run(Number(p.split('/')[3]), auth.uid);
    return json(res, 200, { ok: true });
  }
  if (p.endsWith('/publish') && method === 'POST') {
    requireRole(auth, 'teacher');
    const id = Number(p.split('/')[3]);
    const a = db.prepare('SELECT * FROM assignments WHERE id=? AND teacher_id=?').get(id, auth.uid);
    if (!a) return json(res, 404, { error: '作业不存在' });
    db.prepare('UPDATE assignments SET published=1, published_at=? WHERE id=?').run(now(), id);
    for (const clsId of JSON.parse(a.class_ids || '[]')) {
      const students = db.prepare('SELECT id FROM users WHERE class_id=? AND role=?').all(clsId, 'student');
      for (const s of students) for (const ws of subs.get('u:' + s.id) || []) sendWS(ws, { t: 'new_assignment', data: { title: a.title, mode: a.mode } });
    }
    return json(res, 200, { ok: true, assignment: enrichAssignment({ ...a, published: 1 }) });
  }
  if (p.endsWith('/unpublish') && method === 'POST') {
    requireRole(auth, 'teacher');
    const id = Number(p.split('/')[3]);
    db.prepare('UPDATE assignments SET published=0 WHERE id=? AND teacher_id=?').run(id, auth.uid);
    return json(res, 200, { ok: true });
  }
  if (p.startsWith('/api/assignments/') && method === 'GET') {
    requireAuth(auth);
    const id = Number(p.split('/')[3]);
    const a = db.prepare('SELECT * FROM assignments WHERE id=?').get(id);
    if (!a) return json(res, 404, { error: '作业不存在' });
    const qs = db.prepare(`SELECT aq.points, aq.ord, q.id, q.type, q.content, q.options, q.answer FROM assignment_questions aq JOIN questions q ON q.id=aq.question_id WHERE aq.assignment_id=? ORDER BY aq.ord`).all(id);
    const isTeacher = auth.role === 'teacher' && a.teacher_id === auth.uid;
    const questions = qs.map(q => ({ id: q.id, type: q.type, content: q.content, points: q.points, options: JSON.parse(q.options || '[]'), ...(isTeacher ? { answer: q.answer } : {}) }));
    const mine = db.prepare('SELECT * FROM submissions WHERE assignment_id=? AND student_id=?').get(id, auth.uid);
    const delayUsed = db.prepare('SELECT count FROM delay_uses WHERE assignment_id=? AND student_id=?').get(id, auth.uid)?.count || 0;
    return json(res, 200, { assignment: { ...a, class_ids: JSON.parse(a.class_ids || '[]'), questions, submitted: !!mine, mySubmission: mine || null, delayUsed, delayLimit: 4 } });
  }
  // 学生用延时铃
  if (p.endsWith('/delay') && method === 'POST') {
    requireRole(auth, 'student');
    const id = Number(p.split('/')[3]);
    const a = db.prepare('SELECT * FROM assignments WHERE id=? AND published=1').get(id);
    if (!a) return json(res, 404, { error: '作业不存在' });
    if (a.deadline < now()) return json(res, 400, { error: '作业已截止，无法使用延时铃' });
    const bell = db.prepare(`SELECT i.id FROM inventory i JOIN shop_items s ON s.id=i.item_id WHERE i.student_id=? AND s.category='tool' AND s.name='延时铃' AND i.qty>0`).get(auth.uid);
    if (!bell) return json(res, 400, { error: '背包里没有延时铃，先去商店兑换吧' });
    const du = db.prepare('SELECT * FROM delay_uses WHERE assignment_id=? AND student_id=?').get(id, auth.uid);
    if (du && du.count >= 4) return json(res, 400, { error: '该作业最多使用 4 次延时铃' });
    db.prepare('UPDATE inventory SET qty=qty-1 WHERE id=?').run(bell.id);
    db.prepare('DELETE FROM inventory WHERE qty<=0').run();
    if (du) db.prepare('UPDATE delay_uses SET count=count+1 WHERE id=?').run(du.id);
    else db.prepare('INSERT INTO delay_uses(assignment_id,student_id,count) VALUES(?,?,1)').run(id, auth.uid);
    db.prepare('UPDATE assignments SET deadline=deadline+1800000 WHERE id=?').run(id);
    const u = getUser(auth.uid);
    notifyTeacher(a.teacher_id, 'delay', `🔔 ${u.name} 对作业「${a.title}」使用了延时铃，截止时间延长 30 分钟`);
    return json(res, 200, { ok: true, deadline: a.deadline + 1800000, message: '延时成功！截止时间已延长 30 分钟，老师已收到通知' });
  }

  // ================= 学生：练习 =================
  if (p === '/api/questions/practice' && method === 'GET') {
    requireRole(auth, 'student');
    const limit = Math.min(Number(url.searchParams.get('limit') || 10), 30);
    const u = getUser(auth.uid);
    const rows = db.prepare(`SELECT q.id, q.type, q.content, q.options FROM questions q JOIN users t ON t.id=q.teacher_id WHERE t.class_id=? OR t.id IN (SELECT teacher_id FROM classes WHERE id=?) AND q.type!='short' ORDER BY RANDOM() LIMIT ?`).all(u.class_id, u.class_id, limit);
    return json(res, 200, { questions: rows.map(q => ({ ...q, options: JSON.parse(q.options || '[]') })) });
  }
  if (p === '/api/questions/practice/submit' && method === 'POST') {
    requireRole(auth, 'student');
    const { answers } = body;
    if (!Array.isArray(answers)) return json(res, 400, { error: '参数错误' });
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const earnedToday = db.prepare(`SELECT COALESCE(SUM(amount),0) AS s FROM points_ledger WHERE student_id=? AND reason='practice' AND created_at>=?`).get(auth.uid, today.getTime()).s;
    const capLeft = Math.max(0, 60 - earnedToday);
    let correct = 0, earned = 0;
    for (const a of answers) {
      const q = db.prepare('SELECT * FROM questions WHERE id=?').get(a.qid);
      if (!q) continue;
      if (judge(q, a.answer) === true) {
        correct++;
        if (earned + 2 <= capLeft) { earned += 2; }
      }
    }
    addCredits(auth.uid, earned, 'practice', '');
    const p = getPet(auth.uid);
    if (p && p.alive) {
      const delta = correct * 2 - (answers.length - correct) * 2;
      db.prepare('UPDATE pets SET happiness=? WHERE student_id=?').run(Math.max(0, Math.min(100, p.happiness + delta)), auth.uid);
    }
    return json(res, 200, { correct, total: answers.length, earned, capReached: earned < correct * 2 });
  }

  // ================= 学生：提交作业 =================
  if (p === '/api/submissions' && method === 'POST') {
    requireRole(auth, 'student');
    const { assignment_id, answers } = body;
    const a = db.prepare('SELECT * FROM assignments WHERE id=? AND published=1').get(assignment_id);
    if (!a) return json(res, 404, { error: '作业不存在' });
    if (a.mode === 'battle') return json(res, 400, { error: '对战作业请在对战入口参加' });
    if (a.deadline < now()) return json(res, 400, { error: '作业已截止' });
    if (db.prepare('SELECT 1 FROM submissions WHERE assignment_id=? AND student_id=?').get(assignment_id, auth.uid))
      return json(res, 400, { error: '你已经提交过该作业' });
    const qs = db.prepare(`SELECT aq.points, q.id, q.type, q.content, q.answer FROM assignment_questions aq JOIN questions q ON q.id=aq.question_id WHERE aq.assignment_id=?`).all(assignment_id);
    if (qs.length !== answers.length) return json(res, 400, { error: '还有题目未作答' });
    let score = 0, hasShort = false;
    const graded = [];
    for (let i = 0; i < qs.length; i++) {
      const q = qs[i], ans = answers[i];
      const ok = judge(q, ans?.answer);
      if (ok === null) { hasShort = true; graded.push({ qid: q.id, answer: ans?.answer || '', correct: null, points: q.points }); continue; }
      if (ok === true) score += q.points;
      graded.push({ qid: q.id, answer: ans?.answer || '', correct: ok, points: q.points });
    }
    const r = db.prepare('INSERT INTO submissions(assignment_id,student_id,answers,score,objective_score,graded,submitted_at) VALUES(?,?,?,?,?,?,?)')
      .run(assignment_id, auth.uid, JSON.stringify(graded), score, score, hasShort ? 0 : 1, now());
    // 前三名提交加分：按提交顺序，与作业是否含简答题无关
    const ranked = rankBonusFor(assignment_id, auth.uid);
    const subId = db.prepare('SELECT id FROM submissions WHERE assignment_id=? AND student_id=?').get(assignment_id, auth.uid).id;
    const totalCredits = score + ranked.bonus;
    if (totalCredits > 0) addCredits(auth.uid, totalCredits, 'submission', 'assignment:' + assignment_id);
    addExp(auth.uid, score / 2);
    const p = getPet(auth.uid);
    if (p && p.alive) db.prepare('UPDATE pets SET happiness=? WHERE student_id=?').run(Math.max(0, Math.min(100, p.happiness + 3)), auth.uid);
    const u = getUser(auth.uid);
    notifyTeacher(a.teacher_id, 'submit', `📝 ${u.name} 提交了作业「${a.title}」，得分 ${score}${ranked.rank ? `（第 ${ranked.rank} 名 +${ranked.bonus} 分）` : ''}${hasShort ? '，含简答题待批改' : ''}`);
    return json(res, 200, { submission: db.prepare('SELECT * FROM submissions WHERE id=?').get(subId), credits: totalCredits, rank: ranked.rank, rankBonus: ranked.bonus, hasShort });
  }

  // ================= 教师：查看提交 & 批改 =================
  if (p.startsWith('/api/submissions/assignment/') && method === 'GET') {
    requireRole(auth, 'teacher');
    const id = Number(p.split('/')[4]);
    const a = db.prepare('SELECT * FROM assignments WHERE id=? AND teacher_id=?').get(id, auth.uid);
    if (!a) return json(res, 404, { error: '作业不存在' });
    const qs = db.prepare(`SELECT aq.points, q.id, q.type, q.content, q.answer, q.options FROM assignment_questions aq JOIN questions q ON q.id=aq.question_id WHERE aq.assignment_id=? ORDER BY aq.ord`).all(id);
    const subs = db.prepare(`SELECT s.*, u.name AS student_name, u.class_id FROM submissions s JOIN users u ON u.id=s.student_id WHERE s.assignment_id=? ORDER BY s.submitted_at`).all(id);
    const classNames = {};
    for (const s of subs) classNames[s.class_id] = db.prepare('SELECT name FROM classes WHERE id=?').get(s.class_id)?.name || '未知班级';
    return json(res, 200, {
      assignment: a,
      questions: qs.map(q => ({ ...q, options: JSON.parse(q.options || '[]') })),
      submissions: subs.map(s => ({ ...s, answers: JSON.parse(s.answers || '[]'), class_name: classNames[s.class_id] })),
    });
  }
  if (p.startsWith('/api/submissions/') && p.endsWith('/grade') && method === 'POST') {
    requireRole(auth, 'teacher');
    const id = Number(p.split('/')[3]);
    const { grade, comment } = body;
    if (!['A+', 'A', 'B+', 'B', 'C', 'D'].includes(grade)) return json(res, 400, { error: '等第错误' });
    const sub = db.prepare(`SELECT s.*, a.teacher_id FROM submissions s JOIN assignments a ON a.id=s.assignment_id WHERE s.id=?`).get(id);
    if (!sub || sub.teacher_id !== auth.uid) return json(res, 404, { error: '提交记录不存在' });
    const multiplier = { 'A+': 1, 'A': 0.9, 'B+': 0.8, 'B': 0.7, 'C': 0.6, 'D': 0.5 }[grade];
    const answers = JSON.parse(sub.answers || '[]');
    let shortPoints = 0;
    for (const ans of answers) if (ans.correct === null) shortPoints += ans.points * multiplier;
    const newScore = sub.objective_score + Math.round(shortPoints);
    const delta = newScore - sub.score;
    db.prepare('UPDATE submissions SET grade=?, comment=?, graded=1, score=? WHERE id=?').run(grade, comment || '', newScore, id);
    if (delta > 0) addCredits(sub.student_id, delta, 'grade_bonus', 'submission:' + sub.id);
    const u = getUser(sub.student_id);
    for (const ws of subs.get('u:' + sub.student_id) || []) sendWS(ws, { t: 'graded', data: { grade, comment: comment || '', score: newScore } });
    return json(res, 200, { ok: true, score: newScore, delta });
  }

  // ================= 学情统计 =================
  if (p.startsWith('/api/stats/assignment/') && method === 'GET') {
    requireRole(auth, 'teacher');
    const id = Number(p.split('/')[4]);
    const scope = url.searchParams.get('scope') || 'mine'; // mine | grade
    const a = db.prepare('SELECT * FROM assignments WHERE id=? AND teacher_id=?').get(id, auth.uid);
    if (!a) return json(res, 404, { error: '作业不存在' });
    const qs = db.prepare(`SELECT aq.points, q.id, q.type, q.content FROM assignment_questions aq JOIN questions q ON q.id=aq.question_id WHERE aq.assignment_id=? ORDER BY aq.ord`).all(id);
    const classIds = JSON.parse(a.class_ids || '[]');
    let classes = classIds.map(cid => db.prepare('SELECT * FROM classes WHERE id=?').get(cid)).filter(Boolean);
    if (scope === 'grade') {
      const grade = classes[0]?.grade;
      if (grade && grade !== '未设置') {
        classes = db.prepare(`SELECT * FROM classes WHERE grade=? ORDER BY id`).all(grade);
      }
    }
    const perClass = classes.map(c => {
      const students = db.prepare('SELECT id FROM users WHERE class_id=? AND role=?').all(c.id, 'student');
      const subs = db.prepare(`SELECT * FROM submissions WHERE assignment_id=? AND student_id IN (${students.map(s => s.id).join(',') || '0'})`).all(id);
      const avg = subs.length ? subs.reduce((s, x) => s + x.score, 0) / subs.length : 0;
      return { class: c, total: students.length, submitted: subs.length, rate: students.length ? Math.round(subs.length / students.length * 100) : 0, avgScore: Math.round(avg * 10) / 10 };
    });
    const perQuestion = qs.map(q => {
      const subs = db.prepare(`SELECT s.answers FROM submissions s JOIN users u ON u.id=s.student_id WHERE s.assignment_id=? AND u.class_id IN (${classes.map(c => c.id).join(',') || '0'})`).all(id);
      let correct = 0, total = 0;
      for (const s of subs) {
        const answers = JSON.parse(s.answers || '[]');
        const ans = answers.find(x => x.qid === q.id);
        if (ans && ans.correct !== null) { total++; if (ans.correct) correct++; }
      }
      return { ...q, accuracy: total ? Math.round(correct / total * 100) : null, answered: total };
    });
    const allStudents = classes.flatMap(c => db.prepare('SELECT id FROM users WHERE class_id=? AND role=?').all(c.id, 'student'));
    const allSubs = allStudents.length ? db.prepare(`SELECT * FROM submissions WHERE assignment_id=? AND student_id IN (${allStudents.map(s => s.id).join(',')})`).all(id) : [];
    return json(res, 200, {
      assignment: a,
      perClass,
      perQuestion,
      totalStudents: allStudents.length,
      totalSubmitted: allSubs.length,
      totalRate: allStudents.length ? Math.round(allSubs.length / allStudents.length * 100) : 0,
      avgScore: allSubs.length ? Math.round(allSubs.reduce((s, x) => s + x.score, 0) / allSubs.length * 10) / 10 : 0,
    });
  }

  // ================= 排行榜 =================
  if (p === '/api/leaderboard' && method === 'GET') {
    requireAuth(auth);
    const scope = url.searchParams.get('scope'); // mine(班内) | all(全服)
    const u = getUser(auth.uid);
    const lb = scope === 'all' ? leaderboard(null) : leaderboard(u.class_id);
    const mine = lb.find(x => x.id === auth.uid)?.rank || null;
    return json(res, 200, { leaderboard: lb, myRank: mine, myCredits: u.credits, titles: TITLES.filter(t => u.credits >= t.min) });
  }

  // ================= 商店 =================
  if (p === '/api/shop' && method === 'GET') {
    requireAuth(auth);
    const p0 = getPet(auth.uid);
    const lv = p0?.level || 1;
    const items = db.prepare('SELECT * FROM shop_items ORDER BY category, id').all().map(i => ({ ...i, effect: JSON.parse(i.effect || '{}'), locked: lv < i.min_level }));
    return json(res, 200, { items, level: lv });
  }
  if (p === '/api/inventory' && method === 'GET') {
    requireAuth(auth);
    const rows = db.prepare(`SELECT i.qty, s.* FROM inventory i JOIN shop_items s ON s.id=i.item_id WHERE i.student_id=? ORDER BY i.id`).all(auth.uid);
    return json(res, 200, { inventory: rows.map(r => ({ ...r, effect: JSON.parse(r.effect || '{}') })) });
  }
  if (p === '/api/shop/purchase' && method === 'POST') {
    requireRole(auth, 'student');
    const { item_id } = body;
    const item = db.prepare('SELECT * FROM shop_items WHERE id=?').get(item_id);
    if (!item) return json(res, 404, { error: '商品不存在' });
    const p0 = getPet(auth.uid);
    if (p0.level < item.min_level) return json(res, 400, { error: `宠物达到 ${item.min_level} 级才能购买` });
    const u = getUser(auth.uid);
    if (u.credits < item.price) return json(res, 400, { error: '学分不足，快去做作业赚学分吧！' });
    db.prepare('UPDATE users SET credits=credits-? WHERE id=?').run(item.price, auth.uid);
    db.prepare('INSERT INTO points_ledger(student_id,amount,reason,ref,created_at) VALUES(?,?,?,?,?)').run(auth.uid, -item.price, 'purchase', item.name, now());
    const inv = db.prepare('SELECT * FROM inventory WHERE student_id=? AND item_id=?').get(auth.uid, item_id);
    if (inv) db.prepare('UPDATE inventory SET qty=qty+1 WHERE id=?').run(inv.id);
    else db.prepare('INSERT INTO inventory(student_id,item_id,qty) VALUES(?,?,1)').run(auth.uid, item_id);
    return json(res, 200, { ok: true, credits: u.credits - item.price, item: { ...item, effect: JSON.parse(item.effect || '{}') } });
  }
  // 使用物品
  if (p === '/api/pet/use' && method === 'POST') {
    requireRole(auth, 'student');
    const { item_id } = body;
    const inv = db.prepare('SELECT * FROM inventory WHERE student_id=? AND item_id=? AND qty>0').get(auth.uid, item_id);
    if (!inv) return json(res, 400, { error: '背包里没有这个物品' });
    const item = db.prepare('SELECT * FROM shop_items WHERE id=?').get(item_id);
    const eff = JSON.parse(item.effect || '{}');
    const p = getPet(auth.uid);
    if (!p || !p.alive) return json(res, 400, { error: '宠物现在无法使用物品…先复活它吧' });
    let msg = '';
    if (item.category === 'food') {
      db.prepare('UPDATE pets SET hunger=? WHERE student_id=?').run(Math.min(100, p.hunger + (eff.hunger || 0)), auth.uid);
      if (eff.exp) addExp(auth.uid, eff.exp);
      if (eff.happiness) db.prepare('UPDATE pets SET happiness=? WHERE student_id=?').run(Math.min(100, p.happiness + eff.happiness), auth.uid);
      msg = `喂食成功！${p.name} 的饥饿值恢复了 ${eff.hunger || 0}`;
    } else if (item.category === 'pet') {
      db.prepare('UPDATE pets SET happiness=? WHERE student_id=?').run(Math.min(100, p.happiness + (eff.happiness || 0)), auth.uid);
      if (eff.exp) addExp(auth.uid, eff.exp);
      msg = `使用「${item.name}」成功！${p.name} 的愉悦值 +${eff.happiness || 0}`;
    } else if (item.category === 'dress') {
      db.prepare('UPDATE pets SET happiness=? WHERE student_id=?').run(Math.min(100, p.happiness + (eff.happiness || 0)), auth.uid);
      if (item.name === '超人披风') db.prepare('UPDATE pets SET acc=? WHERE student_id=?').run(item.emoji, auth.uid);
      else db.prepare('UPDATE pets SET hat=? WHERE student_id=?').run(item.emoji, auth.uid);
      msg = `装扮成功！${p.name} 戴上了「${item.name}」，愉悦值 +${eff.happiness || 0}`;
    } else {
      return json(res, 400, { error: '延时铃请在作业列表中使用' });
    }
    db.prepare('UPDATE inventory SET qty=qty-1 WHERE id=?').run(inv.id);
    db.prepare('DELETE FROM inventory WHERE qty<=0').run();
    return json(res, 200, { ok: true, pet: getPet(auth.uid), msg });
  }

  // ================= 宠物 =================
  if (p === '/api/pet/mine' && method === 'GET') {
    requireRole(auth, 'student');
    const p = getPet(auth.uid);
    const u = getUser(auth.uid);
    if (!p) return json(res, 404, { error: '还没有宠物' });
    const [emoji, stage] = SPECIES[p.species]?.stages[Math.min(3, p.level >= 10 ? 3 : p.level >= 7 ? 2 : p.level >= 4 ? 1 : 0)] || ['🐾', ''];
    const next = p.level < 10 ? LEVELS[p.level] : 0;
    const rate = growthRate(p);
    return json(res, 200, {
      pet: { ...p, emoji, stage, stageName: stage, nextExp: next, growthRate: rate, speciesName: SPECIES[p.species]?.name || '' },
      levelUnlocks: Object.fromEntries(Object.entries(LEVEL_UNLOCKS).map(([lv, d]) => [lv, { desc: d, unlocked: p.level >= lv }])),
      titles: TITLES,
      myTitle: u.title,
      totalCredits: u.credits,
    });
  }
  if (p === '/api/pet/revive' && method === 'POST') {
    requireRole(auth, 'student');
    const p = getPet(auth.uid);
    if (!p || p.alive) return json(res, 400, { error: '宠物不需要复活' });
    const u = getUser(auth.uid);
    if (u.credits < 30) return json(res, 400, { error: '复活需要 30 学分，快去答题赚学分吧' });
    db.prepare('UPDATE users SET credits=credits-30 WHERE id=?').run(auth.uid);
    db.prepare('INSERT INTO points_ledger(student_id,amount,reason,ref,created_at) VALUES(?,?,?,?,?)').run(auth.uid, -30, 'revive', '', now());
    db.prepare('UPDATE pets SET alive=1, hunger=60, happiness=60, last_decay=? WHERE student_id=?').run(now(), auth.uid);
    return json(res, 200, { ok: true, msg: `${p.name} 复活啦！以后要记得按时喂食哦～` });
  }
  if (p === '/api/pet/chat' && method === 'POST') {
    requireRole(auth, 'student');
    const p = getPet(auth.uid);
    const { message } = body;
    if (!p || !p.alive) return json(res, 200, { reply: PET_CHAT_DEAD[0] });
    if (p.level < 3) return json(res, 200, { reply: `${p.name} 还太小了，听不懂你在说什么～ 升到 3 级就能对话啦！` });
    const m = String(message || '');
    const sad = /(难过|伤心|哭|累|烦|压力|焦虑|害怕|委屈|不开心|失落|emo)/.test(m);
    const hungry = /(饿|吃)/.test(m);
    let reply;
    if (sad) reply = PET_CHAT_COMFORT[crypto.randomInt(PET_CHAT_COMFORT.length)];
    else if (p.hunger < 30) reply = PET_CHAT_HUNGRY[crypto.randomInt(PET_CHAT_HUNGRY.length)];
    else if (p.happiness < 30) reply = PET_CHAT_SAD[crypto.randomInt(PET_CHAT_SAD.length)];
    else reply = PET_CHAT_HAPPY[crypto.randomInt(PET_CHAT_HAPPY.length)];
    if (sad) db.prepare('UPDATE pets SET happiness=? WHERE student_id=?').run(Math.min(100, p.happiness + 2), auth.uid);
    return json(res, 200, { reply });
  }
  if (p === '/api/pet/title' && method === 'POST') {
    requireRole(auth, 'student');
    const p = getPet(auth.uid);
    if (!p || p.level < 5) return json(res, 400, { error: '宠物达到 5 级才能设置称号' });
    const u = getUser(auth.uid);
    const { title } = body;
    const t = TITLES.find(x => x.name === title);
    if (!t || u.credits < t.min) return json(res, 400, { error: '称号未解锁' });
    db.prepare('UPDATE users SET title=? WHERE id=?').run(title, auth.uid);
    return json(res, 200, { ok: true });
  }
  // 运动会（7级）：猜点数
  if (p === '/api/pet/race' && method === 'POST') {
    requireRole(auth, 'student');
    const p = getPet(auth.uid);
    if (!p || !p.alive || p.level < 7) return json(res, 400, { error: '宠物达到 7 级才能参加运动会' });
    const { guess } = body;
    if (![1, 2, 3, 4, 5, 6].includes(Number(guess))) return json(res, 400, { error: '请输入 1-6 的点数' });
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const cnt = db.prepare(`SELECT COUNT(*) AS n FROM points_ledger WHERE student_id=? AND reason='race' AND created_at>=?`).get(auth.uid, today.getTime()).n;
    if (cnt >= 3) return json(res, 400, { error: '今天 3 次机会用完啦，明天再来吧' });
    const serverDice = crypto.randomInt(1, 7);
    const win = Number(guess) === serverDice;
    if (win) addCredits(auth.uid, 5, 'race', '');
    return json(res, 200, { win, dice: serverDice, guess: Number(guess), chanceLeft: 2 - cnt });
  }
  // 每日礼盒（9级）
  if (p === '/api/pet/lottery' && method === 'POST') {
    requireRole(auth, 'student');
    const p = getPet(auth.uid);
    if (!p || !p.alive || p.level < 9) return json(res, 400, { error: '宠物达到 9 级才能领取每日礼盒' });
    const today = new Date().toISOString().slice(0, 10);
    const key = 'lottery:' + auth.uid + ':' + today;
    if (db.prepare(`SELECT 1 FROM points_ledger WHERE student_id=? AND reason='lottery' AND ref=?`).get(auth.uid, key)) return json(res, 400, { error: '今天的礼盒已经领过啦' });
    const amount = 10 + crypto.randomInt(0, 21); // 10-30
    addCredits(auth.uid, amount, 'lottery', key);
    return json(res, 200, { ok: true, amount });
  }
  // 宠物广场（4级）
  if (p === '/api/pet/square' && method === 'GET') {
    requireRole(auth, 'student');
    const p = getPet(auth.uid);
    if (!p || p.level < 4) return json(res, 400, { error: '宠物达到 4 级才能进入宠物广场' });
    const rows = db.prepare(`SELECT pp.id, pp.content, pp.likes, pp.created_at, u.name AS uname, u.id AS uid, pets.species, pets.level, pets.hat, pets.acc FROM pet_posts pp JOIN users u ON u.id=pp.student_id JOIN pets ON pets.student_id=pp.student_id WHERE pets.alive=1 ORDER BY pp.id DESC LIMIT 50`).all();
    return json(res, 200, { posts: rows.map(r => ({ ...r, likes: JSON.parse(r.likes || '[]'), liked: JSON.parse(r.likes || '[]').includes(auth.uid) })) });
  }
  if (p === '/api/pet/square' && method === 'POST') {
    requireRole(auth, 'student');
    const p = getPet(auth.uid);
    if (!p || p.level < 4) return json(res, 400, { error: '宠物达到 4 级才能发帖' });
    const { content } = body;
    if (!content || String(content).length > 100) return json(res, 400, { error: '内容不能为空且不超过 100 字' });
    db.prepare('INSERT INTO pet_posts(student_id,content,created_at) VALUES(?,?,?)').run(auth.uid, String(content), now());
    return json(res, 200, { ok: true });
  }
  if (p.startsWith('/api/pet/square/') && p.endsWith('/like') && method === 'POST') {
    requireRole(auth, 'student');
    const id = Number(p.split('/')[4]);
    const post = db.prepare('SELECT * FROM pet_posts WHERE id=?').get(id);
    if (!post) return json(res, 404, { error: '帖子不存在' });
    const likes = JSON.parse(post.likes || '[]');
    const idx = likes.indexOf(auth.uid);
    if (idx >= 0) likes.splice(idx, 1); else likes.push(auth.uid);
    db.prepare('UPDATE pet_posts SET likes=? WHERE id=?').run(JSON.stringify(likes), id);
    return json(res, 200, { ok: true, liked: idx < 0, count: likes.length });
  }

  // ================= 管理员：数据导出/导入（用于备份和云迁移）=================
  if (p === '/api/admin/export' && method === 'GET') {
    if (url.searchParams.get('key') !== ADMIN_KEY) return json(res, 403, { error: '管理员密钥错误' });
    const data = {};
    for (const t of ALL_TABLES) data[t] = db.prepare(`SELECT * FROM ${t}`).all();
    return json(res, 200, { secret: SECRET, data });
  }
  if (p === '/api/admin/import' && method === 'POST') {
    if (url.searchParams.get('key') !== ADMIN_KEY) return json(res, 403, { error: '管理员密钥错误' });
    const { secret, data } = body;
    if (!secret || !data || !Array.isArray(data.users)) return json(res, 400, { error: '数据格式错误' });
    fs.writeFileSync(SECRET_FILE, String(secret));
    db.exec('BEGIN');
    try {
      for (const t of ALL_TABLES) db.exec(`DELETE FROM ${t}`);
      for (const t of ALL_TABLES) {
        const rows = Array.isArray(data[t]) ? data[t] : [];
        if (!rows.length) continue;
        const cols = Object.keys(rows[0]);
        const ins = db.prepare(`INSERT INTO ${t} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`);
        for (const row of rows) ins.run(...cols.map(c => row[c]));
      }
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    return json(res, 200, { ok: true, msg: '数据已导入。密钥已更新，请重启服务后生效（重启后原账号密码不变）' });
  }

  // ================= 通知 =================
  if (p === '/api/notifications' && method === 'GET') {
    requireRole(auth, 'teacher');
    const rows = db.prepare('SELECT * FROM notifications WHERE teacher_id=? ORDER BY id DESC LIMIT 50').all(auth.uid);
    return json(res, 200, { notifications: rows, unread: rows.filter(r => !r.read).length });
  }
  if (p === '/api/notifications/read' && method === 'POST') {
    requireRole(auth, 'teacher');
    db.prepare('UPDATE notifications SET read=1 WHERE teacher_id=?').run(auth.uid);
    return json(res, 200, { ok: true });
  }

  return json(res, 404, { error: '接口不存在' });
}

// ---------- 作业信息补全 ----------
function enrichAssignment(a, sid) {
  const qcount = db.prepare('SELECT COUNT(*) AS n FROM assignment_questions WHERE assignment_id=?').get(a.id).n;
  const subCount = db.prepare('SELECT COUNT(*) AS n FROM submissions WHERE assignment_id=?').get(a.id).n;
  const my = sid ? db.prepare('SELECT * FROM submissions WHERE assignment_id=? AND student_id=?').get(a.id, sid) : null;
  const cls = JSON.parse(a.class_ids || '[]').map(id => db.prepare('SELECT id,name FROM classes WHERE id=?').get(id)).filter(Boolean);
  return {
    id: a.id, title: a.title, description: a.description, mode: a.mode, deadline: a.deadline,
    published: a.published, published_at: a.published_at, created_at: a.created_at,
    classes: cls, questionCount: qcount, submissionCount: subCount,
    myScore: my?.score ?? null, myGrade: my?.grade || '', myRank: my?.rank || 0, myRankBonus: my?.rank_bonus || 0,
    graded: my ? my.graded : null,
  };
}

server.listen(PORT, () => {
  console.log('课堂互动乐园 服务器已启动: http://localhost:' + PORT);
});
