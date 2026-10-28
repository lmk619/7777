/* 出师吧 · CloudBase 云端账号与数据
 * 支持：邮箱登录/注册、自定义票据登录、用户云函数、管理员云函数、答题记录队列
 * CloudBase JS SDK：2.28.8
 */
(function () {
  'use strict';

  var CFG = window.PRENTICE_CONFIG || {};
  var enabled = !!(CFG.envId && window.cloudbase);

  var app = null;
  var auth = null;
  var initError = null;

  var AUTH_FN = 'prentice-auth';
  var USER_FN = 'prentice-user';
  var ADMIN_FN = 'prentice-admin';

  var QUEUE_KEY = 'prentice.cloudQueue.v1';
  var LAST_KEY = 'prentice.lastEmail.v1';

  var currentUid = '';
  var flushing = false;

  function remember(email) {
    try {
      localStorage.setItem(LAST_KEY, String(email || '').trim().toLowerCase());
    } catch (e) {}
  }

  function init() {
    if (!enabled) {
      throw new Error('CloudBase 尚未配置，请检查 assets/config.js 和 SDK。');
    }

    if (app && auth) return;

    try {
      var config = {
        env: CFG.envId,
        region: CFG.region || 'ap-shanghai'
      };

      if (CFG.accessKey) {
        config.accessKey = CFG.accessKey;
      }

      app = window.cloudbase.init(config);
      auth = app.auth({ persistence: 'local' });
      initError = null;
    } catch (e) {
      app = null;
      auth = null;
      initError = e;
      throw e;
    }
  }

  var MSG = [
    [/BAD_EMAIL/i, '邮箱格式不正确，请检查后重试'],
    [/WEAK_PASSWORD/i, '密码需要 8–32 位，并同时包含字母和数字'],
    [/WRONG_PASSWORD|INVALID_CREDENTIALS|INVALID_PASSWORD|invalid_grant/i, '邮箱或密码不正确'],
    [/NO_ACCOUNT|USER_NOT_FOUND/i, '这个邮箱还没有注册，请先注册'],
    [/ALREADY_EXISTS|already.?exist/i, '这个邮箱可能已经注册，请直接登录'],
    [/LOCKED/i, '尝试次数过多，请稍后再试'],
    [/KEY_NOT_CONFIGURED/i, '登录服务配置不完整，请检查云函数环境变量 CUSTOM_LOGIN_KEY'],
    [/UNAUTHENTICATED/i, '登录状态已失效，请刷新页面后重试'],
    [/anonymous|匿名登录/i, '匿名登录未成功，请检查 CloudBase 登录设置'],
    [/provider|not.?enabled|disabled|LOGIN_METHOD_DISABLED/i, 'CloudBase 登录方式尚未启用，请检查控制台设置'],
    [/CORS|domain|origin|安全域名/i, '当前网站域名可能尚未加入 CloudBase 安全域名'],
    [/network|Failed to fetch|timeout|offline/i, '网络连接失败，请检查网络后重试'],
    [/PERMISSION_DENIED|permission denied/i, '当前操作没有权限，请检查云函数权限配置'],
    [/COLLECTION_NOT_EXIST|collection.*not exist/i, '数据库集合尚未创建或配置不正确'],
    [/BAD_ACTION/i, '云函数不支持此操作，请检查云函数版本'],
    [/SERVER_ERROR/i, '服务器处理失败，请查看云函数运行日志']
  ];

  function errText(e) {
    if (!e) return '发生未知错误';

    if (e.result && e.result.message) {
      return e.result.message;
    }

    var raw = [
      e.error_description,
      e.message,
      e.msg,
      e.error,
      e.code,
      e.error_code
    ].filter(Boolean).join(' ');

    if (!raw) {
      try {
        raw = JSON.stringify(e);
      } catch (x) {
        raw = String(e);
      }
    }

    for (var i = 0; i < MSG.length; i++) {
      if (MSG[i][0].test(raw)) return MSG[i][1];
    }

    return '操作失败：' + raw.slice(0, 180);
  }

  function wrap(value) {
    return Promise.resolve(value).then(function (result) {
      if (result && result.error) {
        throw result.error;
      }
      return result;
    });
  }

  function ensureAnon() {
    init();

    return wrap(auth.getSession()).then(function (result) {
      var data = result && result.data;
      var session = data && data.session;

      if (session) return result;

      return wrap(auth.signInAnonymously({}));
    });
  }

  function loadQueue() {
    try {
      return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]') || [];
    } catch (e) {
      return [];
    }
  }

  function saveQueue(queue) {
    try {
      localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
    } catch (e) {}
  }

  function dropQueueItem(cid) {
    saveQueue(loadQueue().filter(function (item) {
      return item.cid !== cid;
    }));
  }

  function flush() {
    if (!enabled || flushing || !currentUid) return;

    var queue = loadQueue();
    var item = queue.filter(function (entry) {
      return entry._uid === currentUid;
    })[0];

    if (!item) return;

    flushing = true;

    var data = Object.assign({}, item);
    delete data._uid;
    delete data._kind;

    Cloud.user(item._kind === 'event' ? 'event' : 'attempt', data)
      .then(function () {
        dropQueueItem(item.cid);
        flushing = false;
        flush();
      })
      .catch(function (e) {
        flushing = false;

        // 明确不支持的记录类型无需无限重试
        if (e && /BAD_KEY|BAD_ACTION|BAD_EVENT/.test(e.code || '')) {
          dropQueueItem(item.cid);
          flush();
        }
      });
  }

  var Cloud = {
    enabled: enabled,

    errText: errText,

    /* 获取当前登录用户；匿名用户不视为正式登录 */
    session: function () {
      if (!enabled) return Promise.resolve(null);

      try {
        init();
      } catch (e) {
        return Promise.reject(e);
      }

      return wrap(auth.getSession()).then(function (result) {
        var data = result && result.data;
        var session = data && data.session;

        if (!session) return null;

        var user = session.user || (data && data.user) || {};

        if (
          user.is_anonymous === true ||
          user.isAnonymous === true
        ) {
          return null;
        }

        var uid = user.id || user.uid || user.sub || '';

        if (!uid) return null;

        currentUid = uid;

        return {
          uid: uid,
          email: String(user.email || Cloud.lastEmail() || '').toLowerCase()
        };
      }).catch(function () {
        return null;
      });
    },

    /* 邮箱密码登录；opts.create=true 时允许注册 */
    passwordLogin: function (email, password, opts) {
      opts = opts || {};

      if (!enabled) {
        return Promise.reject(new Error('CloudBase 尚未配置，请检查 config.js。'));
      }

      if (!email || !password) {
        return Promise.reject(new Error('请输入邮箱和密码。'));
      }

      try {
        init();
      } catch (e) {
        return Promise.reject(e);
      }

      return ensureAnon()
        .then(function () {
          return app.callFunction({
            name: AUTH_FN,
            data: {
              action: 'login',
              data: {
                email: String(email).trim().toLowerCase(),
                password: String(password),
                create: !!opts.create,
                nickname: opts.nickname || ''
              }
            }
          });
        })
        .then(function (response) {
          var result = response && response.result;

          if (!result) {
            throw new Error('登录云函数没有返回结果，请检查 prentice-auth 日志。');
          }

          if (result.ok === true) {
            if (typeof result.ticket !== 'string' || !result.ticket) {
              throw new Error('登录云函数没有返回有效 ticket，请检查 prentice-auth 的票据签发逻辑。');
            }

            return wrap(
              auth.signInWithCustomTicket(function () {
                return Promise.resolve(result.ticket);
              })
            ).then(function () {
              remember(email);

              return Cloud.session().then(function (session) {
                if (!session) {
                  throw new Error('票据登录后没有获取到正式用户会话，请检查自定义登录配置。');
                }

                return {
                  status: 'ok',
                  created: !!result.created,
                  session: session
                };
              });
            });
          }

          if (result.code === 'NO_ACCOUNT') {
            // 兼容早期版本通过 CloudBase 邮箱密码方式创建的账号
            return wrap(
              auth.signInWithPassword({
                email: String(email).trim().toLowerCase(),
                password: String(password)
              })
            ).then(function () {
              remember(email);

              return Cloud.session().then(function (session) {
                if (!session) {
                  throw new Error('旧账号登录后未获取到有效会话。');
                }

                return {
                  status: 'ok',
                  created: false,
                  legacy: true,
                  session: session
                };
              });
            }).catch(function () {
              return ensureAnon().then(function () {
                return { status: 'no_account' };
              });
            });
          }

          var error = new Error(result.message || result.code || '登录失败');
          error.code = result.code || 'LOGIN_FAILED';
          error.result = result;
          throw error;
        });
    },

    /* 兼容网站原有调用：只登录，不自动注册 */
    login: function (email, password) {
      return Cloud.passwordLogin(email, password).then(function (result) {
        if (!result || result.status !== 'ok') {
          var error = new Error('这个邮箱还没有注册，请先注册。');
          error.code = 'NO_ACCOUNT';
          error.result = { message: '这个邮箱还没有注册，请先注册。' };
          throw error;
        }

        return result.session || Cloud.session();
      });
    },

    lastEmail: function () {
      try {
        return localStorage.getItem(LAST_KEY) || '';
      } catch (e) {
        return '';
      }
    },

    logout: function () {
      currentUid = '';

      if (!enabled) return Promise.resolve();

      try {
        init();
      } catch (e) {
        return Promise.reject(e);
      }

      return wrap(auth.signOut());
    },

    /* 统一调用云函数 */
    call: function (fn, action, data) {
      if (!enabled) {
        return Promise.reject(new Error('云端服务尚未启用，请检查 config.js。'));
      }

      try {
        init();
      } catch (e) {
        return Promise.reject(e);
      }

      if (!app) {
        return Promise.reject(initError || new Error('CloudBase 初始化失败。'));
      }

      return Promise.resolve()
        .then(function () {
          return app.callFunction({
            name: fn,
            data: {
              action: action,
              data: data || {}
            }
          });
        })
        .then(function (response) {
          var result = response && response.result;

          if (result === undefined || result === null) {
            throw new Error('云函数没有返回结果：' + fn);
          }

          if (result.ok === false) {
            var error = new Error(result.message || result.code || '云函数执行失败');
            error.code = result.code || 'FUNCTION_FAILED';
            error.result = result;
            throw error;
          }

          return result;
        });
    },

    user: function (action, data) {
      return Cloud.call(USER_FN, action, data);
    },

    admin: function (action, data) {
      return Cloud.call(ADMIN_FN, action, data);
    },

    /* 设置当前账号 ID，供答题记录队列使用 */
    setUser: function (uid) {
      currentUid = uid || '';

      if (currentUid) {
        flush();
      }
    },

    /* 保存答题记录，失败后等待后续重试 */
    track: function (data, kind) {
      if (!enabled || !currentUid) return;

      var item = Object.assign({}, data || {}, {
        cid: Date.now().toString(36) +
          Math.random().toString(36).slice(2, 10),
        _uid: currentUid,
        _kind: kind || 'attempt'
      });

      var queue = loadQueue();
      queue.push(item);

      if (queue.length > 200) {
        queue = queue.slice(-200);
      }

      saveQueue(queue);
      flush();
    },

    event: function (type, props) {
      Cloud.track({
        type: type,
        props: props || {}
      }, 'event');
    },

    flush: flush
  };

  window.Cloud = Cloud;
})();
