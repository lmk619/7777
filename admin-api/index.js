/*
 * 云函数 prentice-admin：管理后台用的统计、列表和导出
 *
 * 身份验证：
 *   1. 调用者必须用 CloudBase 账号登录（非匿名），uid 取自登录凭证，前端改不了；
 *   2. uid 必须在本函数的环境变量 ADMIN_UIDS 里（多个用英文逗号分隔），否则一律返回 FORBIDDEN。
 *   只有 whoami 不要求管理员，用来让你第一次部署时查到自己的 uid。
 *
 * 支持的 action：whoami / overview / users / export / orders
 */
'use strict';

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RANGE_DAYS = 366;
const MAX_EXPORT = 5000;                      // 单次云函数返回不宜太大（平台同步返回有大小上限）

function cstDay(ms) { return new Date(ms + 8 * 3600 * 1000).toISOString().slice(0, 10); }
function dayStart(day) { return Date.parse(day + 'T00:00:00+08:00'); }   // 北京时间 0 点
function addDays(day, n) { return cstDay(dayStart(day) + n * 86400000); }
function daysBetween(a, b) { return Math.round((dayStart(b) - dayStart(a)) / 86400000); }
function fail(code, message, extra) { return Object.assign({ ok: false, code, message }, extra || {}); }

function parseAdmins(raw) {
  return String(raw || '').split(/[,\s，]+/).map(s => s.trim()).filter(Boolean);
}

function normRange(data, now, defaultDays) {
  const today = cstDay(now);
  let to = DAY_RE.test(data.to || '') ? data.to : today;
  let from = DAY_RE.test(data.from || '') ? data.from : addDays(to, -(defaultDays - 1));
  if (from > to) { const x = from; from = to; to = x; }
  if (daysBetween(from, to) > MAX_RANGE_DAYS - 1) from = addDays(to, -(MAX_RANGE_DAYS - 1));
  return { from, to, fromMs: dayStart(from), toMs: dayStart(to) + 86400000 - 1 };
}

const USER_FIELDS = ['uid', 'email', 'nickname', 'school', 'major', 'grade', 'createdAt', 'firstLoginAt', 'lastLoginAt', 'loginCount', 'lastActiveAt', 'stats', 'progress'];
function rowOf(u) {
  const s = u.stats || {}, p = u.progress || {};
  return {
    uid: u.uid || u._id, email: u.email || '', nickname: u.nickname || '', school: u.school || '', major: u.major || '', grade: u.grade || '',
    createdAt: u.createdAt || null, firstLoginAt: u.firstLoginAt || null, lastLoginAt: u.lastLoginAt || null, lastActiveAt: u.lastActiveAt || null,
    loginCount: u.loginCount || 0,
    solvedCount: p.solvedCount || 0, totalQuestions: p.totalQuestions || 0, completion: p.completion || 0,
    projectsDone: p.projectsDone || 0, xpTotal: p.xpTotal || 0, streak: p.streak || 0, vipUntil: p.vipUntil || null,
    attempts: s.attempts || 0, correct: s.correct || 0,
    accuracy: s.attempts ? Math.round((s.correct || 0) / s.attempts * 1000) / 10 : null
  };
}

