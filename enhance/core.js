/*!
 * 增强层内核（core.js）
 * 职责：设置存储、请求钩子（system / model / safety / messages）、
 *       fetch 代理（捕获本轮用量与文本）、AI 自主记忆、上下文压缩。
 * 不含任何 UI，UI 在 settings.js。数据全部留在本机 localStorage。
 */
(function () {
  'use strict';

  var STORE = 'dshx:settings:v4';
  var STORE_V3 = 'dshx:settings:v3';
  var STORE_V1 = 'dshx:settings:v1';
  var API_BASE = 'https://api.deepseek.com';
  var API_KEY_STORE = 'chat-demo:api-key';
  var DEFAULT_SYSTEM = '该助手为DeepSeek，由深度求索公司创造。';
  var DEFAULT_MODEL = 'deepseek-flash';
  var MAX_ITEMS = 60;

  var origFetch = typeof window !== 'undefined' && window.fetch ? window.fetch.bind(window) : null;

  var DEFAULTS = {
    system: DEFAULT_SYSTEM,
    systemEnabled: true,
    memoryEnabled: true,
    items: [],
    autoMemory: true,
    autoCompress: true,
    compressedHashes: [],
    model: DEFAULT_MODEL,
    safety: 'standard',
    showUsage: true
  };

  /* ---------------- 基础工具 ---------------- */

  function clampInt(v, lo, hi, fallback) {
    var n = typeof v === 'number' ? v : parseInt(v, 10);
    if (!isFinite(n)) return fallback;
    n = Math.round(n);
    return n < lo ? lo : n > hi ? hi : n;
  }

  function safeGet(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }

  function safeSet(key, val) {
    try { localStorage.setItem(key, val); } catch (e) {}
  }

  function readRaw(key) {
    var t = safeGet(key);
    if (!t) return {};
    try {
      var o = JSON.parse(t);
      return o && typeof o === 'object' ? o : {};
    } catch (e) {
      return {};
    }
  }

  /* ---------------- 外观：聊天背景图 / 气泡颜色 ---------------- */

  var BG_KEY = 'dshx:chat-bg';
  var BUBBLE_KEY = 'dshx:bubble';

  function getChatBg() {
    return safeGet(BG_KEY) || '';
  }

  function setChatBg(v) {
    if (v) safeSet(BG_KEY, v);
    else safeRemove(BG_KEY);
    applyTheme();
  }

  function getBubbleColor() {
    return safeGet(BUBBLE_KEY) || '';
  }

  function setBubbleColor(v) {
    if (v) safeSet(BUBBLE_KEY, v);
    else safeRemove(BUBBLE_KEY);
    applyTheme();
  }

  function safeRemove(key) {
    try { localStorage.removeItem(key); } catch (e) {}
  }

  function applyTheme() {
    var root = document.documentElement;
    if (!root) return;
    var body = document.body;

    var bg = getChatBg();
    if (bg) {
      root.style.setProperty('--dshx-chat-bg', 'url("' + bg + '")');
      root.setAttribute('data-dshx-bg', '1');
    } else {
      root.style.removeProperty('--dshx-chat-bg');
      root.removeAttribute('data-dshx-bg');
    }

    // 官方把主题变量定义在 body 上，所以必须同时写 body，否则 html 上的值会被 body 覆盖
    var bub = getBubbleColor();
    var targets = [root, body];
    for (var i = 0; i < targets.length; i++) {
      var t = targets[i];
      if (!t || !t.style) continue;
      if (bub) t.style.setProperty('--dsw-specific-bubble', bub);
      else t.style.removeProperty('--dsw-specific-bubble');
    }
    if (bub) {
      root.style.setProperty('--dshx-bubble', bub);
      root.setAttribute('data-dshx-bubble', '1');
    } else {
      root.style.removeProperty('--dshx-bubble');
      root.removeAttribute('data-dshx-bubble');
    }
  }

  function normalizeItem(it) {
    if (!it || typeof it !== 'object') return null;
    var text = typeof it.text === 'string' ? it.text : '';
    if (!text.trim()) return null;
    return {
      id: typeof it.id === 'string' && it.id ? it.id : 'm' + Math.random().toString(36).slice(2, 10),
      text: text.trim(),
      enabled: it.enabled !== false,
      kind: it.kind === 'summary' ? 'summary' : 'fact'
    };
  }

  function getSettings() {
    var raw = readRaw(STORE);
    if (!Object.keys(raw).length) {
      // 迁移：v3（上一版）或 v1。旧版的 safety 默认是 high，
      // 用户明确要去掉这层额外风控，所以迁移时统一回落到 standard。
      var old = readRaw(STORE_V3);
      if (!Object.keys(old).length) old = readRaw(STORE_V1);
      if (Object.keys(old).length) {
        raw = {
          system: old.system,
          systemEnabled: old.systemEnabled,
          memoryEnabled: old.memoryEnabled,
          items: old.items,
          autoMemory: true,
          autoCompress: true,
          compressedHashes: old.compressedHashes,
          model: old.model,
          safety: 'standard',
          showUsage: true
        };
      }
    }
    var s = {};
    for (var k in DEFAULTS) {
      if (!Object.prototype.hasOwnProperty.call(DEFAULTS, k)) continue;
      s[k] = Object.prototype.hasOwnProperty.call(raw, k) ? raw[k] : DEFAULTS[k];
    }
    if (typeof s.system !== 'string') s.system = DEFAULT_SYSTEM;
    if (typeof s.model !== 'string' || !s.model.trim()) s.model = DEFAULT_MODEL;
    if (s.safety !== 'standard' && s.safety !== 'high') s.safety = 'standard';
    s.systemEnabled = s.systemEnabled !== false;
    s.memoryEnabled = s.memoryEnabled !== false;
    s.autoMemory = s.autoMemory !== false;
    s.autoCompress = s.autoCompress !== false;
    s.showUsage = s.showUsage !== false;
    s.items = Array.isArray(s.items) ? s.items.map(normalizeItem).filter(Boolean) : [];
    s.compressedHashes = Array.isArray(s.compressedHashes) ? s.compressedHashes.filter(function (h) { return typeof h === 'string'; }) : [];
    if (s.compressedHashes.length > 800) s.compressedHashes = s.compressedHashes.slice(-800);
    return s;
  }

  function saveSettings(patch) {
    var s = getSettings();
    if (patch && typeof patch === 'object') {
      for (var k in patch) if (Object.prototype.hasOwnProperty.call(patch, k)) s[k] = patch[k];
    }
    safeSet(STORE, JSON.stringify(s));
    return s;
  }

  /* ---------------- 文本与哈希 ---------------- */

  function textOf(msg) {
    if (!msg) return '';
    var c = msg.content;
    if (typeof c === 'string') return c;
    if (Array.isArray(c)) {
      var out = [];
      for (var i = 0; i < c.length; i++) {
        var b = c[i];
        if (b && typeof b.text === 'string' && b.text) out.push(b.text);
      }
      return out.join('\n');
    }
    return '';
  }

  function hashOf(msg) {
    var str = (msg && msg.role ? msg.role : '?') + '|' + textOf(msg);
    var h = 5381;
    for (var i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
    return 'h' + h.toString(36) + str.length.toString(36);
  }

  function sizeOf(msg) {
    try {
      var c = msg && msg.content;
      if (typeof c === 'string') return c.length;
      if (Array.isArray(c)) {
        var n = 0;
        for (var i = 0; i < c.length; i++) {
          var b = c[i];
          if (!b || typeof b !== 'object') continue;
          if (typeof b.text === 'string') n += b.text.length;
          else if (b.type === 'image' || b.type === 'document') n += 600;
          else n += JSON.stringify(b).length;
        }
        return n;
      }
      return JSON.stringify(msg || '').length;
    } catch (e) {
      return 200;
    }
  }

  function estTokens(chars) {
    return Math.ceil(chars / 1.5);
  }

  /* ---------------- 请求钩子 ---------------- */

  function memoryBlock(s) {
    var facts = [];
    var summaries = [];
    for (var i = 0; i < s.items.length; i++) {
      var it = s.items[i];
      if (!it.enabled || !it.text.trim()) continue;
      if (it.kind === 'summary') summaries.push(it.text.trim());
      else facts.push(it.text.trim());
    }
    var parts = [];
    if (facts.length) parts.push('【长期记忆】\n' + facts.map(function (t) { return '- ' + t; }).join('\n'));
    if (summaries.length) parts.push('【上下文摘要】\n' + summaries.join('\n\n'));
    return parts.join('\n\n');
  }

  function sys() {
    try {
      var s = getSettings();
      var base = s.systemEnabled ? String(s.system || '').trim() : '';
      var mem = s.memoryEnabled ? memoryBlock(s) : '';
      var out;
      if (base.indexOf('{{memory}}') >= 0) out = base.replace(/\{\{memory\}\}/g, mem).trim();
      else out = !mem ? base : (base ? base + '\n\n' : '') + mem;
      return out || DEFAULT_SYSTEM;
    } catch (e) {
      return DEFAULT_SYSTEM;
    }
  }

  function model() {
    try {
      var m = getSettings().model;
      return m && m.trim() ? m.trim() : DEFAULT_MODEL;
    } catch (e) {
      return DEFAULT_MODEL;
    }
  }

  function safety() {
    try {
      // standard：整个 safety_check 字段都不提交（等于官方默认检查）；
      // high：显式要求平台加一层风险审核。
      return getSettings().safety === 'high' ? { level: 'high' } : undefined;
    } catch (e) {
      return undefined;
    }
  }

  function ctx(msgs) {
    var full = Array.isArray(msgs) ? msgs : [];
    try {
      var s = getSettings();
      var out = full;
      if (s.compressedHashes.length) {
        var skip = {};
        for (var i = 0; i < s.compressedHashes.length; i++) skip[s.compressedHashes[i]] = true;
        var kept = [];
        for (var j = 0; j < full.length; j++) {
          // 永远保留最后两条，避免把当前这一轮也压掉
          if (j >= full.length - 2 || !skip[hashOf(full[j])]) kept.push(full[j]);
        }
        out = kept;
      }
      // 首条不能是 assistant
      while (out.length > 1 && out[0] && out[0].role === 'assistant') out = out.slice(1);
      // 悬空的 latest_reminder 去掉
      while (out.length > 1 && out[0] && out[0].role === 'latest_reminder' && out[1] && out[1].role !== 'user') {
        out = out.slice(1);
      }
      var chars = 0;
      for (var k = 0; k < out.length; k++) chars += sizeOf(out[k]);
      api.lastCtx = {
        at: Date.now(),
        total: full.length,
        kept: out.length,
        dropped: full.length - out.length,
        chars: chars,
        tokens: estTokens(chars),
        snapshot: full
      };
      return out;
    } catch (e) {
      return full;
    }
  }

  /* ---------------- 官方接口调用 ---------------- */

  function getKey() {
    return (safeGet(API_KEY_STORE) || '').trim();
  }

  function parseError(res, data, raw) {
    if (data && data.error && data.error.message) return data.error.message;
    return raw || 'HTTP ' + res.status;
  }

  async function callAPI(opts) {
    var key = getKey();
    if (!key) throw new Error('还没有填写 API Key');
    if (!origFetch) throw new Error('当前环境不支持 fetch');
    var res;
    try {
      res = await origFetch(API_BASE + '/anthropic/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': key,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: opts.model || model(),
          max_tokens: opts.maxTokens || 800,
          system: opts.system || '',
          messages: opts.messages,
          safety_check: safety()
        })
      });
    } catch (e) {
      throw new Error('网络异常：' + e.message);
    }
    var raw = '';
    var data = null;
    try {
      raw = await res.text();
      data = JSON.parse(raw);
    } catch (e) {}
    if (!res.ok) throw new Error(parseError(res, data, raw));
    var blocks = (data && data.content) || [];
    var out = [];
    for (var i = 0; i < blocks.length; i++) {
      if (blocks[i] && blocks[i].type === 'text' && typeof blocks[i].text === 'string') out.push(blocks[i].text);
    }
    return out.join('\n').trim();
  }

  async function fetchModels() {
    var key = getKey();
    if (!key) throw new Error('还没有填写 API Key');
    var res = await origFetch(API_BASE + '/models', { headers: { authorization: 'Bearer ' + key } });
    var raw = '';
    var data = null;
    try {
      raw = await res.text();
      data = JSON.parse(raw);
    } catch (e) {}
    if (!res.ok) throw new Error(parseError(res, data, raw));
    var arr = (data && data.data) || [];
    var ids = [];
    for (var i = 0; i < arr.length; i++) {
      var id = arr[i] && (arr[i].id || arr[i].name);
      if (id && ids.indexOf(id) < 0) ids.push(id);
    }
    return ids;
  }

  async function verifyKey(key) {
    var res = await origFetch(API_BASE + '/models', { headers: { authorization: 'Bearer ' + key } });
    if (!res.ok) {
      var raw = '';
      var data = null;
      try {
        raw = await res.text();
        data = JSON.parse(raw);
      } catch (e) {}
      throw new Error(parseError(res, data, raw));
    }
    return true;
  }

  /* ---------------- 账户余额 ---------------- */

  var balanceCache = null;

  function fmtMoney(v, cur) {
    var sym = cur === 'USD' ? '$' : '¥';
    var n = parseFloat(v);
    if (!isFinite(n)) n = 0;
    return sym + n.toFixed(2);
  }

  async function fetchBalance(force) {
    var key = getKey();
    if (!key) throw new Error('还没有填写 API Key');
    if (!origFetch) throw new Error('当前环境不支持 fetch');
    if (!force && balanceCache && Date.now() - balanceCache.at < 60000) return balanceCache;
    var res = await origFetch(API_BASE + '/user/balance', { headers: { authorization: 'Bearer ' + key } });
    var raw = '';
    var data = null;
    try {
      raw = await res.text();
      data = JSON.parse(raw);
    } catch (e) {}
    if (!res.ok) throw new Error(parseError(res, data, raw));
    var infos = data && Array.isArray(data.balance_infos) ? data.balance_infos : [];
    var pick = null;
    for (var i = 0; i < infos.length; i++) {
      if (infos[i] && infos[i].currency === 'CNY') pick = infos[i];
    }
    if (!pick && infos.length) pick = infos[0];
    var out = {
      at: Date.now(),
      available: !!(data && data.is_available),
      currency: pick && pick.currency ? pick.currency : 'CNY',
      total: pick ? String(pick.total_balance) : '0',
      granted: pick ? String(pick.granted_balance) : '0',
      toppedUp: pick ? String(pick.topped_up_balance) : '0'
    };
    balanceCache = out;
    api.lastBalance = out;
    window.dispatchEvent(new CustomEvent('dshx:balance', { detail: out }));
    return out;
  }

  /* ---------------- 对话内容读取 ---------------- */

  function transcriptFrom(list, cap) {
    var lines = [];
    for (var i = 0; i < list.length; i++) {
      var m = list[i];
      if (!m || (m.role !== 'user' && m.role !== 'assistant')) continue;
      var t = textOf(m).trim();
      if (!t) continue;
      if (t.length > 2000) t = t.slice(0, 2000) + '…';
      lines.push((m.role === 'user' ? '用户：' : '助手：') + t);
    }
    var text = lines.join('\n');
    var limit = cap || 16000;
    if (text.length > limit) text = '…' + text.slice(text.length - limit);
    return text;
  }

  function lastSnapshot() {
    return (api.lastCtx && Array.isArray(api.lastCtx.snapshot) && api.lastCtx.snapshot) || [];
  }

  function transcript(cap) {
    return transcriptFrom(lastSnapshot(), cap);
  }

  /* ---------------- AI 自主记忆 ---------------- */

  var MEM_SYSTEM =
    '你是记忆管理器，只负责维护一份长期记忆清单。\n' +
    '规则：\n' +
    '1. 只记录长期稳定有用的信息：身份、称呼、偏好、习惯、长期目标、项目背景、技术选型、明确约定。\n' +
    '2. 不记录：一次性任务、临时情绪、闲聊细节、可以从对话直接看到且今后无用的内容、密码/证件号等敏感信息。\n' +
    '3. 清单上限 40 条。新增前先检查是否已有等价条目；有就 update，不要重复 add。\n' +
    '4. 旧条目过时或与新信息冲突时，update 覆盖或 delete。\n' +
    '5. 没有值得变更的内容就返回空数组。\n' +
    '只输出 JSON，格式：{"ops":[{"op":"add","text":"…"},{"op":"update","id":"m_xxx","text":"…"},{"op":"delete","id":"m_xxx"}]}\n' +
    '不要输出 JSON 以外的任何文字。';

  function parseOps(text) {
    var t = String(text || '').trim();
    var a = t.indexOf('{');
    var b = t.lastIndexOf('}');
    if (a < 0 || b <= a) return [];
    var obj;
    try {
      obj = JSON.parse(t.slice(a, b + 1));
    } catch (e) {
      return [];
    }
    var arr = obj && Array.isArray(obj.ops) ? obj.ops : [];
    var out = [];
    for (var i = 0; i < arr.length; i++) {
      var o = arr[i];
      if (!o || typeof o !== 'object') continue;
      var op = String(o.op || '').toLowerCase();
      if (op !== 'add' && op !== 'update' && op !== 'delete') continue;
      var text = typeof o.text === 'string' ? o.text.trim() : '';
      if (op !== 'delete' && !text) continue;
      out.push({ op: op, id: typeof o.id === 'string' ? o.id : '', text: text });
    }
    return out.slice(0, 12);
  }

  function applyOps(ops) {
    var s = getSettings();
    var items = s.items.slice();
    var done = [];
    for (var i = 0; i < ops.length; i++) {
      var o = ops[i];
      if (o.op === 'add') {
        if (items.length >= MAX_ITEMS) {
          // 满了先删最早的一条 fact
          for (var k = 0; k < items.length; k++) {
            if (items[k].kind !== 'summary') {
              items.splice(k, 1);
              break;
            }
          }
        }
        items.push({ id: 'm' + Math.random().toString(36).slice(2, 10), text: o.text, enabled: true, kind: 'fact' });
        done.push({ op: 'add', text: o.text });
      } else if (o.op === 'update' && o.id) {
        var hit = false;
        items = items.map(function (it) {
          if (it.id !== o.id) return it;
          hit = true;
          return normalizeItem({ id: it.id, text: o.text, enabled: it.enabled, kind: it.kind });
        }).filter(Boolean);
        if (hit) done.push({ op: 'update', text: o.text });
      } else if (o.op === 'delete' && o.id) {
        var before = items.length;
        items = items.filter(function (it) { return it.id !== o.id; });
        if (items.length < before) done.push({ op: 'delete', id: o.id });
      }
    }
    if (done.length) saveSettings({ items: items });
    return done;
  }

  function listForAgent(s) {
    var lines = [];
    for (var i = 0; i < s.items.length; i++) {
      var it = s.items[i];
      if (it.kind === 'summary' || !it.enabled) continue;
      lines.push(it.id + ' | ' + it.text);
    }
    return lines.join('\n') || '（空）';
  }

  var memBusy = false;

  async function memoryNow(opts) {
    if (memBusy) return { skipped: true };
    var s = getSettings();
    if (!getKey()) throw new Error('还没有填写 API Key');
    var snap = lastSnapshot();
    var convo = [];
    for (var i = 0; i < snap.length; i++) {
      if (snap[i] && (snap[i].role === 'user' || snap[i].role === 'assistant')) convo.push(snap[i]);
    }
    var tail = convo.slice(-6);
    if (!tail.length) throw new Error('还没有可整理的对话，先聊一句');
    var body = transcriptFrom(tail, 8000);
    if (!body.trim()) throw new Error('还没有可整理的对话');
    memBusy = true;
    try {
      var text = await callAPI({
        maxTokens: 400,
        system: MEM_SYSTEM,
        messages: [
          {
            role: 'user',
            content: '当前记忆清单（id | 内容）：\n' + listForAgent(s) + '\n\n最近对话：\n' + body
          }
        ]
      });
      var ops = parseOps(text);
      var done = applyOps(ops);
      if (done.length) window.dispatchEvent(new CustomEvent('dshx:memory', { detail: { ops: done } }));
      return { ops: done, applies: done.length };
    } finally {
      memBusy = false;
    }
  }

  /* ---------------- 上下文压缩 ---------------- */

  var COMPRESS_SYSTEM =
    '你是上下文压缩器。把给定对话压缩成 300 字以内的中文摘要，保留：用户的目标与偏好、已确认的事实与决定、' +
    '待办与未完成事项、关键结论和技术细节要点。不要寒暄，不要输出摘要之外的话。';

  var compressBusy = false;

  async function compressNow(opts) {
    if (compressBusy) throw new Error('正在压缩，请稍后');
    var s = getSettings();
    if (!getKey()) throw new Error('还没有填写 API Key');
    var snap = lastSnapshot();
    var convo = [];
    for (var i = 0; i < snap.length; i++) {
      if (snap[i] && (snap[i].role === 'user' || snap[i].role === 'assistant')) convo.push(snap[i]);
    }
    var keepRecent = (opts && opts.keepRecent) || 6;
    if (convo.length <= keepRecent + 2) throw new Error('对话还太短，暂时不用压缩');
    var old = convo.slice(0, convo.length - keepRecent);
    var body = transcriptFrom(old, 24000);
    if (!body.trim()) throw new Error('没有可压缩的内容');

    compressBusy = true;
    try {
      var text = await callAPI({ maxTokens: 900, system: COMPRESS_SYSTEM, messages: [{ role: 'user', content: body }] });
      if (!text) throw new Error('模型没有返回摘要');

      var items = s.items.filter(function (it) { return it.kind !== 'summary'; });
      items.unshift({ id: 's' + Math.random().toString(36).slice(2, 10), text: text, enabled: true, kind: 'summary' });

      var hashes = s.compressedHashes.slice();
      for (var j = 0; j < old.length; j++) hashes.push(hashOf(old[j]));
      saveSettings({ items: items, compressedHashes: hashes });
      window.dispatchEvent(new CustomEvent('dshx:compress', { detail: { chars: text.length, compressed: old.length } }));
      return { chars: text.length, compressed: old.length, summary: text };
    } finally {
      compressBusy = false;
    }
  }

  function resetCompression() {
    saveSettings({ compressedHashes: [] });
  }

  /* ---------------- 用量记录 ---------------- */

  var usageLog = [];

  function recordUsage(u) {
    var rec = {
      at: Date.now(),
      input: u.input || 0,
      output: u.output || 0,
      cacheRead: u.cacheRead || 0,
      cacheWrite: u.cacheWrite || 0,
      total: (u.input || 0) + (u.output || 0)
    };
    usageLog.push(rec);
    if (usageLog.length > 50) usageLog.shift();
    api.lastUsage = rec;
    window.dispatchEvent(new CustomEvent('dshx:usage', { detail: rec }));
    return rec;
  }

  function getUsageLog() {
    return usageLog.slice();
  }

  /* ---------------- fetch 代理 ---------------- */

  var decoder = null;

  function newDecoder() {
    try {
      return new TextDecoder('utf-8');
    } catch (e) {
      return null;
    }
  }
  function handleEvent(name, dataStr, acc) {
    var obj;
    try {
      obj = JSON.parse(dataStr);
    } catch (e) {
      return;
    }
    if (name === 'message_start' && obj.message) {
      var u = obj.message.usage || {};
      acc.usage.input = u.input_tokens || 0;
      acc.usage.cacheRead = u.cache_read_input_tokens || 0;
      acc.usage.cacheWrite = u.cache_creation_input_tokens || 0;
      acc.usage.output = u.output_tokens || 0;
    } else if (name === 'content_block_delta' && obj.delta) {
      if (obj.delta.type === 'text_delta' && obj.delta.text) acc.text += obj.delta.text;
    } else if (name === 'message_delta') {
      var u2 = (obj.usage || {});
      if (typeof u2.output_tokens === 'number') acc.usage.output = u2.output_tokens;
      if (typeof u2.input_tokens === 'number' && u2.input_tokens) acc.usage.input = u2.input_tokens;
      if (typeof u2.cache_read_input_tokens === 'number') acc.usage.cacheRead = u2.cache_read_input_tokens;
      if (u2.cache_creation_input_tokens) acc.usage.cacheWrite = u2.cache_creation_input_tokens;
      acc.stopReason = obj.delta && obj.delta.stop_reason ? obj.delta.stop_reason : acc.stopReason;
      acc.finished = true;
    } else if (name === 'message_stop') {
      acc.finished = true;
    } else if (name === 'error') {
      acc.error = true;
    }
  }

  function makeSSEParser(acc) {
    var buf = '';
    var dec = newDecoder();
    return function (chunk) {
      var text = dec ? dec.decode(chunk, { stream: true }) : '';
      buf += text;
      var idx;
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        var raw = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        var evName = '';
        var dataLines = [];
        var lines = raw.split('\n');
        for (var i = 0; i < lines.length; i++) {
          var line = lines[i];
          if (line.indexOf('event:') === 0) evName = line.slice(6).trim();
          else if (line.indexOf('data:') === 0) dataLines.push(line.slice(5).trim());
        }
        if (!dataLines.length) continue;
        handleEvent(evName || 'message', dataLines.join('\n'), acc);
      }
    };
  }

  function wrapBody(realBody, acc) {
    if (!realBody || typeof realBody.getReader !== 'function') return realBody;
    var reader = realBody.getReader();
    var feed = makeSSEParser(acc);
    var done = false;
    function finish() {
      if (done) return;
      done = true;
      try {
        onStreamEnd(acc);
      } catch (e) {}
    }
    return {
      getReader: function () {
        return {
          read: function () {
            return reader.read().then(function (r) {
              if (r.done) {
                finish();
                return r;
              }
              try {
                feed(r.value);
              } catch (e) {}
              return r;
            }, function (err) {
              finish();
              throw err;
            });
          },
          cancel: function (reason) {
            finish();
            return reader.cancel(reason);
          },
          releaseLock: function () {
            return reader.releaseLock();
          }
        };
      }
    };
  }

  function onStreamEnd(acc) {
    if (!acc.finished) return;
    if (!acc.usage.input && !acc.usage.output && !acc.text) return;
    recordUsage(acc.usage);
    var payload = {
      usage: acc.usage,
      text: acc.text,
      stopReason: acc.stopReason,
      at: Date.now()
    };
    api.lastTurn = payload;
    window.dispatchEvent(new CustomEvent('dshx:turn', { detail: payload }));

    var s = getSettings();
    // 后台：AI 自主记忆
    if (s.autoMemory && s.memoryEnabled && getKey()) {
      var userText = '';
      var snap = lastSnapshot();
      for (var i = snap.length - 1; i >= 0; i--) {
        if (snap[i] && snap[i].role === 'user') {
          userText = textOf(snap[i]);
          break;
        }
      }
      if ((userText + acc.text).length > 12) {
        setTimeout(function () {
          memoryNow().catch(function () {});
        }, 400);
      }
    }
    // 后台：长对话自动压缩
    if (s.autoCompress) {
      var sent = api.lastCtx ? api.lastCtx.kept : 0;
      var tokens = api.lastCtx ? api.lastCtx.tokens : 0;
      if (sent >= 40 || tokens >= 45000) {
        setTimeout(function () {
          compressNow().catch(function () {});
        }, 800);
      }
    }
  }

  function isMessagesRequest(url, init) {
    if (!init || String(init.method || '').toUpperCase() !== 'POST') return false;
    var u = typeof url === 'string' ? url : url && url.url ? url.url : '';
    return u.indexOf('/anthropic/v1/messages') >= 0;
  }

  var proxyInstalled = false;

  function installFetchProxy() {
    if (proxyInstalled || !origFetch) return;
    proxyInstalled = true;
    window.fetch = function (input, init) {
      var p = origFetch(input, init);
      if (!isMessagesRequest(input, init)) return p;
      return p.then(function (res) {
        var acc = { usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, text: '', stopReason: '', finished: false };
        var body = null;
        try {
          body = wrapBody(res.body, acc);
        } catch (e) {
          body = res.body;
        }
        return {
          ok: res.ok,
          status: res.status,
          statusText: res.statusText,
          headers: res.headers,
          body: body,
          url: res.url,
          text: function () { return res.text(); },
          json: function () { return res.json(); },
          clone: function () { return res.clone(); }
        };
      });
    };
  }

  /* ---------------- 对外 API ---------------- */

  var api = {
    // 被 bundle 补丁调用的四个钩子
    sys: sys,
    ctx: ctx,
    model: model,
    safety: safety,
    // 外观
    getChatBg: getChatBg,
    setChatBg: setChatBg,
    getBubbleColor: getBubbleColor,
    setBubbleColor: setBubbleColor,
    applyTheme: applyTheme,
    // 状态
    lastCtx: null,
    lastTurn: null,
    lastUsage: null,
    // 数据
    getSettings: getSettings,
    saveSettings: saveSettings,
    defaults: DEFAULTS,
    // 动作
    memoryNow: memoryNow,
    compressNow: compressNow,
    resetCompression: resetCompression,
    fetchModels: fetchModels,
    verifyKey: verifyKey,
    fetchBalance: fetchBalance,
    fmtMoney: fmtMoney,
    lastBalance: null,
    getKey: getKey,
    getUsageLog: getUsageLog,
    transcript: transcript,
    hashOf: hashOf,
    // 测试用
    _parseOps: parseOps,
    _applyOps: applyOps,
    _recordUsage: recordUsage
  };

  window.__DSHXF = api;

  // 官方 bundle 之后会用到 fetch，必须现在装好
  installFetchProxy();

  if (typeof module === 'object' && module.exports) module.exports = api;
})();
