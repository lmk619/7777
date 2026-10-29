/* 出师吧 · 管理后台（/admin）
 * 所有数据都来自云函数 prentice-admin；云函数会检查登录凭证里的 uid 是否在管理员名单 ADMIN_UIDS 里。
 * 这个页面本身不含任何密钥，别人就算打开 /admin，也只能看到登录框。
 */
(function () {
  'use strict';
  var Cloud = window.Cloud;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var root = $('#root');
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function pad(n) { return String(n).padStart(2, '0'); }
  function cst(ms) { return ms ? new Date(ms + 8 * 3600 * 1000).toISOString().slice(0, 16).replace('T', ' ') : ''; }   // 北京时间
  function dayOf(ms) { return new Date(ms + 8 * 3600 * 1000).toISOString().slice(0, 10); }
  function addDays(d, n) { return dayOf(Date.parse(d + 'T00:00:00+08:00') + n * 86400000); }
  function toast(m) { var t = $('#toast'); t.textContent = m; t.classList.add('on'); clearTimeout(toast._t); toast._t = setTimeout(function () { t.classList.remove('on'); }, 2800); }
  function fmtNum(n) { return n == null ? '—' : Number(n).toLocaleString('zh-CN'); }

  var state = { from: addDays(dayOf(Date.now()), -29), to: dayOf(Date.now()), dateField: 'createdAt', keyword: '', page: 1, pageSize: 20 };

  /* ---------------- 启动 ---------------- */
  function boot() {
    if (!Cloud || !Cloud.enabled) {
      root.innerHTML = '<div class="card"><h2>还没有连接云端</h2><p class="muted">请先在 <code>assets/config.js</code> 里填好 CloudBase 环境 ID，再重新部署网站。详见 docs/云端数据与管理后台-部署说明.md。</p></div>';
      return;
    }
    Cloud.session().then(function (s) { if (s) afterLogin(s); else loginView(); });
  }

  function loginView(msg) {
    $('#who').textContent = ''; $('#logout').classList.add('hidden');
    root.innerHTML = '<form class="card auth-form" id="f" style="max-width:420px;margin:40px auto" novalidate><h3 style="text-align:center;margin-bottom:18px">管理员登录</h3>' +
      (msg ? '<div class="banner">' + esc(msg) + '</div>' : '') +
      '<div class="field"><label for="em">邮箱</label><input class="input" id="em" type="email" autocomplete="username"></div>' +
      '<div class="field"><label for="pw">密码</label><input class="input" id="pw" type="password" autocomplete="current-password"></div>' +
      '<button class="btn primary lg" style="width:100%" id="go">登录</button>' +
      '<p class="faint xs" style="margin:14px 0 0;text-align:center">用你在网站上注册的账号登录；只有加入管理员名单的账号能看到数据。</p></form>';
    $('#f').addEventListener('submit', function (e) {
      e.preventDefault();
      var b = $('#go'); b.disabled = true; b.textContent = '登录中…';
      Cloud.login($('#em').value.trim().toLowerCase(), $('#pw').value).then(function (s) { afterLogin(s); }, function (er) { toast(Cloud.errText(er)); b.disabled = false; b.textContent = '登录'; });
    });
  }

  function afterLogin(sess) {
    $('#who').textContent = sess.email || ''; $('#logout').classList.remove('hidden');
    $('#logout').onclick = function () { Cloud.logout().then(function () { loginView(); }); };
    Cloud.admin('whoami').then(function (r) {
      if (!r.isAdmin) {
        root.innerHTML = '<div class="card" style="max-width:640px;margin:40px auto"><h2>这个账号还不是管理员</h2>' +
          '<p class="muted">你的 uid 是：</p><div class="uidbox">' + esc(r.uid) + '</div>' +
          '<p class="muted small" style="margin-top:14px">第一次部署时：把上面这串 uid 填进云函数 <b>prentice-admin</b> 的环境变量 <code>ADMIN_UIDS</code>（多个用英文逗号隔开），保存后刷新本页。</p></div>';
        return;
      }
      dashboard();
    }, function (e) {
      root.innerHTML = '<div class="card"><h2>连不上管理云函数</h2><p class="muted">' + esc(Cloud.errText(e)) + '</p><p class="small muted">检查：prentice-admin 是否已部署；当前网址是否已加入安全域名。</p></div>';
    });
  }

  /* ---------------- 主界面 ---------------- */
  function dashboard() {
    root.innerHTML =
      '<div class="card" style="margin-bottom:18px"><div class="bar">' +
      '<div class="field"><label>开始日期</label><input class="input" type="date" id="from" value="' + state.from + '"></div>' +
      '<div class="field"><label>结束日期</label><input class="input" type="date" id="to" value="' + state.to + '"></div>' +
      '<button class="btn sm" data-q="7">近 7 天</button><button class="btn sm" data-q="30">近 30 天</button><button class="btn sm" data-q="90">近 90 天</button>' +
      '<button class="btn primary sm" id="apply">查询</button><span class="spacer"></span><span class="faint xs">时间均为北京时间</span></div></div>' +
      '<div class="kpis" id="kpis"></div>' +
      '<div class="card" style="margin-top:18px"><div class="row"><h3>每日新增与活跃</h3><span class="spacer"></span><div class="legend"><span><i style="background:#0071e3"></i>新增用户</span><span><i style="background:#30d158"></i>活跃用户</span></div><button class="btn sm" id="exDaily">导出每日数据 CSV</button></div><div id="chart" style="margin-top:12px"></div>' +
      '<details style="margin-top:10px"><summary class="small muted">查看每日明细</summary><div class="scroll" style="margin-top:10px;max-height:320px" id="dailyTbl"></div></details></div>' +
      '<div class="card" style="margin-top:18px"><div class="row" style="margin-bottom:12px"><h3>用户列表</h3><span class="spacer"></span><span class="faint small" id="ucount"></span></div>' +
      '<div class="bar" style="margin-bottom:12px"><div class="field"><label>按哪个时间筛选</label><select class="input" id="df"><option value="createdAt">注册时间</option><option value="firstLoginAt">首次登录时间</option><option value="lastLoginAt">最后登录时间</option><option value="lastActiveAt">最后活跃时间</option></select></div>' +
      '<div class="field"><label>邮箱包含</label><input class="input" id="kw" placeholder="可选" value="' + esc(state.keyword) + '"></div>' +
      '<div class="field"><label>每页</label><select class="input" id="ps"><option>20</option><option>50</option><option>100</option></select></div>' +
      '<button class="btn sm" id="search">筛选</button><span class="spacer"></span><button class="btn sm" id="exCsv">导出 CSV</button><button class="btn sm primary" id="exXlsx">导出 Excel</button></div>' +
      '<div class="scroll" id="utbl"></div><div class="row" style="margin-top:12px"><button class="btn sm" id="prev">‹ 上一页</button><span class="small muted" id="pinfo"></span><button class="btn sm" id="next">下一页 ›</button></div></div>' +
      '<div class="card" style="margin-top:18px"><div class="row"><h3>VIP 与付费意向</h3><span class="spacer"></span><span class="faint small" id="vipActive"></span></div><div id="funnel" style="margin-top:12px"></div><div class="faint small" id="vipSrc" style="margin-top:10px"></div></div>' +
      '<div class="grid g2" style="margin-top:18px;gap:18px"><div class="card"><h3>功能使用</h3><p class="faint xs" style="margin:4px 0 10px">区间内各功能被使用的次数，用来判断哪些值得放进 VIP</p><div class="scroll" style="max-height:320px" id="feat"></div></div>' +
      '<div class="card"><div class="row"><h3>邀请拉新</h3><span class="spacer"></span><span class="faint small" id="invCount"></span></div><p class="faint xs" style="margin:4px 0 10px">按邀请人统计区间内带来的注册数</p><div class="scroll" style="max-height:320px" id="inv"></div></div></div>' +
      '<div class="card" style="margin-top:18px"><h3>重置用户密码</h3><p class="faint xs" style="margin:4px 0 10px">用户忘记密码时，在这里帮他设一个新密码，再告诉他本人。只适用于"邮箱+密码"注册的账号。</p>' +
      '<form class="bar" id="rp" autocomplete="off"><div class="field"><label>用户邮箱</label><input class="input" id="rpEm" type="email"></div><div class="field"><label>新密码</label><input class="input" id="rpPw" type="text" placeholder="8–32 位，含字母和数字"></div><button class="btn sm primary">重置</button></form></div>' +
      '<div class="card" style="margin-top:18px"><div class="row"><h3>订单与收入</h3><span class="chip">未接入支付</span></div><p class="muted small" id="orders" style="margin:10px 0 0">加载中…</p></div>';

    $('#df').value = state.dateField; $('#ps').value = String(state.pageSize);
    if (!root._bound) root.addEventListener('click', function (e) {
      var q = e.target.closest('[data-q]'); if (!q) return;
      state.to = dayOf(Date.now()); state.from = addDays(state.to, -(+q.dataset.q - 1));
      $('#from').value = state.from; $('#to').value = state.to; state.page = 1; refresh();
    });
    root._bound = true;
    $('#apply').onclick = function () { readRange(); state.page = 1; refresh(); };
    $('#search').onclick = function () { readRange(); state.dateField = $('#df').value; state.keyword = $('#kw').value.trim(); state.pageSize = +$('#ps').value; state.page = 1; loadUsers(); };
    $('#prev').onclick = function () { if (state.page > 1) { state.page--; loadUsers(); } };
    $('#next').onclick = function () { state.page++; loadUsers(); };
    $('#exCsv').onclick = function () { exportUsers('csv'); };
    $('#exXlsx').onclick = function () { exportUsers('xlsx'); };
    $('#exDaily').onclick = function () { if (lastDaily) download(csv(DAILY_COLS, lastDaily), '出师吧-每日数据-' + state.from + '_' + state.to + '.csv', 'text/csv;charset=utf-8'); };
    $('#rp').addEventListener('submit', function (e) {
      e.preventDefault();
      var em = $('#rpEm').value.trim().toLowerCase(), pw = $('#rpPw').value;
      if (!em || !pw) { toast('请填写邮箱和新密码'); return; }
      if (!window.confirm('确认把 ' + em + ' 的密码重置为你输入的新密码？')) return;
      Cloud.admin('resetPassword', { email: em, newPassword: pw }).then(function () { toast('已重置，请把新密码告诉用户本人'); $('#rpPw').value = ''; }, function (er) { toast(Cloud.errText(er)); });
    });
    Cloud.admin('orders').then(function (r) { $('#orders').textContent = r.message; }, function () { $('#orders').textContent = '—'; });
    refresh();
  }
  function readRange() {
    var f = $('#from').value, t = $('#to').value;
    if (/^\d{4}-\d{2}-\d{2}$/.test(f)) state.from = f; if (/^\d{4}-\d{2}-\d{2}$/.test(t)) state.to = t;
  }
  function refresh() { loadOverview(); loadUsers(); loadGrowth(); }
  function loadGrowth() {
    $('#funnel').innerHTML = '<p class="muted small">加载中…</p>';
    Cloud.admin('growth', { from: state.from, to: state.to }).then(function (r) {
      $('#vipActive').textContent = '当前有效 VIP：' + fmtNum(r.vipActive) + ' 人';
      var max = Math.max(1, r.funnel[0].users);
      $('#funnel').innerHTML = r.funnel.map(function (f) {
        var w = Math.max(2, Math.round(f.users / max * 100));
        return '<div style="display:grid;grid-template-columns:120px 1fr 120px;align-items:center;gap:10px;margin:6px 0"><span class="small">' + esc(f.step) + '</span>' +
          '<div style="background:var(--bg2);border-radius:6px;height:14px"><div style="width:' + w + '%;height:14px;border-radius:6px;background:#0071e3"></div></div>' +
          '<span class="small" style="text-align:right">' + fmtNum(f.users) + ' 人' + (f.rate != null ? '<span class="faint"> · ' + f.rate + '%</span>' : '') + '</span></div>';
      }).join('') + '<p class="faint xs" style="margin:8px 0 0">百分比是相对上一步的转化率。"开通 VIP"目前是演示开通，接入支付后就是真实付费。</p>';
      $('#vipSrc').textContent = r.vipBySource.length ? '有效 VIP 来源：' + r.vipBySource.map(function (x) { return x.source + ' ' + x.count + ' 人'; }).join('，') : '';
      $('#feat').innerHTML = r.features.length ? table([['label', '功能'], ['count', '使用次数']], r.features, { num: ['count'] }) : '<p class="muted small" style="padding:12px">这个时间段还没有功能使用记录。</p>';
      $('#invCount').textContent = '邀请注册：' + fmtNum(r.invitedSignups) + ' 人';
      $('#inv').innerHTML = r.inviters.length ? table([['email', '邀请人邮箱'], ['nickname', '昵称'], ['code', '邀请码'], ['invited', '带来注册']], r.inviters, { num: ['invited'] }) : '<p class="muted small" style="padding:12px">这个时间段还没有通过邀请链接注册的用户。</p>';
    }, function (e) { $('#funnel').innerHTML = '<p class="muted small">加载失败：' + esc(Cloud.errText(e)) + '</p>'; });
  }
  function filters() { return { from: state.from, to: state.to, dateField: state.dateField, keyword: state.keyword }; }

  var lastDaily = null;
  var DAILY_COLS = [['day', '日期'], ['newUsers', '新增用户'], ['activeUsers', '活跃用户'], ['attempts', '答题次数'], ['correct', '答对次数']];
  function loadOverview() {
    $('#kpis').innerHTML = '<div class="kpi"><span>加载中…</span></div>';
    Cloud.admin('overview', { from: state.from, to: state.to }).then(function (r) {
      var t = r.totals;
      var k = [['用户总数', t.totalUsers], ['区间新增用户', t.newUsers], ['今日活跃（DAU）', t.dau], ['近 7 日活跃（WAU）', t.wau], ['近 30 日活跃（MAU）', t.mau], ['区间答题次数', t.attempts], ['区间正确率', t.accuracy == null ? '—' : t.accuracy + '%']];
      $('#kpis').innerHTML = k.map(function (x) { return '<div class="kpi"><span>' + x[0] + '</span><b>' + (typeof x[1] === 'number' ? fmtNum(x[1]) : esc(x[1])) + '</b></div>'; }).join('');
      lastDaily = r.days;
      $('#chart').innerHTML = chartSVG(r.days);
      $('#dailyTbl').innerHTML = table(DAILY_COLS, r.days.slice().reverse(), { num: ['newUsers', 'activeUsers', 'attempts', 'correct'] });
    }, function (e) { $('#kpis').innerHTML = '<div class="kpi"><span>统计加载失败：' + esc(Cloud.errText(e)) + '</span></div>'; });
  }

  var USER_COLS = [['email', '邮箱'], ['nickname', '昵称'], ['school', '学校'], ['grade', '年级'], ['createdAt', '注册时间'], ['firstLoginAt', '首次登录'], ['lastLoginAt', '最后登录'], ['lastActiveAt', '最后活跃'],
    ['loginCount', '登录次数'], ['solvedCount', '已做对题数'], ['completion', '完成进度%'], ['projectsDone', '完成项目'], ['xpTotal', '经验值'], ['attempts', '提交次数'], ['accuracy', '正确率%'], ['streak', '连续天数'], ['vipUntil', 'VIP 到期'], ['vipSource', 'VIP 来源'], ['inviteCode', '邀请码'], ['invitedBy', '邀请人码'], ['uid', 'uid']];
  var TIME_COLS = ['createdAt', 'firstLoginAt', 'lastLoginAt', 'lastActiveAt'];
  function cell(row, k) { var v = row[k]; if (TIME_COLS.indexOf(k) >= 0) return cst(v); if (k === 'solvedCount') return v + (row.totalQuestions ? ' / ' + row.totalQuestions : ''); return v == null ? '' : v; }
  function loadUsers() {
    $('#utbl').innerHTML = '<p class="muted small" style="padding:14px">加载中…</p>';
    Cloud.admin('users', Object.assign(filters(), { page: state.page, pageSize: state.pageSize })).then(function (r) {
      var pages = Math.max(1, Math.ceil(r.total / r.pageSize));
      if (state.page > pages && r.total) { state.page = pages; return loadUsers(); }
      $('#ucount').textContent = '共 ' + fmtNum(r.total) + ' 人（按' + ({ createdAt: '注册时间', firstLoginAt: '首次登录时间', lastLoginAt: '最后登录时间', lastActiveAt: '最后活跃时间' })[r.dateField] + ' ' + r.range.from + ' 至 ' + r.range.to + '）';
      $('#pinfo').textContent = '第 ' + r.page + ' / ' + pages + ' 页';
      $('#prev').disabled = r.page <= 1; $('#next').disabled = r.page >= pages;
      $('#utbl').innerHTML = r.rows.length ? table(USER_COLS, r.rows, { num: ['loginCount', 'completion', 'projectsDone', 'xpTotal', 'attempts', 'accuracy', 'streak'], fmt: cell }) : '<p class="muted small" style="padding:14px">这个时间段没有用户。</p>';
    }, function (e) { $('#utbl').innerHTML = '<p class="muted small" style="padding:14px">加载失败：' + esc(Cloud.errText(e)) + '</p>'; });
  }
  function table(cols, rows, o) {
    o = o || {}; var num = o.num || [], fmt = o.fmt || function (r, k) { return r[k]; };
    return '<table class="adm"><thead><tr>' + cols.map(function (c) { return '<th class="' + (num.indexOf(c[0]) >= 0 ? 'num' : '') + '">' + c[1] + '</th>'; }).join('') + '</tr></thead><tbody>' +
      rows.map(function (r) { return '<tr>' + cols.map(function (c) { return '<td class="' + (num.indexOf(c[0]) >= 0 ? 'num' : '') + '">' + esc(fmt(r, c[0])) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table>';
  }

  function chartSVG(days) {
    if (!days.length) return '';
    var W = 1000, H = 220, P = 30, max = Math.max(1, Math.max.apply(null, days.map(function (d) { return Math.max(d.newUsers, d.activeUsers); })));
    var bw = (W - P * 2) / days.length;
    function y(v) { return H - P - (H - P * 2) * v / max; }
    var bars = days.map(function (d, i) { var h = (H - P * 2) * d.newUsers / max; return '<rect x="' + (P + i * bw + bw * .15).toFixed(1) + '" y="' + (H - P - h).toFixed(1) + '" width="' + (bw * .7).toFixed(1) + '" height="' + h.toFixed(1) + '" rx="2" fill="#0071e3"><title>' + d.day + ' 新增 ' + d.newUsers + '</title></rect>'; }).join('');
    var line = days.map(function (d, i) { return (i ? 'L' : 'M') + (P + i * bw + bw / 2).toFixed(1) + ' ' + y(d.activeUsers).toFixed(1); }).join(' ');
    var dots = days.map(function (d, i) { return '<circle cx="' + (P + i * bw + bw / 2).toFixed(1) + '" cy="' + y(d.activeUsers).toFixed(1) + '" r="3" fill="#30d158"><title>' + d.day + ' 活跃 ' + d.activeUsers + '</title></circle>'; }).join('');
    var step = Math.ceil(days.length / 8), labels = days.map(function (d, i) { return i % step ? '' : '<text x="' + (P + i * bw + bw / 2).toFixed(1) + '" y="' + (H - 8) + '" font-size="12" text-anchor="middle" fill="#86868b">' + d.day.slice(5) + '</text>'; }).join('');
    return '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '"><line x1="' + P + '" x2="' + (W - P) + '" y1="' + (H - P) + '" y2="' + (H - P) + '" stroke="#e8e8ed"/>' +
      '<text x="' + P + '" y="' + (P - 10) + '" font-size="12" fill="#86868b">最高 ' + max + '</text>' + bars + '<path d="' + line + '" fill="none" stroke="#30d158" stroke-width="2"/>' + dots + labels + '</svg>';
  }

  /* ---------------- 导出 ---------------- */
  function exportUsers(kind) {
    var b = kind === 'csv' ? $('#exCsv') : $('#exXlsx'), label = b.textContent; b.disabled = true; b.textContent = '导出中…';
    Cloud.admin('export', filters()).then(function (r) {
      var rows = r.rows.map(function (x) { var o = {}; USER_COLS.forEach(function (c) { o[c[0]] = TIME_COLS.indexOf(c[0]) >= 0 ? cst(x[c[0]]) : (c[0] === 'solvedCount' ? x.solvedCount : x[c[0]]); }); return o; });
      var name = '出师吧-用户-' + r.range.from + '_' + r.range.to;
      if (kind === 'csv') download(csv(USER_COLS, rows), name + '.csv', 'text/csv;charset=utf-8');
      else download(xlsx(USER_COLS, rows, '用户'), name + '.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      toast('已导出 ' + rows.length + ' 行' + (r.truncated ? '（超过上限，只导出了前 ' + rows.length + ' 行）' : ''));
    }, function (e) { toast('导出失败：' + Cloud.errText(e)); }).then(function () { b.disabled = false; b.textContent = label; });
  }
  function csvCell(v) {
    var s = v == null ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;                  // 防止 Excel 把内容当公式执行
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function csv(cols, rows) {
    return '﻿' + [cols.map(function (c) { return csvCell(c[1]); }).join(',')].concat(rows.map(function (r) { return cols.map(function (c) { return csvCell(r[c[0]]); }).join(','); })).join('\r\n');
  }
  function download(data, name, type) {
    var blob = data instanceof Blob ? data : new Blob([data], { type: type });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  /* 极简 .xlsx 生成器：一个工作表，ZIP 不压缩（store），不依赖第三方库 */
  var CRC = (function () { var t = [], c, n, k; for (n = 0; n < 256; n++) { c = n; for (k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(u8) { var c = 0xFFFFFFFF; for (var i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  function zip(files) {
    var enc = new TextEncoder(), parts = [], central = [], off = 0;
    function u16(v) { return [v & 255, (v >>> 8) & 255]; }
    function u32(v) { return [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255]; }
    files.forEach(function (f) {
      var name = enc.encode(f.name), data = enc.encode(f.data), crc = crc32(data);
      var head = [].concat(u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(0), u16(0x21), u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0));
      parts.push(new Uint8Array(head), name, data);
      central.push([].concat(u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(0), u16(0x21), u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(off)), name);
      off += head.length + name.length + data.length;
    });
    var csize = 0; central.forEach(function (c, i) { if (i % 2 === 0) parts.push(new Uint8Array(c)), csize += c.length; else parts.push(c), csize += c.length; });
    parts.push(new Uint8Array([].concat(u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length), u32(csize), u32(off), u16(0))));
    return new Blob(parts, { type: 'application/zip' });
  }
  function xmlEsc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ''); }
  function colName(i) { var s = ''; i++; while (i) { var m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }
  function xlsx(cols, rows, sheetName) {
    function rowXml(vals, r) {
      return '<row r="' + r + '">' + vals.map(function (v, i) {
        var ref = colName(i) + r;
        if (typeof v === 'number' && isFinite(v)) return '<c r="' + ref + '"><v>' + v + '</v></c>';
        if (v == null || v === '') return '';
        return '<c r="' + ref + '" t="inlineStr"><is><t xml:space="preserve">' + xmlEsc(v) + '</t></is></c>';
      }).join('') + '</row>';
    }
    var sheet = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' +
      rowXml(cols.map(function (c) { return c[1]; }), 1) + rows.map(function (r, i) { return rowXml(cols.map(function (c) { return r[c[0]]; }), i + 2); }).join('') + '</sheetData></worksheet>';
    return zip([
      { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>' },
      { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
      { name: 'xl/workbook.xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="' + xmlEsc(sheetName) + '" sheetId="1" r:id="rId1"/></sheets></workbook>' },
      { name: 'xl/_rels/workbook.xml.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>' },
      { name: 'xl/worksheets/sheet1.xml', data: sheet }
    ]);
  }

  window.PrenticeAdminExport = { csv: csv, xlsx: xlsx, USER_COLS: USER_COLS };   // 方便测试
  boot();
})();