function createHandler(app, opts) {
  opts = opts || {};
  const now = opts.now || (() => Date.now());
  const adminUids = () => parseAdmins(opts.adminUids != null ? opts.adminUids : process.env.ADMIN_UIDS);
  const db = app.database();
  const _ = db.command;
  const $ = _.aggregate;

  async function safe(fn, fallback) {
    try { return await fn(); } catch (e) {
      const msg = String(e && (e.code || e.message) || '');
      if (/COLLECTION_NOT_EXIST|not exist/i.test(msg)) return fallback;   // 还没有任何数据时集合可能不存在
      throw e;
    }
  }
  async function count(coll, where) {
    return safe(async () => {
      const q = where ? db.collection(coll).where(where) : db.collection(coll);
      const r = await q.count();
      return (r && r.total) || 0;
    }, 0);
  }
  async function groupByDay(coll, dayField, range, extra) {
    const groupSpec = Object.assign({ _id: '$' + dayField, n: $.sum(1) }, extra || {});
    const r = await safe(() => db.collection(coll).aggregate()
      .match({ [dayField]: _.gte(range.from).and(_.lte(range.to)) })
      .group(groupSpec)
      .limit(MAX_RANGE_DAYS + 1)                 // 聚合默认只返回 20 组，按天统计必须显式放大
      .end(), { data: [] });
    const map = {};
    ((r && (r.data || r.list)) || []).forEach(x => { map[x._id] = x; });
    return map;
  }
  async function distinctUsers(fromDay, toDay) {
    const r = await safe(() => db.collection('daily_active').aggregate()
      .match({ day: _.gte(fromDay).and(_.lte(toDay)) })
      .group({ _id: '$uid' })
      .count('n')
      .end(), { data: [] });
    const list = (r && (r.data || r.list)) || [];
    return list.length ? list[0].n : 0;
  }
  function usersWhere(data, range) {
    const field = ({ createdAt: 'createdAt', firstLoginAt: 'firstLoginAt', lastLoginAt: 'lastLoginAt', lastActiveAt: 'lastActiveAt' })[data.dateField] || 'createdAt';
    const w = {};
    if (data.allTime !== true) w[field] = _.gte(range.fromMs).and(_.lte(range.toMs));
    const kw = typeof data.keyword === 'string' ? data.keyword.trim().toLowerCase().slice(0, 60) : '';
    if (kw) w.email = db.RegExp ? db.RegExp({ regexp: kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), options: 'i' }) : kw;
    return { where: w, field };
  }

  const actions = {
    async overview(data) {
      const t = now(), today = cstDay(t);
      const range = normRange(data, t, 30);
      const [totalUsers, newUsers, newSeries, actSeries, attSeries, dau, wau, mau] = await Promise.all([
        count('users'),
        count('users', { createdAt: _.gte(range.fromMs).and(_.lte(range.toMs)) }),
        groupByDay('users', 'createdDay', range),
        groupByDay('daily_active', 'day', range),
        groupByDay('attempts', 'day', range, { correct: $.sum('$correct') }),
        count('daily_active', { day: today }),
        distinctUsers(addDays(today, -6), today),
        distinctUsers(addDays(today, -29), today)
      ]);
      const days = [];
      for (let d = range.from; d <= range.to; d = addDays(d, 1)) {
        const a = attSeries[d] || {};
        days.push({ day: d, newUsers: (newSeries[d] || {}).n || 0, activeUsers: (actSeries[d] || {}).n || 0, attempts: a.n || 0, correct: a.correct || 0 });
      }
      const attempts = days.reduce((s, x) => s + x.attempts, 0), correct = days.reduce((s, x) => s + x.correct, 0);
      return {
        ok: true, range: { from: range.from, to: range.to }, today,
        totals: { totalUsers, newUsers, dau, wau, mau, attempts, accuracy: attempts ? Math.round(correct / attempts * 1000) / 10 : null },
        days
      };
    },

    async users(data) {
      const t = now(), range = normRange(data, t, 30);
      const pageSize = Math.max(1, Math.min(100, parseInt(data.pageSize, 10) || 20));
      const page = Math.max(1, parseInt(data.page, 10) || 1);
      const { where, field } = usersWhere(data, range);
      const total = await count('users', Object.keys(where).length ? where : null);
      const r = await safe(() => {
        let q = db.collection('users');
        if (Object.keys(where).length) q = q.where(where);
        return q.orderBy(field, 'desc').skip((page - 1) * pageSize).limit(pageSize).field(fieldsProjection()).get();
      }, { data: [] });
      return { ok: true, range: { from: range.from, to: range.to }, dateField: field, page, pageSize, total, rows: (r.data || []).map(rowOf) };
    },

    async export(data) {
      const t = now(), range = normRange(data, t, 30);
      const { where, field } = usersWhere(data, range);
      const rows = [];
      for (let skip = 0; skip < MAX_EXPORT; skip += 1000) {
        const r = await safe(() => {
          let q = db.collection('users');
          if (Object.keys(where).length) q = q.where(where);
          return q.orderBy(field, 'desc').skip(skip).limit(1000).field(fieldsProjection()).get();
        }, { data: [] });
        const list = r.data || [];
        list.forEach(u => rows.push(rowOf(u)));
        if (list.length < 1000) break;
      }
      return { ok: true, range: { from: range.from, to: range.to }, dateField: field, truncated: rows.length >= MAX_EXPORT, rows };
    },

    /* 预留：接入真实支付后，在 orders 集合里记录订单，这里再做实收 / 退款 / 月度销售统计 */
    async orders() {
      return { ok: true, enabled: false, message: '尚未接入支付。接入后这里会显示订单数、实收金额、退款金额和月度销售。' };
    }
  };

  function fieldsProjection() { const p = {}; USER_FIELDS.forEach(f => { p[f] = true; }); return p; }

  return async function handle(event, who) {
    event = event || {};
    if (!who || !who.uid) return fail('UNAUTHENTICATED', '请先登录');
    if (who.isAnonymous) return fail('ANONYMOUS', '请先登录');
    const isAdmin = adminUids().indexOf(who.uid) >= 0;
    if (event.action === 'whoami') return { ok: true, uid: who.uid, isAdmin };
    if (!isAdmin) return fail('FORBIDDEN', '这个账号不是管理员', { uid: who.uid });
    const fn = actions[event.action];
    if (!fn) return fail('BAD_ACTION', '未知操作');
    try {
      return await fn(event.data || {});
    } catch (e) {
      console.error('[prentice-admin]', event.action, e && (e.stack || e.message || e));
      return fail('SERVER_ERROR', '查询失败：' + String(e && e.message || e).slice(0, 120));
    }
  };
}

exports.createHandler = createHandler;
exports.parseAdmins = parseAdmins;
exports.normRange = normRange;

exports.main = async (event, context) => {
  const tcb = require('@cloudbase/node-sdk');
  const app = tcb.init({ env: tcb.SYMBOL_CURRENT_ENV });
  return createHandler(app)(event, app.auth().getUserInfo());
};
