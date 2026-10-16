/*
 * 云函数 prentice-user：普通用户自己的数据
 *
 * 浏览器通过 CloudBase JS SDK 的 callFunction 调用本函数。
 * 调用者是谁，只看 CloudBase 登录凭证（auth.getUserInfo().uid），不相信前端传来的任何 uid / 邮箱。
 * 所以一个用户只能读写自己的文档，看不到别人的数据。
 *
 * 用到的集合（权限都设为"仅管理端可读写"，浏览器不能直连）：
 *   users         一人一条，_id = uid：资料、注册/首次登录/最后登录时间、学习进度摘要
 *   progress      一人一条，_id = uid：完整学习进度（用于换设备恢复）
 *   attempts      每次提交答案一条：答题记录
 *   daily_active  每人每天一条，_id = 日期_uid：用来算日活 / 周活 / 月活
 *
 * 支持的 action：login / saveState / attempt / getState
 */
'use strict';

const MAX_STATE_BYTES = 300 * 1024;          // 单个用户的进度 JSON 上限
const KEY_RE = /^[A-Za-z0-9_.:\-]{1,40}$/;   // 题号 / 项目步骤号，例如 3-2、p001-2

function cstDay(ms) {                          // 统一按北京时间切日期
  return new Date(ms + 8 * 3600 * 1000).toISOString().slice(0, 10);
}
function str(v, n) { return typeof v === 'string' ? v.trim().slice(0, n) : ''; }
function fail(code, message) { return { ok: false, code, message }; }

/* 从进度 JSON 里算出后台要看的摘要（服务器自己算，不用前端算好的数字） */
function summarize(state, totalQuestions) {
  const solved = state && state.solved && typeof state.solved === 'object' ? Object.keys(state.solved) : [];
  const questionSolved = solved.filter(k => /^\d+-\d+$/.test(k)).length;
  const projects = state && state.projects && typeof state.projects === 'object' ? state.projects : {};
  const projectsDone = Object.keys(projects).filter(k => projects[k] && projects[k].score != null).length;
  const xp = state && state.xp && typeof state.xp === 'object' ? state.xp : {};
  const xpTotal = Object.keys(xp).reduce((s, k) => s + (Number(xp[k]) || 0), 0);
  const total = Number(totalQuestions) > 0 ? Number(totalQuestions) : 0;
  return {
    solvedCount: questionSolved,
    totalQuestions: total,
    completion: total ? Math.round(questionSolved / total * 1000) / 10 : 0,   // 百分比，保留 1 位
    projectsDone,
    xpTotal,
    unlockedTo: Number(state && state.unlockedTo) || 0,
    streak: Number(state && state.streak && state.streak.count) || 0,
    vipUntil: (state && state.vip && state.vip.until) || null
  };
}

