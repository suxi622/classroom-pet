'use strict';
/* 全流程测试脚本：教师注册→建班→出题→布置作业→发布→学生注册登录→练习→交作业→批改→商店→延时铃→宠物→排行榜→统计→对战 */
const BASE = 'http://localhost:8787';
let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ✔', name); }
  else { fail++; console.log('  ✘', name, extra ? JSON.stringify(extra).slice(0, 300) : ''); }
}
async function api(path, opts = {}, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const res = await fetch(BASE + path, { method: opts.method || 'GET', headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}
const rand = () => 'u' + Math.random().toString(36).slice(2, 8);

(async () => {
  console.log('== 1. 教师注册 + 建班 ==');
  let r = await api('/api/auth/register', { method: 'POST', body: { role: 'teacher', username: 'teacher_' + rand(), password: 'test123456', name: '王老师', classes: [{ name: '四年级1班', grade: '四年级' }, { name: '四年级2班', grade: '四年级' }] } });
  check('教师注册成功', r.status === 200 && r.data.token);
  const tToken = r.data.token;
  check('教师注册即带2个班级', r.data.user?.role === 'teacher');
  r = await api('/api/classes', {}, tToken);
  check('班级列表2个', r.data.classes?.length === 2, r.data);
  const classCodes = r.data.classes.map(c => c.code);
  const classId = r.data.classes[0].id;
  check('班级码6位且不重复', classCodes.every(c => /^[A-Z0-9]{6}$/.test(c)) && new Set(classCodes).size === 2);

  console.log('== 2. 题库 ==');
  r = await api('/api/questions/samples', { method: 'POST' }, tToken);
  check('导入示例题6道', r.data.n === 6);
  r = await api('/api/questions', {}, tToken);
  check('题目列表6道', r.data.questions?.length === 6, r.data);
  const qs = r.data.questions;
  // 四种题型逐一创建（简答题 answer 为空必须允许）
  for (const [tn, tb] of [
    ['选择题', { type: 'choice', content: '1+1=?', options: ['1', '2', '3'], answer: '1' }],
    ['判断题', { type: 'judge', content: '1+1=2', options: [], answer: '0' }],
    ['填空题', { type: 'fill', content: '中国的首都是____', options: [], answer: '北京' }],
    ['简答题', { type: 'short', content: '说说你的想法', options: [], answer: '' }],
  ]) {
    const x = await api('/api/questions', { method: 'POST', body: tb }, tToken);
    check('创建' + tn, x.status === 200, x.data);
  }

  console.log('== 3. 布置作业（传统含简答 + 对战）==');
  const dl = new Date(Date.now() + 3600000).toISOString();
  r = await api('/api/assignments', { method: 'POST', body: { title: '第一单元测试', description: '加油！', class_ids: [classId], mode: 'normal', deadline: dl, question_ids: qs.slice(0, 5).map((q, i) => ({ id: q.id, points: 10 })) } }, tToken);
  check('创建传统作业', r.status === 200 && r.data.assignment?.questionCount === 5, r.data);
  const normalId = r.data.assignment.id;
  r = await api('/api/assignments', { method: 'POST', body: { title: '口算大乱斗', class_ids: [classId], mode: 'battle', deadline: dl, question_ids: qs.slice(0, 3).map((q, i) => ({ id: q.id, points: 10 })) } }, tToken);
  check('创建对战作业', r.status === 200 && r.data.assignment?.mode === 'battle', r.data);
  const battleId = r.data.assignment.id;
  r = await api(`/api/assignments/${normalId}/publish`, { method: 'POST' }, tToken);
  check('发布传统作业', r.status === 200);
  r = await api(`/api/assignments/${battleId}/publish`, { method: 'POST' }, tToken);
  check('发布对战作业', r.status === 200);
  r = await api('/api/assignments', { method: 'POST', body: { title: '过期作业', class_ids: [classId], mode: 'normal', deadline: '2020-01-01T00:00:00Z', question_ids: [{ id: qs[0].id, points: 10 }] } }, tToken);
  check('截止时间早于现在被拒绝', r.status === 400, r.data);

  console.log('== 4. 学生注册 / 登录 ==');
  r = await api('/api/auth/register', { method: 'POST', body: { role: 'student', username: 'stu_' + rand(), password: 'test123456', name: '张三', classCode: 'WRONG1', species: 'cat', petName: '小花' } });
  check('错误班级码被拒绝', r.status === 400);
  const stu1 = { username: 'stu_' + rand(), password: 'test123456', name: '张三' };
  r = await api('/api/auth/register', { method: 'POST', body: { role: 'student', ...stu1, classCode: classCodes[0], species: 'cat', petName: '小花' } });
  check('学生注册成功', r.status === 200 && r.data.user?.role === 'student', r.data);
  const s1Token = r.data.token;
  const stu2 = { username: 'stu_' + rand(), password: 'test123456', name: '李四' };
  r = await api('/api/auth/register', { method: 'POST', body: { role: 'student', ...stu2, classCode: classCodes[0], species: 'dragon', petName: '小火' } });
  const s2Token = r.data.token;
  check('第二个学生注册成功', r.status === 200);
  r = await api('/api/auth/login', { method: 'POST', body: { username: stu1.username, password: stu1.password, classCode: 'BADCOD' } });
  check('班级码不匹配被拒绝', r.status === 400);
  r = await api('/api/auth/login', { method: 'POST', body: { username: stu1.username, password: stu1.password, classCode: classCodes[0] } });
  check('学生登录需班级码', r.status === 200 && r.data.token);

  console.log('== 5. 练习 ==');
  r = await api('/api/questions/practice?limit=5', {}, s1Token);
  check('练习抽题5道', r.data.questions?.length === 5, r.data);
  const prAns = r.data.questions.map(q => ({ qid: q.id, answer: q.type === 'choice' || q.type === 'judge' ? '0' : '随便' }));
  r = await api('/api/questions/practice/submit', { method: 'POST', body: { answers: prAns } }, s1Token);
  check('练习提交判分', r.status === 200 && typeof r.data.correct === 'number', r.data);

  console.log('== 6. 学生交传统作业（前3名加分）==');
  r = await api(`/api/assignments/${normalId}`, {}, s1Token);
  check('学生看到作业详情(无答案)', r.status === 200 && r.data.assignment.questions.every(q => q.answer === undefined), r.data);
  const goodAns = q => {
    if (q.type === 'short') return '保护环境人人有责，我们要从小事做起。';
    if (q.type === 'fill') return '疑是地上霜';
    if (q.type === 'judge') return '1';
    if (q.content.includes('质数')) return '3';
    if (q.content.includes('12 × 15')) return '1';
    return '1'; // 首都=北京
  };
  const s1Answers = r.data.assignment.questions.map(q => ({ answer: goodAns(q) }));
  r = await api('/api/submissions', { method: 'POST', body: { assignment_id: normalId, answers: s1Answers } }, s1Token);
  check('张三提交成功', r.status === 200 && r.data.submission?.rank === 1, r.data);
  check('第1名+20分', r.data.rankBonus === 20, r.data);
  r = await api(`/api/assignments/${normalId}`, {}, s1Token);
  check('张三已完成(不可重复提交)', r.status === 200 && r.data.assignment.submitted === true, r.data.assignment?.submitted);
  // 李四提交
  const s2Detail = (await api(`/api/assignments/${normalId}`, {}, s2Token)).data;
  const s2Answers = s2Detail.assignment.questions.map(q => ({ answer: q.type === 'choice' || q.type === 'judge' ? '0' : q.type === 'fill' ? '随便' : '简答内容' }));
  r = await api('/api/submissions', { method: 'POST', body: { assignment_id: normalId, answers: s2Answers } }, s2Token);
  check('李四提交第2名+12分', r.data.rank === 2 && r.data.rankBonus === 12, r.data);

  console.log('== 7. 教师查看提交 + 批改 ==');
  r = await api(`/api/submissions/assignment/${normalId}`, {}, tToken);
  check('教师看到2份提交', r.data.submissions?.length === 2, r.data);
  const zhangSub = r.data.submissions.find(s => s.student_name === '张三');
  check('张三客观题得分', zhangSub && zhangSub.objective_score >= 10, zhangSub);
  check('含简答题待批改', zhangSub && zhangSub.graded === 0);
  r = await api(`/api/submissions/${zhangSub.id}/grade`, { method: 'POST', body: { grade: 'A+', comment: '书写工整，思路清晰，继续保持！' } }, tToken);
  check('批改A+成功', r.status === 200 && r.data.delta > 0, r.data);
  r = await api(`/api/submissions/assignment/${normalId}`, {}, tToken);
  const graded = r.data.submissions.find(s => s.id === zhangSub.id);
  check('等第与评语已保存', graded.grade === 'A+' && graded.comment.includes('书写工整'), graded);

  console.log('== 8. 学情统计 ==');
  r = await api(`/api/stats/assignment/${normalId}?scope=mine`, {}, tToken);
  check('班级平行比较', r.data.perClass?.length >= 1 && r.data.totalRate === 100, r.data);
  check('每题正确率', r.data.perQuestion?.length === 5);
  r = await api(`/api/stats/assignment/${normalId}?scope=grade`, {}, tToken);
  check('年级内比较可用', r.status === 200 && r.data.perClass?.length >= 1, r.data);

  console.log('== 9. 商店 / 喂食 / 延时铃 ==');
  r = await api('/api/shop', {}, s1Token);
  check('商店13件商品', r.data.items?.length >= 13, r.data);
  const food = r.data.items.find(i => i.category === 'food');
  const bell = r.data.items.find(i => i.name === '延时铃');
  r = await api('/api/shop/purchase', { method: 'POST', body: { item_id: food.id } }, s1Token);
  check('购买食物', r.status === 200);
  r = await api('/api/pet/use', { method: 'POST', body: { item_id: food.id } }, s1Token);
  check('喂食成功', r.status === 200 && r.data.pet?.hunger > 95, r.data);
  r = await api('/api/shop/purchase', { method: 'POST', body: { item_id: bell.id } }, s1Token);
  check('购买延时铃', r.status === 200);
  const before = (await api(`/api/assignments/${normalId}`, {}, s1Token)).data.assignment.deadline;
  r = await api(`/api/assignments/${normalId}/delay`, { method: 'POST' }, s1Token);
  check('延时铃延长30分钟', r.status === 200 && r.data.deadline === before + 1800000, r.data);
  r = await api('/api/notifications', {}, tToken);
  check('老师收到延时铃通知', r.data.notifications?.some(n => n.type === 'delay' && n.content.includes('张三')), r.data.notifications?.slice(0, 3));
  check('老师收到交作业通知', r.data.notifications?.some(n => n.type === 'submit'));

  console.log('== 10. 宠物系统 ==');
  r = await api('/api/pet/mine', {}, s1Token);
  check('宠物信息完整', r.status === 200 && r.data.pet?.alive === 1 && r.data.pet.level >= 1, r.data);
  check('10级解锁列表', Object.keys(r.data.levelUnlocks).length === 9);
  r = await api('/api/pet/chat', { method: 'POST', body: { message: '今天好难过' } }, s1Token);
  check('未到3级不能对话', r.data.reply?.includes('3 级'), r.data);
  r = await api('/api/pet/square', {}, s1Token);
  check('未到4级不能进广场', r.status === 400);

  console.log('== 11. 排行榜 ==');
  r = await api('/api/leaderboard?scope=mine', {}, s1Token);
  check('排行榜有数据', r.data.leaderboard?.length >= 2 && r.data.leaderboard[0].icon === '🥇', r.data);
  check('我的排名存在', typeof r.data.myRank === 'number');

  console.log('== 12. 通知已读 ==');
  r = await api('/api/notifications/read', { method: 'POST' }, tToken);
  check('标记已读', r.status === 200);

  console.log('== 13. 对战（WebSocket 双客户端）==');
  await battleTest(classCodes[0], battleId, tToken);

  console.log(`\n======== 结果: ${pass} 通过 / ${fail} 失败 ========`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('测试崩溃:', e); process.exit(1); });

/* ---------- 对战测试 ---------- */
async function battleTest(classCode, battleId, tToken) {
  const mkStudent = async (name, species) => {
    const r = await api('/api/auth/register', { method: 'POST', body: { role: 'student', username: 'btl_' + rand(), password: 'test123456', name, classCode, species, petName: name + '的宠物' } });
    return r.data.token;
  };
  const t1 = await mkStudent('小明', 'cat');
  const t2 = await mkStudent('小红', 'fox');

  const wsUrl = BASE.replace('http', 'ws') + '/ws?token=';
  const mk = (token) => new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl + token);
    ws.msgs = [];
    ws.used = 0;
    ws.onmessage = e => { ws.msgs.push(JSON.parse(e.data)); };
    ws.onerror = e => reject(e);
    ws.onopen = () => resolve(ws);
  });
  const ws1 = await mk(t1), ws2 = await mk(t2);
  const send = (ws, m) => ws.send(JSON.stringify(m));
  const waitMsg = (ws, pred, timeout = 8000) => new Promise((res, rej) => {
    const t0 = Date.now();
    const iv = setInterval(() => {
      for (let i = ws.used; i < ws.msgs.length; i++) {
        if (pred(ws.msgs[i])) { ws.used = i + 1; clearInterval(iv); return res(ws.msgs[i]); }
      }
      if (Date.now() - t0 > timeout) { clearInterval(iv); rej(new Error('超时等待消息, got: ' + JSON.stringify(ws.msgs.slice(ws.used)))); }
    }, 50);
  });
  const goodAns = q => {
    if (q.content.includes('质数')) return '3';
    if (q.content.includes('12 × 15')) return '1';
    if (q.content.includes('首都')) return '1';
    if (q.type === 'judge') return '1';
    return '答案';
  };

  send(ws1, { t: 'battle', a: 'join', assignmentId: battleId });
  let m = await waitMsg(ws1, x => x.t === 'battle' && x.a === 'waiting');
  check('玩家1进入排队', !!m, m);
  send(ws2, { t: 'battle', a: 'join', assignmentId: battleId });
  m = await waitMsg(ws1, x => x.t === 'battle' && x.a === 'start');
  const m2 = await waitMsg(ws2, x => x.t === 'battle' && x.a === 'start');
  check('双方匹配成功', !!m && !!m2);
  const total = m.total;
  check('对战题目数量正确', total >= 2, m);

  let ended = false;
  let curQ = m.question; // 第 0 题来自 start 消息
  for (let i = 0; i < total; i++) {
    send(ws1, { t: 'battle', a: 'answer', ans: goodAns(curQ) });              // 玩家1 抢答且答对
    setTimeout(() => send(ws2, { t: 'battle', a: 'answer', ans: goodAns(curQ) }), 500); // 玩家2 慢答且答对
    const r1 = await waitMsg(ws1, x => x.t === 'battle' && x.a === 'round' && x.idx === i);
    const r2 = await waitMsg(ws2, x => x.t === 'battle' && x.a === 'round' && x.idx === i);
    if (i === 0) {
      check('抢答快者得3分、慢者得1分', r1.myScore === 3 && r2.myScore === 1, { r1, r2 });
      check('双方都答对', r1.myCorrect === true && r2.myCorrect === true, { r1, r2 });
    }
    if (i === total - 1) {
      const e1 = await waitMsg(ws1, x => x.t === 'battle' && x.a === 'end');
      const e2 = await waitMsg(ws2, x => x.t === 'battle' && x.a === 'end');
      check('玩家1对战获胜', e1.myTotal > e1.oppTotal, { e1, e2 });
      ended = true;
    } else {
      const n1 = await waitMsg(ws1, x => x.t === 'battle' && x.a === 'next' && x.idx === i + 1);
      curQ = n1.question;
    }
  }
  check('对战完整流程结束', ended);
  ws1.close(); ws2.close();

  // 验证提交记录与积分
  const r = await api(`/api/submissions/assignment/${battleId}`, {}, tToken);
  check('对战生成2份提交记录', r.data.submissions?.length === 2, r.data.submissions?.map(s => ({ n: s.student_name, s: s.battle_score, b: s.rank_bonus })));
  const mine = await api(`/api/assignments/${battleId}`, {}, t1);
  check('对战提交有分数', typeof mine.data.assignment.mySubmission?.battle_score === 'number', mine.data.assignment.mySubmission);
  check('对战第1名有加分', r.data.submissions?.some(s => s.rank === 1 && s.rank_bonus === 20));
}
