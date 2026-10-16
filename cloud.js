/* 出师吧 · 云端账号与数据（CloudBase）
 *
 * 只做三件事：登录相关、调用云函数、把失败的请求排队重试。
 * 数据库不在浏览器里直连——所有读写都走云函数，云函数从登录凭证里认人。
 * 配置见 assets/config.js；envId 为空时 window.Cloud.enabled = false，网站按本机演示模式运行。
 */
(function () {
  'use strict';
  var CFG = window.PRENTICE_CONFIG || {};
  var enabled = !!(CFG.envId && window.cloudbase);
  var app = null, auth = null;
  var USER_FN = 'prentice-user', ADMIN_FN = 'prentice-admin';
  var QUEUE_KEY = 'prentice.cloudQueue.v1';

  function init() {
    if (!enabled || app) return;
    var c = { env: CFG.envId, region: CFG.region || 'ap-shanghai' };
    if (CFG.accessKey) c.accessKey = CFG.accessKey;
    app = window.cloudbase.init(c);
    auth = app.auth({ persistence: 'local' });
  }

  /* 把 SDK 抛出的各种错误翻成中文 */
  var MSG = [
    [/already.?exist|ALREADY_EXISTS|user.?exist/i, '这个邮箱已经注册过了，请直接登录'],
    [/not.?found|USER_NOT_FOUND|user.?not.?exist/i, '账号不存在，请先注册'],
    [/password|INVALID_CREDENTIALS|invalid_grant/i, '邮箱或密码不对'],
    [/verification|captcha.?invalid|code.?invalid|invalid.?code/i, '验证码不对或已过期，请重新获取'],
    [/rate|too.?many|exhausted|limit/i, '操作太频繁了，请稍等一会儿再试'],
    [/captcha/i, '需要先完成图形验证，请稍后重试'],
    [/provider|not.?enabled|disabled/i, '登录方式还没在控制台开启（管理员请看部署说明第 3 步）'],
    [/network|Failed to fetch|timeout|offline/i, '网络不太好，请检查网络后重试'],
    [/CORS|domain|origin|安全域名/i, '当前网址还没加入 CloudBase 安全域名（管理员请看部署说明第 6 步）']
  ];
  function errText(e) {
    if (!e) return '未知错误';
    var raw = [e.error_description, e.message, e.msg, e.error, e.code, e.error_code].filter(Boolean).join(' ');
    if (!raw) { try { raw = JSON.stringify(e); } catch (x) { raw = String(e); } }
    for (var i = 0; i < MSG.length; i++) if (MSG[i][0].test(raw)) return MSG[i][1];
    return '出错了：' + raw.slice(0, 80);
  }
  function wrap(p) {
    return Promise.resolve(p).then(function (r) {
      if (r && r.error) throw r.error;           // 新版接口返回 { data, error }
      return r;
    });
  }

  var pending = {};                                 // email -> verificationInfo
  var currentUid = '';                              // 当前登录账号；答题队列只发属于它的记录
  var Cloud = {
    enabled: enabled,
    errText: errText,

    /* 是否已经登录（本地有 CloudBase 登录态） */
    session: function () {
      if (!enabled) return Promise.resolve(null);
      init();
      return auth.getSession().then(function (r) {
        var s = r && r.data && r.data.session;
        if (!s) return null;
        var u = s.user || (r.data && r.data.user) || {};
        return { uid: u.id || u.uid || u.sub || '', email: (u.email || '').toLowerCase() };
      }).catch(function () { return null; });
    },

    /* 发送注册 / 找回密码的邮箱验证码 */
    sendCode: function (email) {
      init();
      return wrap(auth.getVerification({ email: email })).then(function (info) {
        pending[email] = info;
        return { isUser: !!(info && info.is_user) };
      });
    },

    /* 用验证码完成注册（注册后自动登录） */
    register: function (o) {
      init();
      var info = pending[o.email];
      if (!info) return Promise.reject({ message: 'verification: 请先获取验证码' });
      if (info.is_user) return Promise.reject({ message: 'already exists' });
      return wrap(auth.verify({ verification_id: info.verification_id, verification_code: o.code }))
        .then(function (v) {
          return wrap(auth.signUp({
            email: o.email, verification_code: o.code, verification_token: v.verification_token,
            password: o.password, name: o.nickname || undefined
          }));
        })
        .then(function () { delete pending[o.email]; return Cloud.session(); });
    },

    login: function (email, password) {
      init();
      return wrap(auth.signInWithPassword({ email: email, password: password })).then(function () { return Cloud.session(); });
    },

    /* 用验证码重设密码 */
    resetPassword: function (o) {
      init();
      var info = pending[o.email];
      if (!info) return Promise.reject({ message: 'verification: 请先获取验证码' });
      return wrap(auth.verify({ verification_id: info.verification_id, verification_code: o.code }))
        .then(function (v) { return wrap(auth.resetPassword({ email: o.email, new_password: o.password, verification_token: v.verification_token })); })
        .then(function () { delete pending[o.email]; });
    },

    logout: function () {
      if (!enabled) return Promise.resolve();
      init();
      currentUid = '';
      return Promise.resolve(auth.signOut()).catch(function () {});
    },

    /* 调用云函数；返回云函数的 result，ok=false 时 reject */
    call: function (fn, action, data) {
      init();
      return app.callFunction({ name: fn, data: { action: action, data: data || {} } }).then(function (res) {
        var r = res && res.result;
        if (!r) throw { message: '云函数没有返回结果' };
        if (r.ok === false) { var e = new Error(r.message || r.code); e.code = r.code; e.result = r; throw e; }
        return r;
      });
    },
    user: function (action, data) { return Cloud.call(USER_FN, action, data); },
    admin: function (action, data) { return Cloud.call(ADMIN_FN, action, data); },

    /* 答题记录：失败的先存本机，下次再补发，避免网络抖一下就丢数据 */
    setUser: function (uid) { currentUid = uid || ''; },
    track: function (data) {
      if (!enabled || !currentUid) return;
      var item = Object.assign({}, data, { cid: Date.now().toString(36) + Math.random().toString(36).slice(2, 10), _uid: currentUid });
      var q = loadQueue(); q.push(item); if (q.length > 200) q = q.slice(-200); saveQueue(q);
      flush();
    },
    flush: flush
  };

  function loadQueue() { try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]') || []; } catch (e) { return []; } }
  function saveQueue(q) { try { localStorage.setItem(QUEUE_KEY, JSON.stringify(q)); } catch (e) { /* 写不进去就算了 */ } }
  function drop(cid) { saveQueue(loadQueue().filter(function (x) { return x.cid !== cid; })); }
  var flushing = false;
  function flush() {
    if (!enabled || flushing || !currentUid) return;
    var item = loadQueue().filter(function (x) { return x._uid === currentUid; })[0];   // 别的账号留下的记录不发，等它自己登录再发
    if (!item) return;
    flushing = true;
    var data = Object.assign({}, item); delete data._uid;
    Cloud.user('attempt', data).then(function () {
      drop(item.cid); flushing = false; flush();      // 按编号删除；两个标签页同时发也不会删错（服务器按编号去重）
    }, function (e) {
      flushing = false;
      if (e && /BAD_KEY|BAD_ACTION/.test(e.code || '')) { drop(item.cid); flush(); }
    });
  }

  window.Cloud = Cloud;
})();