function createHandler(app, opts) {
  opts = opts || {};
  const now = opts.now || (() => Date.now());
  const db = app.database();
  const _ = db.command;

  async function ensure(name, fn) {           // 集合不存在时自动建一次（第一次部署时省事）
    try { return await fn(); } catch (e) {
      const msg = String(e && (e.code || e.message) || '');
      if (/COLLECTION_NOT_EXIST|not exist/i.test(msg) && db.createCollection) {
        await db.createCollection(name).catch(() => {});
        return fn();
      }
      throw e;
    }
  }
  async function getDoc(coll, id) {
    const r = await ensure(coll, () => db.collection(coll).doc(id).get());
    return r && r.data && r.data.length ? r.data[0] : null;
  }
  function markActive(uid, t) {
    const day = cstDay(t);
    return ensure('daily_active', () => db.collection('daily_active').doc(day + '_' + uid).set({ day, uid, at: t }));
  }
  async function verifiedEmail(uid) {
    try {
      const r = await app.auth().getEndUserInfo(uid);
      const u = (r && r.userInfo) || {};
      return str(u.email || u.Email, 120).toLowerCase();
    } catch (e) { return ''; }
  }

  const actions = {
    /* 登录成功后调用：没有资料就建档（记录注册时间 + 首次登录时间），每次都更新最后登录时间 */
    async login(uid, data) {
      const t = now();
      const profile = data.profile || {};
      const users = db.collection('users');
      let user = await getDoc('users', uid);
      const serverEmail = await verifiedEmail(uid);
      const email = serverEmail || str(data.email, 120).toLowerCase();
      if (!user) {
        user = {
          uid, email, emailFromClient: !serverEmail,   // true 表示邮箱是前端报的，没从登录系统核实到
          nickname: str(profile.nickname, 24) || (email ? email.split('@')[0] : '同学'),
          school: str(profile.school, 40), major: str(profile.major, 40), grade: str(profile.grade, 10),
          createdAt: t, createdDay: cstDay(t),
          firstLoginAt: t, lastLoginAt: t, lastLoginDay: cstDay(t), loginCount: 1,
          lastActiveAt: t,
          stats: { attempts: 0, correct: 0 },
          progress: summarize(null, data.totalQuestions),
          updatedAt: t
        };
        await ensure('users', () => users.doc(uid).set(user));
      } else {
        const patch = { lastLoginAt: t, lastLoginDay: cstDay(t), loginCount: _.inc(1), lastActiveAt: t, updatedAt: t };
        if (!user.firstLoginAt) patch.firstLoginAt = t;
        if (serverEmail && serverEmail !== user.email) { patch.email = serverEmail; patch.emailFromClient = false; }   // 只用登录系统核实过的邮箱覆盖
        ['nickname', 'school', 'major', 'grade'].forEach(k => {
          const v = str(profile[k], k === 'nickname' ? 24 : 40);
          if (v && !user[k]) patch[k] = v;      // 只补空字段，不覆盖用户在"设置"里改过的
        });
        await users.doc(uid).update(patch);
        user = await getDoc('users', uid);
      }
      await markActive(uid, t);
      const prog = await getDoc('progress', uid);
      let state = null;
      if (prog && prog.state) { try { state = JSON.parse(prog.state); } catch (e) { state = null; } }
      return { ok: true, uid, profile: publicProfile(user), state, stateUpdatedAt: prog ? prog.updatedAt : null };
    },

    /* 保存完整进度（前端节流后调用） */
    async saveState(uid, data) {
      const json = typeof data.state === 'string' ? data.state : JSON.stringify(data.state || null);
      if (!json || json === 'null') return fail('BAD_STATE', '进度为空');
      if (Buffer.byteLength(json, 'utf8') > MAX_STATE_BYTES) return fail('STATE_TOO_LARGE', '进度数据过大');
      let state; try { state = JSON.parse(json); } catch (e) { return fail('BAD_STATE', '进度格式不对'); }
      const t = now();
      await ensure('progress', () => db.collection('progress').doc(uid).set({ uid, state: json, updatedAt: t }));
      const patch = { progress: summarize(state, data.totalQuestions), lastActiveAt: t, updatedAt: t };
      const u = state && state.user;
      if (u) {
        ['nickname', 'school', 'major', 'grade'].forEach(k => { const v = str(u[k], k === 'nickname' ? 24 : 40); if (v) patch[k] = v; });
      }
      const exists = await getDoc('users', uid);
      if (!exists) return fail('NO_PROFILE', '请先登录');
      await db.collection('users').doc(uid).update(patch);
      return { ok: true, savedAt: t };
    },

    /* 每次提交答案记一条 */
    async attempt(uid, data) {
      const key = str(data.key, 40);
      if (!KEY_RE.test(key)) return fail('BAD_KEY', '题号不对');
      const kind = data.kind === 'project' ? 'project' : 'question';
      const correct = data.correct ? 1 : 0;
      const t = now();
      const rec = {
        uid, key, kind, correct,
        attemptNo: Math.max(1, Math.min(999, parseInt(data.attemptNo, 10) || 1)),
        hints: Math.max(0, Math.min(99, parseInt(data.hints, 10) || 0)),
        at: t, day: cstDay(t)
      };
      const cid = typeof data.cid === 'string' && /^[A-Za-z0-9]{6,32}$/.test(data.cid) ? data.cid : '';
      if (cid) {                                   // 带客户端编号时幂等：同一条记录重发不会重复计数
        const dup = await getDoc('attempts', uid + '_' + cid);
        if (dup) return { ok: true, duplicate: true };
        await ensure('attempts', () => db.collection('attempts').doc(uid + '_' + cid).set(rec));
      } else {
        await ensure('attempts', () => db.collection('attempts').add(rec));
      }
      const exists = await getDoc('users', uid);
      if (exists) {
        await db.collection('users').doc(uid).update({
          'stats.attempts': _.inc(1), 'stats.correct': _.inc(correct), lastActiveAt: t, updatedAt: t
        });
      }
      await markActive(uid, t);
      return { ok: true };
    },

    async getState(uid) {
      const prog = await getDoc('progress', uid);
      let state = null;
      if (prog && prog.state) { try { state = JSON.parse(prog.state); } catch (e) { state = null; } }
      return { ok: true, state, updatedAt: prog ? prog.updatedAt : null };
    }
  };

  return async function handle(event, who) {
    event = event || {};
    if (!who || !who.uid) return fail('UNAUTHENTICATED', '请先登录');
    if (who.isAnonymous) return fail('ANONYMOUS', '请先注册或登录');
    const fn = actions[event.action];
    if (!fn) return fail('BAD_ACTION', '未知操作');
    try {
      return await fn(who.uid, event.data || {});
    } catch (e) {
      console.error('[prentice-user]', event.action, e && (e.stack || e.message || e));
      return fail('SERVER_ERROR', '服务器开小差了，请稍后再试');
    }
  };
}

function publicProfile(u) {
  if (!u) return null;
  return {
    email: u.email, nickname: u.nickname, school: u.school, major: u.major, grade: u.grade,
    createdAt: u.createdAt, firstLoginAt: u.firstLoginAt, lastLoginAt: u.lastLoginAt
  };
}

exports.createHandler = createHandler;
exports.summarize = summarize;
exports.cstDay = cstDay;

/* CloudBase 云函数入口 */
exports.main = async (event, context) => {
  const tcb = require('@cloudbase/node-sdk');
  const app = tcb.init({ env: tcb.SYMBOL_CURRENT_ENV });
  const who = app.auth().getUserInfo();        // { uid, isAnonymous, ... }，由平台根据登录凭证注入
  return createHandler(app)(event, who);
};
