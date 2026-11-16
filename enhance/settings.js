/*!
 * 增强层设置界面（settings.js）
 * 把官方「设置」入口接管成一层 iOS 分组列表风格的设置页（P2 排版），
 * 四个能力都收在里面：系统提示词 / 记忆 / 上下文与用量 / 模型。
 * 另外接管：主题、语言、朗读音色、API Key、备份；「数据管理」交给官方原页面。
 */
(function () {
  'use strict';

  var X = window.__DSHXF;
  if (!X) return;

  var VERSION = '2.7.0';
  var LS = {
    theme: 'chat-demo:theme-preference',
    locale: 'chat-demo:locale',
    voice: 'chat-demo:tts-voice',
    key: 'chat-demo:api-key'
  };

  var state = {
    open: false,
    mode: 'official',
    hidden: false,
    stack: ['root'],
    official: null,
    models: [],
    busy: false,
    toastTimer: 0,
    suppressUntil: 0,
    allowOfficial: false,
    lastMemAt: 0,
    lastMemOps: 0
  };

  /* ---------------- 小工具 ---------------- */

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function lsGet(k) {
    try { return localStorage.getItem(k); } catch (e) { return null; }
  }
  function lsSet(k, v) {
    try { localStorage.setItem(k, v); } catch (e) {}
  }

  function fmt(n) {
    if (!n && n !== 0) return '0';
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
    return String(n);
  }

  function fmtTime(ts) {
    var d = new Date(ts);
    var h = d.getHours();
    var m = d.getMinutes();
    return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
  }

  // 跟随官方主题偏好（浅色/深色/跟随系统）
  function syncTheme() {
    try {
      var pref = lsGet(LS.theme);
      document.documentElement.setAttribute('data-ds-theme', pref === 'light' || pref === 'dark' ? pref : 'system');
    } catch (e) {}
  }

  /* ---------------- 图标 ---------------- */

  function ic(path) {
    return (
      '<svg class="ds-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + path + '</svg>'
    );
  }

  var I = {
    image: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="1.6"/><path d="M4 17l5-5 4 4 3-3 4 4"/></svg>',
    bubble: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M20 12a7 7 0 0 1-7 7H8l-4 3V12a7 7 0 0 1 7-7h2a7 7 0 0 1 7 7z"/></svg>',
    key: ic('<circle cx="9" cy="12" r="3.2"/><path d="M12.2 12H20"/><path d="M17.2 12v2.6"/><path d="M14.4 12v2.6"/>'),
    prompt: ic('<path d="M4 6.5h16v9H9l-4 3v-3H4z"/>'),
    memory: ic('<path d="M7 4h10v16l-5-3.5L7 20z"/>'),
    context: ic('<path d="M4 8h13l-3-3"/><path d="M20 16H7l3 3"/>'),
    model: ic('<rect x="7" y="7" width="10" height="10" rx="2"/><path d="M10 3v2M14 3v2M10 19v2M14 19v2M3 10h2M3 14h2M19 10h2M19 14h2"/>'),
    theme: ic('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
    globe: ic('<circle cx="12" cy="12" r="8"/><path d="M4 12h16"/><path d="M12 4c2.5 2.6 2.5 13.4 0 16M12 4c-2.5 2.6-2.5 13.4 0 16"/>'),
    voice: ic('<path d="M5 10v4h3l4 3V7l-4 3H5z"/><path d="M16 9.5a4 4 0 0 1 0 5"/>'),
    backup: ic('<path d="M12 4v10"/><path d="M8 10l4 4 4-4"/><path d="M5 18h14"/>'),
    data: ic('<ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6"/>'),
    wallet: ic('<rect x="3" y="6" width="18" height="13" rx="3"/><path d="M3 10h18"/><path d="M16.5 14.5h.01"/>'),
    plus: ic('<path d="M12 5v14M5 12h14"/>'),
    phone: ic('<path d="M6.5 4h3l1.6 4-2 1.4a12.5 12.5 0 0 0 5.5 5.5l1.4-2 4 1.6v3a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 3.5 6.2 2 2 0 0 1 5.5 4z"/>'),
    info: ic('<circle cx="12" cy="12" r="8"/><path d="M12 11v5"/><path d="M12 7.6h.01"/>')
  };

  var CHEV = '<svg class="ds-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>';
  var BACK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>';

  /* ---------------- 组件 ---------------- */

  function head(title, opts) {
    opts = opts || {};
    var left = opts.back
      ? '<button class="ds-back" data-act="back" aria-label="返回">' + BACK + '</button>'
      : '';
    var right = opts.close
      ? '<button class="ds-close" data-act="close" aria-label="关闭">✕</button>'
      : '<span class="ds-head-sp"></span>';
    return '<div class="ds-head">' + left + '<div class="ds-title">' + esc(title) + '</div>' + right + '</div>';
  }

  function section(title, inner) {
    return '<div class="ds-section"><div class="ds-section-title">' + esc(title) + '</div>' + inner + '</div>';
  }

  function card(inner, extraClass) {
    return '<div class="ds-card ' + (extraClass || '') + '">' + inner + '</div>';
  }

  function row(o) {
    var attrs = 'class="ds-row' + (o.danger ? ' ds-danger' : '') + '"';
    if (o.act) {
      attrs += ' data-act="' + esc(o.act) + '"';
      if (o.value) attrs += ' data-value="' + esc(o.value) + '"';
      if (o.page) attrs += ' data-page="' + esc(o.page) + '"';
      attrs += ' role="button" tabindex="0"';
    }
    var left = (o.icon ? '<span class="ds-icw">' + o.icon + '</span>' : '');
    var right = '';
    if (o.text) right = '<span class="ds-text">' + esc(o.text) + '</span>';
    if (o.value !== undefined) right += '<span class="ds-val">' + esc(o.value) + '</span>';
    if (o.act !== undefined || o.chev) right += CHEV;
    return '<div ' + attrs + '>' + left + '<span class="ds-label">' + esc(o.label) + '</span>' + right + '</div>';
  }

  function switchRow(label, key, on, hint) {
    return (
      '<div class="ds-row ds-row-s">' +
      '<span class="ds-label ds-label-wrap">' + esc(label) + (hint ? '<em>' + esc(hint) + '</em>' : '') + '</span>' +
      '<button class="ds-switch" data-act="toggle" data-key="' + esc(key) + '" aria-pressed="' + !!on + '" aria-label="' + esc(label) + '"><i></i></button>' +
      '</div>'
    );
  }

  function actionRow(label, act, opts) {
    opts = opts || {};
    var extra = opts.page ? ' data-page="' + esc(opts.page) + '"' : '';
    return '<div class="ds-row ds-action' + (opts.danger ? ' ds-danger' : '') + '" data-act="' + esc(act) + '"' + extra + ' role="button" tabindex="0"><span class="ds-label">' + esc(label) + '</span></div>';
  }

  // 由本模块自己处理、不落到 X.saveSettings 的开关
  function rawSwitchRow(label, hint, act, on) {
    return (
      '<div class="ds-row ds-row-s">' +
      '<span class="ds-label ds-label-wrap">' + esc(label) + (hint ? '<em>' + esc(hint) + '</em>' : '') + '</span>' +
      '<button class="ds-switch" data-act="' + esc(act) + '" aria-pressed="' + !!on + '" aria-label="' + esc(label) + '"><i></i></button>' +
      '</div>'
    );
  }

  function kvRow(label, value) {
    return '<div class="ds-kv"><span>' + esc(label) + '</span><b>' + esc(value) + '</b></div>';
  }

  function avatarData() {
    try {
      return localStorage.getItem('dshx:avatar') || '';
    } catch (e) {
      return '';
    }
  }

  function liveMic() {
    try {
      return window.__DSHV && window.__DSHV.micState ? window.__DSHV.micState() === 'live' : false;
    } catch (e) {
      return false;
    }
  }

  function pickAvatar() {
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.style.display = 'none';
    document.body.appendChild(input);
    input.addEventListener('change', function () {
      var f = input.files && input.files[0];
      if (!f) {
        input.remove();
        return;
      }
      var reader = new FileReader();
      reader.onload = function () {
        var img = new Image();
        img.onload = function () {
          try {
            var size = 256;
            var cv = document.createElement('canvas');
            cv.width = size;
            cv.height = size;
            var g = cv.getContext('2d');
            var side = Math.min(img.width, img.height);
            g.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size);
            var data = cv.toDataURL('image/jpeg', 0.86);
            localStorage.setItem('dshx:avatar', data);
            if (window.__DSHV) window.__DSHV.refreshAvatar();
            render();
            showToast('头像已更新', 'ok');
          } catch (e) {
            showToast('处理图片失败：' + (e && e.message ? e.message : ''), 'err');
          }
          input.remove();
        };
        img.onerror = function () {
          showToast('这个文件不是有效图片', 'err');
          input.remove();
        };
        img.src = String(reader.result);
      };
      reader.readAsDataURL(f);
    });
    input.click();
  }

  function handsLabel() {
    try {
      return localStorage.getItem('dshx:hands-free') === '0' ? '按住说话' : '免手持';
    } catch (e) {
      return '免手持';
    }
  }

  function optionRow(label, selected, act, value) {
    return (
      '<div class="ds-row" data-act="' + esc(act) + '" data-value="' + esc(value) + '" role="button" tabindex="0">' +
      '<span class="ds-label">' + esc(label) + '</span>' +
      (selected ? '<span class="ds-tick">✓</span>' : '') +
      '</div>'
    );
  }

  /* ---------------- 页面 ---------------- */

  var pages = {};

  pages.root = function () {
    var s = X.getSettings();
    var key = X.getKey();
    var facts = s.items.filter(function (i) { return i.kind !== 'summary'; }).length;
    var themeMap = { light: '浅色', dark: '深色', system: '跟随系统' };
    var theme = themeMap[lsGet(LS.theme)] || '跟随系统';
    var locale = lsGet(LS.locale) === 'en-US' ? 'English' : '简体中文';
    var voice = lsGet(LS.voice) === 'tide' ? '暗潮（男声）' : '海星（女声）';
    var bal = X.lastBalance;
    var balText = !key ? '—' : bal ? X.fmtMoney(bal.total, bal.currency) : '查询余额';
    var balWarn = bal && !bal.available ? '<div class="ds-muted ds-warn">余额不足，充值后即可继续使用。</div>' : '';

    return (
      '<div class="ds-page">' +
      head('设置', { close: true }) +
      '<div class="ds-scroll">' +
      section('账户',
        card(
          row({ icon: I.key, label: 'API Key', act: 'nav', page: 'apikey', value: key ? '已配置' : '未配置' }) +
          row({ icon: I.wallet, label: '余额', act: 'balance-refresh', value: balText }) +
          row({ icon: I.plus, label: '充值', act: 'topup', value: '' })
        ) + balWarn
      ) +
      section('应用',
        card(
          row({ icon: I.prompt, label: '系统提示词', act: 'nav', page: 'prompt', value: s.systemEnabled ? '自定义' : '默认' }) +
          row({ icon: I.memory, label: '记忆', act: 'nav', page: 'memory', value: facts ? facts + ' 条' : '空' }) +
          row({ icon: I.context, label: '上下文与用量', act: 'nav', page: 'context', value: s.autoCompress ? '自动压缩' : '手动' }) +
          row({ icon: I.phone, label: '语音通话', act: 'nav', page: 'voice', value: handsLabel() }) +
          row({ icon: I.model, label: '模型', act: 'nav', page: 'model', value: s.model })
        )
      ) +
      section('外观',
        card(
          row({ icon: I.theme, label: '主题', act: 'nav', page: 'theme', value: theme }) +
          row({ icon: I.globe, label: '语言', act: 'nav', page: 'locale', value: locale }) +
          row({ icon: I.voice, label: '朗读音色', act: 'nav', page: 'tts-voice', value: voice })
        )
      ) +
      section('数据',
        card(
          row({ icon: I.backup, label: '备份与恢复', act: 'nav', page: 'backup', value: '' }) +
          row({ icon: I.data, label: '数据管理（导入 / 导出 / 清空）', act: 'official-data', value: '' })
        )
      ) +
      section('关于',
        card(
          row({ icon: I.info, label: '增强层版本', value: VERSION }) +
          row({ icon: I.info, label: '基于版本', value: 'chat-demo 0.1.1' })
        )
      ) +
      '<div class="ds-foot">所有设置与聊天记录都只保存在这台设备的浏览器里。</div>' +
      '</div></div>'
    );
  };

  pages.prompt = function () {
    var s = X.getSettings();
    return (
      '<div class="ds-page">' +
      head('系统提示词', { back: true }) +
      '<div class="ds-scroll">' +
      card(
        '<div class="ds-cell"><textarea id="ds-system" class="ds-ta" rows="10" spellcheck="false" ' +
        'placeholder="例如：你是我的私人助理，回答简短，先说结论。">' + esc(s.system) + '</textarea></div>'
      ) +
      card(switchRow('启用', 'systemEnabled', s.systemEnabled)) +
      card(actionRow('保存', 'save-prompt') + actionRow('恢复官方默认', 'reset-prompt')) +
      section('提示',
        card(
          '<div class="ds-cell ds-note">每次请求都会作为 system 发给模型。支持占位符 <code>{{memory}}</code>，' +
          '不写则记忆自动追加在末尾。留空或关闭开关时使用官方默认提示词。</div>'
        )
      ) +
      '<details class="ds-details"><summary>查看当前实际生效的 system</summary><pre class="ds-pre">' + esc(X.sys()) + '</pre></details>' +
      '</div></div>'
    );
  };

  pages.memory = function () {
    var s = X.getSettings();
    var facts = s.items.filter(function (i) { return i.kind !== 'summary'; });
    var sums = s.items.filter(function (i) { return i.kind === 'summary'; });
    var list = facts.length
      ? facts.map(function (it) {
          return (
            '<div class="ds-mem" data-id="' + esc(it.id) + '">' +
            '<button class="ds-check" data-act="mem-toggle" data-value="' + esc(it.id) + '" aria-pressed="' + it.enabled + '" aria-label="启用"></button>' +
            '<textarea class="ds-mem-ta" rows="2" data-act="mem-edit" data-value="' + esc(it.id) + '">' + esc(it.text) + '</textarea>' +
            '<button class="ds-x" data-act="mem-del" data-value="' + esc(it.id) + '" aria-label="删除">✕</button>' +
            '</div>'
          );
        }).join('')
      : '<div class="ds-cell ds-empty">还没有记忆。聊天时如果我判断有值得记的东西，会自己加进来。</div>';

    var memStatus = state.lastMemAt
      ? '上次自动整理：' + fmtTime(state.lastMemAt) + (state.lastMemOps ? '（' + state.lastMemOps + ' 项变更）' : '（无变更）')
      : '还没有自动整理过';

    return (
      '<div class="ds-page">' +
      head('记忆', { back: true }) +
      '<div class="ds-scroll">' +
      card(
        switchRow('自动记忆', 'autoMemory', s.autoMemory, '每轮对话后由我判断该不该记、该改哪条') +
        switchRow('注入到提示词', 'memoryEnabled', s.memoryEnabled)
      ) +
      '<div class="ds-muted">' + esc(memStatus) + '</div>' +
      section('记忆条目' + (facts.length ? '（' + facts.length + '）' : ''), list) +
      card(
        '<div class="ds-cell ds-addrow"><input id="ds-new-mem" class="ds-in" placeholder="手动添加一条记忆" />' +
        '<button class="ds-mini" data-act="mem-add">添加</button></div>'
      ) +
      card(actionRow('现在整理一次', 'mem-run')) +
      (sums.length
        ? section('上下文摘要', sums.map(function (it) {
            return '<div class="ds-sum" data-id="' + esc(it.id) + '">' + esc(it.text) +
              '<button class="ds-x" data-act="mem-del" data-value="' + esc(it.id) + '" aria-label="删除">✕</button></div>';
          }).join(''))
        : '') +
      '</div></div>'
    );
  };

  pages.context = function () {
    var s = X.getSettings();
    var lc = X.lastCtx;
    var lu = X.lastUsage;
    var log = X.getUsageLog();
    var stat = lc
      ? '上次请求 ' + lc.kept + ' 条' + (lc.dropped ? '（已压缩 ' + lc.dropped + ' 条）' : '') + ' · 约 ' + fmt(lc.tokens) + ' tokens'
      : '还没捕获到请求，发一条消息后这里会显示。';

    var usage = lu
      ? '<div class="ds-kv"><span>输入</span><b>' + fmt(lu.input) + '</b></div>' +
        '<div class="ds-kv"><span>缓存命中</span><b>' + fmt(lu.cacheRead) + '</b></div>' +
        '<div class="ds-kv"><span>输出</span><b>' + fmt(lu.output) + '</b></div>'
      : '<div class="ds-cell ds-empty">暂无数据</div>';

    var logHtml = log.length
      ? log.slice(-5).reverse().map(function (r) {
          return '<div class="ds-logrow"><span>' + fmtTime(r.at) + '</span><span>↑' + fmt(r.input) + '</span><span>缓存 ' + fmt(r.cacheRead) + '</span><span>↓' + fmt(r.output) + '</span></div>';
        }).join('')
      : '';

    return (
      '<div class="ds-page">' +
      head('上下文与用量', { back: true }) +
      '<div class="ds-scroll">' +
      card(switchRow('自动压缩', 'autoCompress', s.autoCompress, '聊长了自动把旧消息压成摘要')) +
      card(actionRow('压缩阈值', 'nav-compress-at', { value: fmt(s.compressAt) + ' tokens' })) +
      '<div class="ds-muted">' + esc(stat) + '</div>' +
      card(actionRow('立即压缩上下文', 'ctx-compress') + actionRow('清除压缩标记（重新发送完整历史）', 'ctx-reset')) +
      section('最近一轮',
        card(usage)
      ) +
      (logHtml ? section('最近记录', card(logHtml)) : '') +
      card(switchRow('显示每轮用量', 'showUsage', s.showUsage, '在聊天页顶部显示一小条')) +
      section('说明',
        card('<div class="ds-cell ds-note">不再限制条数和 token。压缩时会保留最近 6 条原文，更早的内容变成一条摘要，' +
          '本地聊天记录不会被删除，只是不再重复发送。</div>')
      ) +
      '</div></div>'
    );
  };

  pages.voice = function () {
    var v = window.__DSHV;
    var cap = v && v.capability ? v.capability() : null;
    var hands = handsLabel() === '免手持';
    var rows;
    if (cap) {
      rows =
        kvRow('麦克风', cap.mic ? '可用' : '不可用') +
        kvRow('麦克风占用', liveMic() ? '通话中保持' : '空闲（首次会询问一次）') +
        kvRow('HTTPS 环境', cap.secure ? '是' : '否（需要 HTTPS）') +
        kvRow('浏览器语音识别（兜底）', cap.browserAsr ? '可用' : '不支持') +
        kvRow('系统朗读（兜底）', cap.browserTts ? '可用' : '不支持');
    } else {
      rows = '<div class="ds-cell ds-empty">语音模块未加载</div>';
    }
    return (
      '<div class="ds-page">' +
      head('语音通话', { back: true }) +
      '<div class="ds-scroll">' +
      section('设备能力', card(rows)) +
      section('通话头像',
        card(
          '<div class="ds-ava-row">' +
            '<img class="ds-ava" src="' + (avatarData() || 'icons/icon-192.png') + '" alt="" />' +
            '<div class="ds-ava-txt"><b>显示在通话页</b><em>' + (avatarData() ? '本地自定义图片' : '默认 app 图标') + '</em></div>' +
          '</div>'
        ) +
        card(actionRow('选择本地图片', 'avatar-pick') + (avatarData() ? actionRow('恢复默认头像', 'avatar-reset', { danger: true }) : ''))
      ) +
      card(rawSwitchRow('免手持', '说完自动继续听，不用手按', 'voice-hands', hands)) +
      card(actionRow('开始语音通话', 'call-start')) +
      section('怎么工作',
        card('<div class="ds-cell ds-note">录音在本地编码成 16k 单声道 WAV，交给官方 <code>/v1/tools/asr</code> 转写；' +
          '文字送进聊天（走同一套提示词、记忆、上下文），拿到回复后用 <code>/v1/tools/tts</code> 朗读。' +
          '这两个接口不可用时会自动降级为系统语音识别 / 系统朗读。</div>')
      ) +
      '<div class="ds-muted">通话内容会正常进聊天记录，也计入 token 用量。</div>' +
      section('关于麦克风授权',
        card('<div class="ds-cell ds-note">iOS 是按「站点」记住授权的，同一个链接只会问一次。' +
          '如果每次进来都问，通常是访问地址变了（http / https 不同、局域网 IP 变了、或从 Safari 换成了主屏幕图标）。' +
          '另外通话期间会一直复用同一条麦克风流，不会每说一句就重新申请。</div>')
      ) +
      '</div></div>'
    );
  };

  pages.model = function () {
    var s = X.getSettings();
    var chips = state.models.length
      ? '<div class="ds-chips">' + state.models.map(function (m) {
          return '<button class="ds-chip' + (m === s.model ? ' ds-chip-on' : '') + '" data-act="model-pick" data-value="' + esc(m) + '">' + esc(m) + '</button>';
        }).join('') + '</div>'
      : '';
    return (
      '<div class="ds-page">' +
      head('模型', { back: true }) +
      '<div class="ds-scroll">' +
      card('<div class="ds-cell"><input id="ds-model" class="ds-in" value="' + esc(s.model) + '" autocapitalize="off" autocorrect="off" spellcheck="false" /></div>') +
      card(actionRow('保存模型名', 'model-save') + actionRow('拉取可用模型', 'model-load')) +
      chips +
      section('内容风控',
        card(
          '<div class="ds-seg">' +
          '<button class="ds-segbtn' + (s.safety !== 'high' ? ' ds-seg-on' : '') + '" data-act="safety" data-value="standard">标准</button>' +
          '<button class="ds-segbtn' + (s.safety === 'high' ? ' ds-seg-on' : '') + '" data-act="safety" data-value="high">加强</button>' +
          '</div>'
        )
      ) +
      '<div class="ds-muted">标准：整个 <code>safety_check</code> 字段都不提交，走平台默认检查。' +
      '加强：显式让平台额外审核输入输出（官方 demo 的默认值）。' +
      '说明：接口层面没有「完全关闭」，标准就是能做到的最松一档。</div>' +
      '</div></div>'
    );
  };

  pages.apikey = function () {
    var key = X.getKey();
    return (
      '<div class="ds-page">' +
      head('API Key', { back: true, close: state.stack.length === 1 }) +
      '<div class="ds-scroll">' +
      card('<div class="ds-cell"><input id="ds-key" class="ds-in" type="password" autocomplete="off" spellcheck="false" placeholder="sk-…" value="' + esc(key) + '" /></div>') +
      card(actionRow('保存并验证', 'key-save') + (key ? actionRow('清除', 'key-clear', { danger: true }) : '')) +
      section('说明',
        card('<div class="ds-cell ds-note">Key 只保存在这台设备的 localStorage 里，不会上传到任何地方（除了直接调用 DeepSeek 接口）。' +
          '验证方式为请求 <code>/models</code>。</div>')
      ) +
      (key ? '<div class="ds-muted">当前：' + esc(key.slice(0, 6)) + '…' + esc(key.slice(-4)) + '</div>' : '') +
      '</div></div>'
    );
  };

  pages.backup = function () {
    return (
      '<div class="ds-page">' +
      head('备份与恢复', { back: true }) +
      '<div class="ds-scroll">' +
      card(actionRow('导出增强设置', 'backup-export') + actionRow('导入增强设置', 'backup-import')) +
      section('说明',
        card('<div class="ds-cell ds-note">导出内容包括提示词、记忆、压缩状态与模型设置，<b>不含 API Key</b>。' +
          '聊天记录请用「数据管理」里的官方导出。</div>')
      ) +
      '</div></div>'
    );
  };

  function optionPage(title, current, opts, act) {
    return (
      '<div class="ds-page">' +
      head(title, { back: true }) +
      '<div class="ds-scroll">' +
      card(
        opts.map(function (o) {
          return optionRow(o.label, o.value === current, act, o.value);
        }).join('')
      ) +
      '<div class="ds-muted">切换后会刷新页面以生效。</div>' +
      '</div></div>'
    );
  }

  pages.theme = function () {
    var cur = lsGet(LS.theme) || 'system';
    var bg = X.getChatBg();
    var bub = X.getBubbleColor() || '';
    var themeRows = [
      ['light', '浅色'],
      ['dark', '深色'],
      ['system', '跟随系统']
    ]
      .map(function (o) {
        return optionRow(o[1], o[0] === cur, 'opt-theme', o[0]);
      })
      .join('');
    var list = [
      ['', '默认'],
      ['#dbeafe', '雾蓝'],
      ['#d9f2ff', '天蓝'],
      ['#dcfce7', '薄荷'],
      ['#fde2e4', '樱粉'],
      ['#fef3c7', '奶黄'],
      ['#ede9fe', '香芋'],
      ['#e5e7eb', '浅灰'],
      ['#111827', '墨黑']
    ];
    var chips = list
      .map(function (it) {
        var on = bub === it[0];
        return (
          '<button class="ds-chip ds-chip-color' + (on ? ' ds-chip-on' : '') + '" data-act="opt-bubble" data-value="' + it[0] + '">' +
          '<i style="background:' + (it[0] || '#fff') + '"></i><em>' + it[1] + '</em></button>'
        );
      })
      .join('');
    return (
      '<div class="ds-page">' +
      head('主题', { back: true }) +
      '<div class="ds-scroll">' +
      section('外观', card(themeRows)) +
      '<div class="ds-muted">切换外观后会刷新页面以生效。</div>' +
      section(
        '聊天背景',
        (bg ? card('<div class="ds-cell"><img class="ds-bgprev" src="' + bg + '" alt="" /></div>') : '') +
          card(
            actionRow(bg ? '更换背景图' : '上传背景图', 'bg-pick') +
              (bg ? actionRow('移除背景图', 'bg-clear', { danger: true }) : '')
          )
      ) +
      section('我的气泡颜色', card('<div class="ds-cell"><div class="ds-chips">' + chips + '</div></div>')) +
      section(
        '自定义 CSS',
        card(
          actionRow('我的气泡 CSS', 'nav-css', { value: X.getCustomCss() ? '已设置' : '默认' }) +
            actionRow('助手气泡 CSS', 'nav-css-ai', { value: X.getCustomCssAi() ? '已设置' : '默认' }) +
            (X.getCustomCss() || X.getCustomCssAi() ? actionRow('全部清空', 'css-clear', { danger: true }) : '')
        )
      ) +
      '<div class="ds-muted">只改你发出的气泡，助手的不受影响。</div>' +
      '</div></div>'
    );
  };

  pages['compress-at'] = function () {
    var s2 = X.getSettings();
    var v = s2.compressAt || 100000;
    var presets = [50000, 80000, 100000, 128000];
    var chips = presets
      .map(function (p) {
        return (
          '<button class="ds-chip' + (v === p ? ' ds-chip-on' : '') + '" data-act="compress-set" data-value="' + p + '">' + fmt(p) + '</button>'
        );
      })
      .join('');
    return (
      '<div class="ds-page">' +
      head('压缩阈值', { back: true }) +
      '<div class="ds-scroll">' +
      card('<div class="ds-cell"><input id="ds-cat" class="ds-in" type="number" inputmode="numeric" min="8000" max="128000" step="1000" value="' + v + '" /><div class="ds-muted" style="margin-top:8px">达到这个 token 数就压缩一次（只按上下文算，不看消息条数）。</div></div>') +
      card(actionRow('保存', 'compress-save')) +
      '<div class="ds-muted">常用值</div>' +
      card('<div class="ds-cell"><div class="ds-chips">' + chips + '</div></div>') +
      section('说明', card('<div class="ds-cell ds-note">DeepSeek 上下文是 128k。压缩时会保留最近 6 条原文，更早的压成一条摘要，本地记录不删。范围 8,000 – 128,000。</div>')) +
      '</div></div>'
    );
  };

  pages['custom-css-ai'] = function () {
    var css = X.getCustomCssAi();
    var sample =
      '/* 例：给助手回复加一层柔和气泡 */\n' +
      '#root .message-e1faee .ds-assistant-message-main-content {\n' +
      '  background: rgba(255,255,255,.6);\n' +
      '  border-radius: 18px;\n' +
      '  padding: 12px 14px;\n' +
      '}\n';
    return (
      '<div class="ds-page">' +
      head('助手气泡 CSS', { back: true }) +
      '<div class="ds-scroll">' +
      card('<div class="ds-cell"><textarea id="ds-css-ai" class="ds-ta ds-css-ta" spellcheck="false" placeholder="' + esc(sample) + '">' + esc(css) + '</textarea></div>') +
      card(actionRow('保存并应用', 'css-save-ai') + (css ? actionRow('清空', 'css-clear', { danger: true }) : '')) +
      section('说明', card('<div class="ds-cell ds-note">留空就是默认样式。常用选择器：<code>#root .message-e1faee</code>（整条消息）、<code>#root .message-e1faee .ds-assistant-message-main-content</code>（正文容器）、<code>#root .ds-markdown</code>（正文排版）。</div>')) +
      '</div></div>'
    );
  };

  pages['custom-css'] = function () {
    var css = X.getCustomCss();
    var sample =
      '/* 例：气泡渐变 + 大圆角 */\n' +
      '#root .bubble-_4cfe7 {\n' +
      '  background: linear-gradient(135deg, #e0e7ff, #f3e8ff) !important;\n' +
      '  border-radius: 20px !important;\n' +
      '}\n';
    return (
      '<div class="ds-page">' +
      head('自定义 CSS', { back: true }) +
      '<div class="ds-scroll">' +
      card('<div class="ds-cell"><textarea id="ds-css" class="ds-ta ds-css-ta" spellcheck="false" placeholder="' + esc(sample) + '">' + esc(css) + '</textarea></div>') +
      card(actionRow('保存并应用', 'css-save') + (css ? actionRow('清空', 'css-clear', { danger: true }) : '')) +
      section('说明', card('<div class="ds-cell ds-note">这段 CSS 会插到页面最后，直接作用在真实界面上（不是隔离环境），写错会影响显示，清空即可恢复。<br>常用选择器：<code>#root .bubble-_4cfe7</code>（气泡）、<code>#root .main-_9fdf5</code>（聊天区）、<code>#root .sider-ac14ac</code>（侧栏）。</div>')) +
      '</div></div>'
    );
  };

  pages.locale = function () {
    return optionPage('语言', lsGet(LS.locale) || 'zh-CN', [
      { value: 'zh-CN', label: '简体中文' },
      { value: 'en-US', label: 'English' }
    ], 'opt-locale');
  };

  pages['tts-voice'] = function () {
    return optionPage('朗读音色', lsGet(LS.voice) || 'stella', [
      { value: 'stella', label: '海星（女声）' },
      { value: 'tide', label: '暗潮（男声）' }
    ], 'opt-voice');
  };

  /* ---------------- 背景图选择 ---------------- */

  var fileInput = null;

  function ensureInput() {
    if (fileInput) return fileInput;
    fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    fileInput.style.display = 'none';
    fileInput.addEventListener('change', onFilePicked);
    document.body.appendChild(fileInput);
    return fileInput;
  }

  function pickBg() {
    var inp = ensureInput();
    inp.value = '';
    inp.click();
  }

  function onFilePicked(ev) {
    var file = ev.target.files && ev.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      var img = new Image();
      img.onload = function () {
        try {
          var MAX = 1600;
          var w = img.width;
          var h = img.height;
          var scale = Math.min(1, MAX / Math.max(w, h));
          var cv = document.createElement('canvas');
          cv.width = Math.round(w * scale);
          cv.height = Math.round(h * scale);
          cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
          var data = cv.toDataURL('image/jpeg', 0.82);
          X.setChatBg(data);
          render();
          showToast('背景图已应用', 'ok');
        } catch (e) {
          showToast('图片处理失败，换一张试试', 'err');
        }
      };
      img.onerror = function () { showToast('图片读不出来', 'err'); };
      img.src = reader.result;
    };
    reader.onerror = function () { showToast('读取失败', 'err'); };
    reader.readAsDataURL(file);
  }

  /* ---------------- 渲染 ---------------- */

  function render() {
    var host = document.getElementById('ds-pagehost');
    if (!host) return;
    var page = state.stack[state.stack.length - 1];
    var fn = pages[page] || pages.root;
    host.innerHTML = fn();
    var sc = host.querySelector('.ds-scroll');
    if (sc) sc.scrollTop = 0;
  }

  function push(page) {
    state.stack.push(page);
    render();
  }

  function pop() {
    if (state.stack.length > 1) {
      state.stack.pop();
      render();
      return;
    }
    // 已经在最外层：返回 = 关掉（否则会卡在需要 Key 的那一页出不来）
    closeOverlay();
  }

  /* ---------------- 官方设置探测 ---------------- */

  // 把官方弹窗（连同全屏蒙版）藏起来；返回被藏的元素，方便还原
  function hideOfficial(dlg) {
    if (!dlg) return;
    var hidden = state.officialHidden || (state.officialHidden = []);
    var kill = function (el) {
      try {
        el.style.setProperty('display', 'none', 'important');
        if (hidden.indexOf(el) < 0) hidden.push(el);
      } catch (e) {}
    };
    kill(dlg);
    var box = dlg.parentElement;
    if (box && box !== document.body) {
      var r = box.getBoundingClientRect();
      if (r.width >= window.innerWidth * 0.9 && r.height >= window.innerHeight * 0.9) kill(box);
    }
  }

  function showOfficial() {
    var hidden = state.officialHidden || [];
    for (var i = 0; i < hidden.length; i++) {
      try { hidden[i].style.removeProperty('display'); } catch (e) {}
    }
    state.officialHidden = [];
  }

  // 找到官方界面上那个「设置」入口元素（文字恰好是 设置 / Settings）
  function findSettingsEntry() {
    var all = document.querySelectorAll('body *');
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (el.closest && el.closest('#dshx-settings')) continue;
      if (el.children.length > 3) continue;
      var t = (el.textContent || '').trim();
      if (t === '设置' || t === 'Settings') return el;
    }
    return null;
  }

  function tabTexts(dlg) {
    var out = [];
    var tabs = dlg.querySelectorAll('[role="tab"]');
    for (var i = 0; i < tabs.length; i++) out.push((tabs[i].textContent || '').trim());
    return out;
  }

  function findOfficial() {
    var nodes = document.querySelectorAll('[role="dialog"]');
    for (var i = 0; i < nodes.length; i++) {
      var d = nodes[i];
      if (d.closest('#dshx-settings')) continue;
      var t = d.textContent || '';
      var zh = t.indexOf('通用设置') >= 0 && t.indexOf('数据管理') >= 0;
      var en = t.indexOf('General') >= 0 && t.indexOf('Data') >= 0;
      if (zh || en) return d;
    }
    return null;
  }

  function officialTab(dlg, kind) {
    var tabs = dlg.querySelectorAll('[role="tab"]');
    for (var i = 0; i < tabs.length; i++) {
      var t = (tabs[i].textContent || '').trim();
      if (kind === 'data' && (t.indexOf('数据管理') >= 0 || t.indexOf('Data') >= 0)) return tabs[i];
      if (kind === 'general' && (t.indexOf('通用设置') >= 0 || t.indexOf('General') >= 0)) return tabs[i];
    }
    return null;
  }

  function closeOfficial(dlg) {
    if (!dlg) return;
    var btn = dlg.querySelector('button[aria-label="关闭"], button[aria-label="Close"]');
    if (btn) {
      try { btn.click(); } catch (e) {}
    }
  }

  /* ---------------- 开关与提示 ---------------- */

  function showToast(text, kind) {
    var el = document.getElementById('dshx-toast');
    if (!el) return;
    el.textContent = text;
    el.className = 'ds-toast ds-toast-on' + (kind ? ' ds-toast-' + kind : '');
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(function () {
      el.className = 'ds-toast';
    }, 4600);
  }

  function updatePill() {
    var el = document.getElementById('dshx-usage');
    if (!el) return;
    var s = X.getSettings();
    var u = X.lastUsage;
    if (!s.showUsage || !u) {
      el.classList.remove('ds-usage-on');
      return;
    }
    var parts = ['↑' + fmt(u.input)];
    if (u.cacheRead) parts.push('缓存 ' + fmt(u.cacheRead));
    parts.push('↓' + fmt(u.output));
    el.textContent = parts.join(' · ');
    el.classList.add('ds-usage-on');
  }

  /* ---------------- 打开 / 关闭 ---------------- */

  function openOverlay(mode, official) {
    var el = document.getElementById('dshx-settings');
    if (!el) return;
    state.open = true;
    state.mode = mode;
    state.hidden = false;
    state.official = official || null;
    state.stack = ['root'];
    // 官方弹窗先藏起来：否则它会先画一帧，再被我们盖住，看起来就是"闪一下"
    if (official) {
      try {
        official.style.visibility = 'hidden';
      } catch (e) {}
      el.classList.add('ds-instant');
    } else {
      el.classList.remove('ds-instant');
    }
    el.classList.add('ds-open');
    el.setAttribute('aria-hidden', 'false');
    syncTheme();
    render();
    updatePill();
    // 打开时顺手刷一次余额（有 Key 且缓存过期才会真的请求）
    if (X.getKey()) {
      setTimeout(function () {
        X.fetchBalance()
          .then(function () {
            if (state.open) render();
          })
          .catch(function () {});
      }, 250);
    }
  }

  function hideOverlay() {
    var el = document.getElementById('dshx-settings');
    if (!el) return;
    if (state.official) {
      try {
        state.official.style.visibility = '';
      } catch (e) {}
    }
    if (state.officialMask) {
      try {
        state.officialMask.style.visibility = '';
      } catch (e) {}
    }
    state.hidden = true;
    el.classList.remove('ds-open');
    el.setAttribute('aria-hidden', 'true');
  }

  function closeOverlay(skipOfficialClose) {
    var el = document.getElementById('dshx-settings');
    var dlg = state.official || findOfficial();
    showOfficial();
    state.open = false;
    state.hidden = false;
    state.stack = ['root'];
    state.suppressUntil = Date.now() + 1500;
    state.official = null;
    if (el) {
      el.classList.remove('ds-open');
      el.setAttribute('aria-hidden', 'true');
    }
    showOfficial();
    // 关官方弹窗：点「×」→ 点遮罩 → 发 Esc，三级尝试，保证它真的关掉
    if (!skipOfficialClose) closeOfficialHard(dlg);
  }

  function closeOfficialHard(dlg) {
    if (!dlg) return;
    closeOfficial(dlg);
    setTimeout(function () {
      if (!dlg.isConnected) return;
      try {
        var mask = dlg.parentElement;
        if (mask) mask.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      } catch (e) {}
      setTimeout(function () {
        if (!dlg.isConnected) return;
        try {
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        } catch (e) {}
      }, 220);
    }, 140);
  }

  function check() {
    var dlg = findOfficial();
    if (dlg) {
      state.official = dlg;
      if (Date.now() < state.suppressUntil) {
        // 刚被用户关掉：官方那边又冒出来了也不接管，也不藏，让它自己在那
        return;
      }
      hideOfficial(dlg);
      if (!state.open) {
        openOverlay('official', dlg);
        // 官方是从「没 Key 去上传/发送」这种入口打开的数据页，就直接落到 API Key 子页
        var active = dlg.querySelector('[role="tab"][aria-selected="true"]');
        var at = active ? (active.textContent || '').trim() : '';
        if (at.indexOf('数据管理') >= 0 || at.indexOf('Data') >= 0) {
          state.stack = ['apikey'];
          render();
        }
      }
      return;
    }
    state.official = null;
    if (state.open && state.mode === 'official') closeOverlay(true);
  }

  /* ---------------- 交互 ---------------- */

  function onAction(act, value, page) {
    var s = X.getSettings();

    if (act === 'close') return closeOverlay();
    if (act === 'back') return pop();
    if (act === 'nav') return push(page);

    if (act === 'toggle') {
      var patch = {};
      patch[value] = !s[value];
      X.saveSettings(patch);
      render();
      updatePill();
      return;
    }

    if (act === 'save-prompt') {
      var ta = document.getElementById('ds-system');
      X.saveSettings({ system: ta ? ta.value : s.system });
      return showToast('已保存', 'ok');
    }
    if (act === 'reset-prompt') {
      X.saveSettings({ system: X.defaults.system });
      return showToast('已恢复官方默认', 'ok');
    }

    if (act === 'mem-add') {
      var input = document.getElementById('ds-new-mem');
      var v = input ? input.value.trim() : '';
      if (!v) return;
      var items = s.items.slice();
      items.push({ id: 'm' + Math.random().toString(36).slice(2, 10), text: v, enabled: true, kind: 'fact' });
      X.saveSettings({ items: items });
      render();
      return showToast('已添加', 'ok');
    }
    if (act === 'mem-del') {
      var target = null;
      for (var i = 0; i < s.items.length; i++) if (s.items[i].id === value) target = s.items[i];
      if (target && target.kind === 'summary') {
        var okDel = true;
        try {
          okDel = confirm('删掉摘要后，更早的消息会重新发送给模型（可能变贵）。确定删除？');
        } catch (e) {}
        if (!okDel) return;
        X.saveSettings({
          items: s.items.filter(function (i) { return i.id !== value; }),
          compressedHashes: []
        });
        render();
        return showToast('已删除摘要，并清空压缩标记', 'ok');
      }
      X.saveSettings({ items: s.items.filter(function (i) { return i.id !== value; }) });
      render();
      return;
    }
    if (act === 'mem-toggle') {
      X.saveSettings({
        items: s.items.map(function (i) {
          return i.id === value ? { id: i.id, text: i.text, enabled: !i.enabled, kind: i.kind } : i;
        })
      });
      render();
      return;
    }
    if (act === 'mem-run') {
      return run('mem');
    }

    if (act === 'ctx-compress') return run('compress');
    if (act === 'ctx-reset') {
      X.resetCompression();
      return showToast('已清除压缩标记', 'ok');
    }

    if (act === 'model-save') {
      var mi = document.getElementById('ds-model');
      var mv = mi ? mi.value.trim() : '';
      X.saveSettings({ model: mv || X.defaults.model });
      render();
      return showToast('已切换到 ' + (mv || X.defaults.model), 'ok');
    }
    if (act === 'model-pick') {
      X.saveSettings({ model: value });
      render();
      return showToast('已切换到 ' + value, 'ok');
    }
    if (act === 'model-load') return run('models');
    if (act === 'safety') {
      X.saveSettings({ safety: value });
      render();
      return;
    }

    if (act === 'key-save') {
      var ki = document.getElementById('ds-key');
      var kv = ki ? ki.value.trim() : '';
      if (!kv) return showToast('请先填入 Key', 'err');
      state.busy = true;
      return X.verifyKey(kv)
        .then(function () {
          lsSet(LS.key, kv);
          state.busy = false;
          showToast('验证通过，已保存', 'ok');
          render();
          X.fetchBalance(true)
            .then(function () {
              if (state.open) render();
            })
            .catch(function () {});
          // 首次进来就是为了填 Key：存完直接回聊天，别把人留在这一页
          if (state.stack.length === 1) {
            setTimeout(function () {
              if (state.open && state.stack.length === 1) closeOverlay();
            }, 700);
          }
        })
        .catch(function (e) {
          state.busy = false;
          showToast(e && e.message ? e.message : '验证失败', 'err');
        });
    }
    if (act === 'key-clear') {
      lsSet(LS.key, '');
      render();
      return showToast('已清除', 'ok');
    }

    if (act === 'balance-refresh') {
      if (!X.getKey()) return showToast('先填 API Key', 'err');
      return run('balance');
    }
    if (act === 'topup') return openTopUp();

    if (act === 'avatar-pick') return pickAvatar();
    if (act === 'avatar-reset') {
      try { localStorage.removeItem('dshx:avatar'); } catch (e) {}
      if (window.__DSHV) window.__DSHV.refreshAvatar();
      render();
      return showToast('已恢复默认头像', 'ok');
    }
    if (act === 'voice-hands') {
      var cur = true;
      try { cur = localStorage.getItem('dshx:hands-free') !== '0'; } catch (e) {}
      try { localStorage.setItem('dshx:hands-free', cur ? '0' : '1'); } catch (e) {}
      if (window.__DSHV) window.__DSHV.state.handsFree = !cur;
      render();
      return;
    }
    if (act === 'call-start') {
      if (!window.__DSHV) return showToast('语音模块没加载', 'err');
      closeOverlay();
      setTimeout(function () {
        window.__DSHV.start();
      }, 80);
      return;
    }
    if (act === 'backup-export') return exportSettings();
    if (act === 'backup-import') return importSettings();

    if (act === 'official-data' || act === 'official-general') {
      var kind = act === 'official-data' ? 'data' : 'general';
      var dlg = findOfficial();
      if (dlg) {
        var tab0 = officialTab(dlg, kind);
        if (tab0) { try { tab0.click(); } catch (e) {} }
        hideOverlay();
        return;
      }
      // 官方弹窗还没出现：自己点一下官方的「设置」入口把它叫出来
      var entry = findSettingsEntry();
      if (!entry) return showToast('没找到官方设置入口', 'err');
      state.suppressUntil = Date.now() + 8000;
      state.allowOfficial = true;
      hideOverlay();
      try { entry.click(); } catch (e) {}
      setTimeout(function () {
        var d2 = findOfficial();
        if (!d2) return;
        var t2 = officialTab(d2, kind);
        if (t2) { try { t2.click(); } catch (e) {} }
      }, 400);
      return;
    }

    if (act === 'nav-css') {
      state.stack.push('custom-css');
      render();
      return;
    }
    if (act === 'nav-css-ai') {
      state.stack.push('custom-css-ai');
      render();
      return;
    }
    if (act === 'compress-set') {
      X.saveSettings({ compressAt: Number(value) || 100000 });
      render();
      return showToast('阈值已改为 ' + fmt(Number(value)), 'ok');
    }
    if (act === 'nav-compress-at') {
      state.stack.push('compress-at');
      render();
      return;
    }
    if (act === 'compress-save') {
      var ci = document.getElementById('ds-cat');
      var num = ci ? Number(ci.value) : 100000;
      if (!num || num < 8000) return showToast('至少 8,000', 'err');
      X.saveSettings({ compressAt: Math.min(128000, Math.round(num)) });
      return showToast('阈值已保存', 'ok');
    }
    if (act === 'css-save-ai') {
      var ta1 = document.getElementById('ds-css-ai');
      if (!ta1) return;
      X.setCustomCssAi(ta1.value);
      return showToast(ta1.value.trim() ? '样式已应用' : '样式已清空', 'ok');
    }
    if (act === 'css-save') {
      var ta0 = document.getElementById('ds-css');
      if (!ta0) return;
      X.setCustomCss(ta0.value);
      return showToast(ta0.value.trim() ? '样式已应用' : '样式已清空', 'ok');
    }
    if (act === 'css-clear') {
      X.setCustomCssAi('');
      X.setCustomCss('');
      render();
      return showToast('已清空自定义样式', 'ok');
    }
    if (act === 'opt-bubble') {
      X.setBubbleColor(value || '');
      render();
      return showToast('已更新气泡颜色', 'ok');
    }
    if (act === 'bg-pick') {
      pickBg();
      return;
    }
    if (act === 'bg-clear') {
      X.setChatBg('');
      render();
      return showToast('已移除背景图', 'ok');
    }
    if (act === 'opt-theme') {
      lsSet(LS.theme, value);
      return reload('主题');
    }
    if (act === 'opt-locale') {
      lsSet(LS.locale, value);
      return reload('语言');
    }
    if (act === 'opt-voice') {
      lsSet(LS.voice, value);
      return reload('朗读音色');
    }
  }

  function reload(what) {
    showToast(what + '已保存，正在刷新…', 'ok');
    setTimeout(function () {
      location.reload();
    }, 500);
  }

  // 充值：支付流程只能在官方页面完成，这里只做一键跳转
  function openTopUp() {
    var url = 'https://platform.deepseek.com/top_up';
    try {
      var a = document.createElement('a');
      a.href = url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (e) {
      location.href = url;
    }
  }

  function run(kind) {
    if (state.busy) return;
    state.busy = true;
    var p;
    if (kind === 'mem') p = X.memoryNow();
    else if (kind === 'compress') p = X.compressNow();
    else if (kind === 'balance')
      p = X.fetchBalance(true).then(function (b) {
        showToast('余额 ' + X.fmtMoney(b.total, b.currency), 'ok');
      });
    else p = X.fetchModels().then(function (ids) {
      state.models = ids;
      render();
      showToast(ids.length ? '拉取到 ' + ids.length + ' 个模型' : '没有可用模型', 'ok');
    });
    if (!p || !p.then) {
      state.busy = false;
      return;
    }
    p.then(function () {
      state.busy = false;
      if (kind !== 'models') render();
    }).catch(function (e) {
      state.busy = false;
      showToast(e && e.message ? e.message : String(e), 'err');
    });
  }

  function exportSettings() {
    var s = X.getSettings();
    var blob = new Blob([JSON.stringify(s, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'deepseek-enhance-settings.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
    showToast('已导出', 'ok');
  }

  function importSettings() {
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.style.display = 'none';
    document.body.appendChild(input);
    input.addEventListener('change', function () {
      var f = input.files && input.files[0];
      if (!f) return;
      var r = new FileReader();
      r.onload = function () {
        try {
          var o = JSON.parse(String(r.result));
          var keep = ['system', 'systemEnabled', 'memoryEnabled', 'items', 'autoMemory', 'autoCompress', 'compressedHashes', 'model', 'safety', 'showUsage'];
          var patch = {};
          for (var i = 0; i < keep.length; i++) {
            if (Object.prototype.hasOwnProperty.call(o, keep[i])) patch[keep[i]] = o[keep[i]];
          }
          X.saveSettings(patch);
          render();
          showToast('已导入', 'ok');
        } catch (e) {
          showToast('导入失败：不是有效的 JSON', 'err');
        }
      };
      r.readAsText(f);
    });
    input.click();
  }

  /* ---------------- 事件绑定 ---------------- */

  function closestAct(el) {
    while (el && el !== document.body) {
      if (el.getAttribute && el.getAttribute('data-act')) return el;
      el = el.parentNode;
    }
    return null;
  }

  function onClick(e) {
    var el = closestAct(e.target);
    if (!el) return;
    var act = el.getAttribute('data-act');
    if (act === 'mem-edit') return; // textarea 点击不处理
    e.preventDefault();
    onAction(act, el.getAttribute('data-value') || el.getAttribute('data-key'), el.getAttribute('data-page'));
  }

  function onInput(e) {
    var el = e.target;
    if (!el || !el.getAttribute) return;
    if (el.getAttribute('data-act') !== 'mem-edit') return;
    var id = el.getAttribute('data-value');
    var value = el.value;
    clearTimeout(onInput._t);
    onInput._t = setTimeout(function () {
      var s = X.getSettings();
      if (!value.trim()) {
        X.saveSettings({ items: s.items.filter(function (i) { return i.id !== id; }) });
        render();
        return;
      }
      X.saveSettings({
        items: s.items.map(function (i) {
          return i.id === id ? { id: i.id, text: value, enabled: i.enabled, kind: i.kind } : i;
        })
      });
    }, 500);
  }

  function onKey(e) {
    if (e.key === 'Escape' && state.open && !state.hidden) {
      e.stopPropagation();
      if (state.stack.length > 1) pop();
      else closeOverlay();
      return;
    }
    if (e.key === 'Enter' && e.target && e.target.id === 'ds-new-mem' && !e.isComposing) {
      e.preventDefault();
      var btn = document.querySelector('[data-act="mem-add"]');
      if (btn) btn.click();
    }
  }

  /* ---------------- 启动 ---------------- */

  function build() {
    if (document.getElementById('dshx-settings')) return;
    var el = document.createElement('div');
    el.id = 'dshx-settings';
    el.className = 'ds';
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML = '<div id="ds-pagehost" class="ds-host" role="dialog" aria-modal="true" aria-label="设置"></div>';
    document.body.appendChild(el);

    var toast = document.createElement('div');
    toast.id = 'dshx-toast';
    toast.className = 'ds-toast';
    toast.setAttribute('role', 'status');
    document.body.appendChild(toast);

    var pill = document.createElement('button');
    pill.id = 'dshx-usage';
    pill.className = 'ds-usage';
    pill.setAttribute('aria-label', '本轮用量');
    document.body.appendChild(pill);

    // 捕获阶段拦截官方「设置」入口：不弹官方的全屏设置，直接开我们的卡片
    document.addEventListener(
      'click',
      function (e) {
        if (state.allowOfficial) {
          state.allowOfficial = false;
          return;
        }
        if (state.open) return;
        var node = e.target;
        var hit = null;
        while (node && node !== document.body) {
          if (node.closest && node.closest('#dshx-settings')) return;
          var txt = (node.textContent || '').trim();
          if (txt === '设置' || txt === 'Settings') {
            hit = node;
            break;
          }
          node = node.parentElement;
        }
        if (!hit) return;
        e.preventDefault();
        e.stopPropagation();
        openOverlay('standalone', null);
      },
      true
    );

    el.addEventListener('click', onClick);
    el.addEventListener('input', onInput);
    // iOS 键盘会盖住输入框
    el.addEventListener('focusin', function (e) {
      var t = e.target;
      if (!t || !t.matches || !t.matches('input, textarea')) return;
      setTimeout(function () {
        try {
          t.scrollIntoView({ block: 'center', behavior: 'smooth' });
        } catch (err) {
          try { t.scrollIntoView(); } catch (e2) {}
        }
      }, 300);
    });
    pill.addEventListener('click', function () {
      openOverlay('standalone', null);
      state.stack = ['context'];
      render();
    });
    document.addEventListener('keydown', onKey, true);

    window.addEventListener('dshx:memory', function (e) {
      var ops = (e.detail && e.detail.ops) || [];
      state.lastMemAt = Date.now();
      state.lastMemOps = ops.length;
      var add = ops.filter(function (o) { return o.op === 'add'; }).length;
      var upd = ops.filter(function (o) { return o.op === 'update'; }).length;
      var del = ops.filter(function (o) { return o.op === 'delete'; }).length;
      var parts = [];
      if (add) parts.push('记住 ' + add + ' 条');
      if (upd) parts.push('更新 ' + upd + ' 条');
      if (del) parts.push('删除 ' + del + ' 条');
      showToast('记忆已更新：' + parts.join('、'), 'ok');
      if (state.open && state.stack[state.stack.length - 1] === 'memory') render();
    });

    window.addEventListener('dshx:compress', function (e) {
      var d = e.detail || {};
      showToast('已压缩 ' + (d.compressed || 0) + ' 条为摘要', 'ok');
      if (state.open) render();
    });

    window.addEventListener('dshx:usage', function () {
      updatePill();
      if (state.open && state.stack[state.stack.length - 1] === 'context') render();
    });

    window.addEventListener('dshx:balance', function () {
      if (state.open) render();
    });

    // 其它模块（语音等）借这里的轻提示
    window.addEventListener('dshx:toast', function (e) {
      var d = e.detail || {};
      if (d.text) showToast(d.text, d.kind);
    });

    var mo = new MutationObserver(function () {
      check();
    });
    mo.observe(document.body, { childList: true });

    syncTheme();
    check();
    updatePill();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
  else build();

  window.__DSHXS = {
    open: openOverlay,
    close: closeOverlay,
    go: function (page) {
      if (!state.open) openOverlay('standalone', null);
      state.stack = [page || 'root'];
      render();
    },
    state: state,
    version: VERSION
  };
})();
