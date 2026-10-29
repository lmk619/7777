/*
 * 云函数 prentice-auth：邮箱 + 密码登录 / 注册（不需要邮箱验证码）
 *
 * 流程：
 *   浏览器先匿名登录 CloudBase（只为了能调用本函数）
 *   → 调用本函数 login：校验邮箱和密码；账号不存在且 create=true 时自动建号
 *   → 本函数用"自定义登录私钥"签发一次性 ticket（10 分钟有效）
 *   → 浏览器用 ticket 调 signInWithCustomTicket，变成正式登录用户
 *
 * 安全：
 *   - 密码只存 scrypt 哈希 + 随机盐，任何地方都不保存明文
 *   - 同一邮箱连续输错 8 次，锁 15 分钟
 *   - 自定义登录私钥只放在本函数的环境变量 CUSTOM_LOGIN_KEY 里，前端拿不到
 *   - accounts 集合权限设为 {"read": false, "write": false}，浏览器不能直接读
 */
'use strict';
const crypto = require('crypto');

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$/;
const MAX_FAILS = 8;
const LOCK_MS = 15 * 60 * 1000;

function fail(code, message, extra) { return Object.assign({ ok: false, code, message }, extra || {}); }
function normEmail(v) { return typeof v === 'string' ? v.trim().toLowerCase() : ''; }
function okPassword(p) { return typeof p === 'string' && p.length >= 8 && p.length <= 32 && /[A-Za-z]/.test(p) && /\d/.test(p); }
function hashPassword(pw, salt) { return crypto.scryptSync(pw, salt, 64).toString('hex'); }
function emailKey(email) { return crypto.createHash('sha256').update(email).digest('hex').slice(0, 40); }   // 文档 _id，不直接暴露邮箱

function createHandler(app, opts) {
  opts = opts || {};
  const now = opts.now || (() => Date.now());
  const db = app.database();
  const issueTicket = opts.issueTicket || (customUserId => app.auth().createTicket(customUserId, { refresh: 3600 * 1000 }));

  async function getAccount(id) {
    try {
      const r = await db.collection('accounts').doc(id).get();
      return r && r.data && r.data.length ? r.data[0] : null;
    } catch (e) {
      if (/COLLECTION_NOT_EXIST|not exist/i.test(String(e && (e.code || e.message)))) {
        if (db.createCollection) await db.createCollection('accounts').catch(() => {});
        return null;
      }
      throw e;
    }
  }

  const actions = {
    /* data: { email, password, create, nickname } */
    async login(data) {
      const email = normEmail(data.email);
      const password = data.password;
      if (!EMAIL_RE.test(email)) return fail('BAD_EMAIL', '邮箱格式不对');
      if (typeof password !== 'string' || !password) return fail('BAD_PASSWORD', '请输入密码');
      const id = emailKey(email);
      const t = now();
      const acc = await getAccount(id);

      if (!acc) {
        if (!data.create) return fail('NO_ACCOUNT', '这个邮箱还没有注册');
        if (!okPassword(password)) return fail('WEAK_PASSWORD', '密码需要 8–32 位，同时包含字母和数字');
        const salt = crypto.randomBytes(16).toString('hex');
        const customUserId = 'p' + crypto.randomBytes(12).toString('hex');   // 25 位，符合 CloudBase 自定义登录 uid 规则
        await db.collection('accounts').doc(id).set({
          email, customUserId, salt, hash: hashPassword(password, salt),
          nickname: typeof data.nickname === 'string' ? data.nickname.trim().slice(0, 16) : '',
          createdAt: t, lastLoginAt: t, failCount: 0, lockUntil: 0
        });
        const ticket = await issueTicket(customUserId);
        return { ok: true, created: true, ticket };
      }

      if (acc.lockUntil && acc.lockUntil > t) {
        return fail('LOCKED', '密码错误次数太多，请 ' + Math.ceil((acc.lockUntil - t) / 60000) + ' 分钟后再试');
      }
      const given = Buffer.from(hashPassword(password, acc.salt), 'hex');
      const stored = Buffer.from(acc.hash, 'hex');
      const match = given.length === stored.length && crypto.timingSafeEqual(given, stored);
      if (!match) {
        const fails = (acc.failCount || 0) + 1;
        await db.collection('accounts').doc(id).update(fails >= MAX_FAILS ? { failCount: 0, lockUntil: t + LOCK_MS } : { failCount: fails });
        return fail('WRONG_PASSWORD', '密码不对', { remaining: Math.max(0, MAX_FAILS - fails) });
      }
      await db.collection('accounts').doc(id).update({ failCount: 0, lockUntil: 0, lastLoginAt: t });
      const ticket = await issueTicket(acc.customUserId);
      return { ok: true, created: false, ticket };
    }
  };

  return async function handle(event, who) {
    event = event || {};
    if (!who || !who.uid) return fail('UNAUTHENTICATED', '请先刷新页面');   // 匿名会话也有 uid
    const fn = actions[event.action];
    if (!fn) return fail('BAD_ACTION', '未知操作');
    try {
      return await fn(event.data || {});
    } catch (e) {
      console.error('[prentice-auth]', event.action, e && (e.stack || e.message || e));
      const msg = String(e && e.message || e);
      if (/私钥|credentials|private_key|env_id/i.test(msg)) return fail('KEY_NOT_CONFIGURED', '登录服务还没配置好（管理员请检查 CUSTOM_LOGIN_KEY）');
      return fail('SERVER_ERROR', '服务器开小差了，请稍后再试');
    }
  };
}

/* 管理员重置密码时复用 */
exports.hashPassword = hashPassword;
exports.emailKey = emailKey;
exports.okPassword = okPassword;
exports.createHandler = createHandler;

exports.main = async (event, context) => {
  const tcb = require('@cloudbase/node-sdk');
  let credentials;
  try { credentials = JSON.parse(process.env.CUSTOM_LOGIN_KEY || ''); } catch (e) { credentials = undefined; }
  const app = tcb.init(Object.assign({ env: tcb.SYMBOL_CURRENT_ENV }, credentials ? { credentials } : {}));
  return createHandler(app)(event, app.auth().getUserInfo());
};

