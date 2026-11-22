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
  var MODEL_OFF = 'deepseek-flash';
  var MAX_ITEMS = 60;

  var origFetch = typeof window !== 'undefined' && window.fetch ? window.fetch.bind(window) : null;

  var DEFAULTS = {
    system: DEFAULT_SYSTEM,
    systemEnabled: true,
    memoryEnabled: true,
    items: [],
    recallEnabled: true,
    recallTopK: 3,
    autoCompress: true,
    compressedHashes: [],
    compressAt: 100000,
    model: 'deepseek-flash',
    modelOff: 'deepseek-flash',
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

    try {
      applyCustomCss();
    } catch (e) {}
  }

  /* ---------------- 自定义 CSS ---------------- */

  var CSS_KEY = 'dshx:custom-css';
  var CSS_AI_KEY = 'dshx:custom-css-ai';

  function getCustomCss() {
    return safeGet(CSS_KEY) || '';
  }

  function setCustomCss(v) {
    if (v) safeSet(CSS_KEY, v);
    else safeRemove(CSS_KEY);
    applyCustomCss();
  }

  function getCustomCssAi() {
    return safeGet(CSS_AI_KEY) || '';
  }

  function setCustomCssAi(v) {
    if (v) safeSet(CSS_AI_KEY, v);
    else safeRemove(CSS_AI_KEY);
    applyCustomCss();
  }

  function applyCustomCss() {
    var list = [
      ['dshx-custom-css', getCustomCss()],
      ['dshx-custom-css-ai', getCustomCssAi()]
    ];
    for (var i = 0; i < list.length; i++) {
      var id = list[i][0];
      var css = list[i][1];
      var el = document.getElementById(id);
      if (!css) {
        if (el) el.remove();
        continue;
      }
      if (!el) {
        el = document.createElement('style');
        el.id = id;
        document.head.appendChild(el);
      }
      el.textContent = css;
    }
  }

  /* ---------------- 聊天记录（IndexedDB）导入导出 ---------------- */

  var IDB_NAME = 'chat-demo';
  var IDB_STORES = ['sessions', 'sessionSummaries', 'sessionsStaging'];

  function idbOpen() {
    return new Promise(function (res, rej) {
      var req = indexedDB.open(IDB_NAME);
      req.onsuccess = function () {
        res(req.result);
      };
      req.onerror = function () {
        rej(req.error || new Error('打不开本地数据库'));
      };
    });
  }

  function idbGetAll(db, name) {
    return new Promise(function (res, rej) {
      var tx = db.transaction(name, 'readonly');
      var req = tx.objectStore(name).getAll();
      req.onsuccess = function () {
        res(req.result || []);
      };
      req.onerror = function () {
        rej(req.error);
      };
    });
  }

  async function exportChats() {
    var db = await idbOpen();
    var out = { app: 'dchat', kind: 'chats', version: 1, at: new Date().toISOString(), stores: {} };
    for (var i = 0; i < IDB_STORES.length; i++) {
      var n = IDB_STORES[i];
      if (!db.objectStoreNames.contains(n)) continue;
      out.stores[n] = await idbGetAll(db, n);
    }
    db.close();
    return out;
  }

  async function importChats(obj) {
    if (!obj || obj.kind !== 'chats' || !obj.stores) throw new Error('文件格式不对');
    var db = await idbOpen();
    for (var i = 0; i < IDB_STORES.length; i++) {
      var n = IDB_STORES[i];
      var rows = obj.stores[n];
      if (!rows || !rows.length) continue;
      if (!db.objectStoreNames.contains(n)) continue;
      await new Promise(function (res, rej) {
        var tx = db.transaction(n, 'readwrite');
        var st = tx.objectStore(n);
        for (var k = 0; k < rows.length; k++) {
          try {
            st.put(rows[k]);
          } catch (e) {}
        }
        tx.oncomplete = res;
        tx.onerror = function () {
          rej(tx.error);
        };
      });
    }
    db.close();
    return true;
  }

  function clearChats() {
    return new Promise(function (res, rej) {
      var req = indexedDB.deleteDatabase(IDB_NAME);
      req.onsuccess = function () {
        res(true);
      };
      req.onerror = function () {
        rej(req.error);
      };
      req.onblocked = function () {
        res(false);
      };
    });
  }

  /** 一次性清理：下线的「自动总结记忆」留下的 summary 条目，压缩摘要保留 */
  function dropOldSummaries() {
    if (safeGet('dshx:drop-old-summary') === '1') return;
    safeSet('dshx:drop-old-summary', '1');
    try {
      var s = getSettings();
      var kept = s.items.filter(function (it) {
        return it.kind !== 'summary' || it.compress === true;
      });
      if (kept.length !== s.items.length) saveSettings({ items: kept });
    } catch (e) {}
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
    compressAt: typeof old.compressAt === 'number' ? old.compressAt : 100000,
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
    s.modelOff = MODEL_OFF; // 关闭思考固定用 flash，不允许改
    if (s.safety !== 'standard' && s.safety !== 'high') s.safety = 'standard';
    s.systemEnabled = s.systemEnabled !== false;
    s.memoryEnabled = s.memoryEnabled !== false;
    s.recallEnabled = s.recallEnabled !== false;
    s.recallTopK = Math.min(3, Math.max(1, Number(s.recallTopK) || 3));
    s.autoCompress = s.autoCompress !== false;
    s.showUsage = s.showUsage !== false;
    s.items = Array.isArray(s.items) ? s.items.map(normalizeItem).filter(Boolean) : [];
    s.compressedHashes = Array.isArray(s.compressedHashes) ? s.compressedHashes.filter(function (h) { return typeof h === 'string'; }) : [];
    s.compressAt = Math.min(128000, Math.max(8000, Number(s.compressAt) || 100000));
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
    // 中文大致 1 字 1 token，英文/代码约 4 字 1 token，混合取 0.85 保守估
    return Math.ceil(chars * 0.85);
  }

  /* ---------------- 请求钩子 ---------------- */

  function memoryBlock(s) {
    var facts = [];
    var summaries = [];
    for (var i = 0; i < s.items.length; i++) {
      var it = s.items[i];
      if (!it.enabled || !it.text.trim()) continue;
      if (it.kind === 'summary') summaries.push(it.text.trim());
      else facts.push({ id: it.id, text: it.text.trim() });
    }
    var parts = [];
    if (facts.length) parts.push('【长期记忆】\n' + facts.map(function (it) { return '- [' + it.id + '] ' + it.text; }).join('\n'));
    if (summaries.length) parts.push('【上下文摘要】\n' + summaries.join('\n\n'));
    return parts.join('\n\n');
  }

  /* ---------------- 历史回忆（关键词 + 向量） ---------------- */

  var VEC_DIM = 512;
  var recallIndex = { at: 0, rounds: [] };
  var RECALL_MIN_SCORE = 0.12;

  function recallTokens(text) {
    var t = String(text || '').toLowerCase();
    var out = [];
    var words = t.match(/[a-z0-9_]{2,}/g);
    if (words) {
      for (var i = 0; i < words.length; i++) out.push(words[i]);
    }
    var zh = t.replace(/[^\u4e00-\u9fa5]/g, '');
    for (var j = 0; j + 1 < zh.length; j++) out.push(zh.slice(j, j + 2));
    return out;
  }

  function hash32(str) {
    var h = 2166136261;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function recallVector(text) {
    var toks = recallTokens(text);
    var v = new Float32Array(VEC_DIM);
    for (var i = 0; i < toks.length; i++) {
      var h = hash32(toks[i]);
      var idx = h % VEC_DIM;
      v[idx] += (h >>> 31) & 1 ? -1 : 1;
    }
    var norm = 0;
    for (var k = 0; k < VEC_DIM; k++) norm += v[k] * v[k];
    norm = Math.sqrt(norm) || 1;
    for (var k2 = 0; k2 < VEC_DIM; k2++) v[k2] /= norm;
    return v;
  }

  function cosine(a, b) {
    var s = 0;
    for (var i = 0; i < VEC_DIM; i++) s += a[i] * b[i];
    return s;
  }

  function overlapScore(qTokens, rTokens) {
    if (!qTokens.length || !rTokens.length) return 0;
    var set = {};
    var i;
    for (i = 0; i < rTokens.length; i++) set[rTokens[i]] = 1;
    var hit = 0;
    var seen = {};
    for (i = 0; i < qTokens.length; i++) {
      var t = qTokens[i];
      if (seen[t]) continue;
      seen[t] = 1;
      if (set[t]) hit += 1;
    }
    return hit / Math.min(20, Object.keys(seen).length || 1);
  }

  function messageText(m) {
    if (!m) return '';
    if (m.role === 'user') return String(m.content || '');
    var out = [];
    var blocks = m.blocks || [];
    for (var i = 0; i < blocks.length; i++) {
      var b = blocks[i];
      if (b && b.type === 'text' && typeof b.text === 'string') out.push(b.text);
    }
    return out.join('\n');
  }

  /** 扫一遍 IndexedDB 里的全部会话，切成「一问一答」的轮次并建索引 */
  async function refreshRecall(force) {
    if (!force && Date.now() - recallIndex.at < 30000) return recallIndex.rounds.length;
    var db = await idbOpen();
    try {
      if (!db.objectStoreNames.contains('sessions')) return 0;
      var sessions = await idbGetAll(db, 'sessions');
      var rounds = [];
      for (var i = 0; i < sessions.length; i++) {
        var sess = sessions[i];
        var msgs = sess && Array.isArray(sess.messages) ? sess.messages : [];
        for (var j = 0; j < msgs.length; j++) {
          var m = msgs[j];
          if (!m || m.role !== 'user') continue;
          var uText = messageText(m).trim();
          var next = msgs[j + 1];
          var aText = next && next.role === 'assistant' ? messageText(next).trim() : '';
          if (!uText) continue;
          var full = (uText + '\n' + aText).slice(0, 1200);
          rounds.push({
            sid: sess.id,
            at: m.createdAt || 0,
            user: uText.slice(0, 400),
            answer: aText.slice(0, 400),
            text: full,
            vec: recallVector(full)
          });
          j += 1;
        }
      }
      recallIndex = { at: Date.now(), rounds: rounds };
      return rounds.length;
    } finally {
      try {
        db.close();
      } catch (e) {}
    }
  }

  /** 用当前提问去召回最相关的几轮（默认 3 轮） */
  function recallFor(queryText, topK) {
    var q = String(queryText || '').trim();
    if (!q || !recallIndex.rounds.length) return [];
    var k = Math.max(1, Math.min(3, Number(topK) || 3));
    var qv = recallVector(q);
    var qt = recallTokens(q);
    var scored = [];
    for (var i = 0; i < recallIndex.rounds.length; i++) {
      var r = recallIndex.rounds[i];
      if (!r.text) continue;
      var cos = cosine(qv, r.vec);
      var kw = overlapScore(qt, recallTokens(r.text));
      var score = cos * 0.6 + kw * 0.4;
      if (score < RECALL_MIN_SCORE) continue;
      scored.push({ score: score, round: r });
    }
    scored.sort(function (a, b) {
      return b.score - a.score;
    });
    return scored.slice(0, k).map(function (x) {
      return x.round;
    });
  }

  function recallNorm(v) {
    return String(v || '')
      .replace(/\s+/g, '')
      .toLowerCase();
  }

  function paramText(m) {
    if (!m) return '';
    if (typeof m.content === 'string') return m.content;
    if (!Array.isArray(m.content)) return '';
    var out = [];
    for (var i = 0; i < m.content.length; i++) {
      var b = m.content[i];
      if (b && b.type === 'text' && typeof b.text === 'string') out.push(b.text);
    }
    return out.join('\n');
  }

  function containsAny(haystacks, needle) {
    if (!needle) return false;
    for (var i = 0; i < haystacks.length; i++) {
      var h = haystacks[i];
      if (!h) continue;
      if (h.indexOf(needle) >= 0) return true;
      // 反向只在不至于过度匹配时才比较（太短的片段容易误杀）
      if (h.length >= 6 && needle.indexOf(h) >= 0) return true;
    }
    return false;
  }

  /** 已经在「本轮上下文」或「常驻记忆」里出现过的轮次不再注入 */
  function dedupeRecall(list, ctxMsgs, s) {
    if (!list || !list.length) return [];
    var ctxTexts = [];
    for (var i = 0; i < ctxMsgs.length; i++) {
      var t = recallNorm(paramText(ctxMsgs[i]));
      if (t) ctxTexts.push(t);
    }
    var memTexts = [];
    for (var j = 0; j < s.items.length; j++) {
      var it = s.items[j];
      if (!it || !it.enabled || it.kind === 'summary') continue;
      var mt = recallNorm(it.text);
      if (mt) memTexts.push(mt);
    }
    // 记忆里可能换了个说法，再按 bigram 重合度兜一层
    var memTokens = [];
    for (var x = 0; x < memTexts.length; x++) memTokens.push(recallTokens(memTexts[x]));

    var coveredByMemory = function (text) {
      var toks = recallTokens(text);
      if (!toks.length) return false;
      var uniq = {};
      for (var i2 = 0; i2 < toks.length; i2++) uniq[toks[i2]] = 1;
      var keys = Object.keys(uniq);
      if (!keys.length) return false;
      for (var m2 = 0; m2 < memTokens.length; m2++) {
        var set = {};
        var list2 = memTokens[m2];
        for (var j2 = 0; j2 < list2.length; j2++) set[list2[j2]] = 1;
        var hit = 0;
        for (var k2 = 0; k2 < keys.length; k2++) if (set[keys[k2]]) hit += 1;
        if (hit / keys.length >= 0.6) return true;
      }
      return false;
    };

    var out = [];
    for (var k = 0; k < list.length; k++) {
      var r = list[k];
      var u = recallNorm(r.user);
      if (!u || u.length < 6) continue;
      if (containsAny(ctxTexts, u)) continue;
      if (containsAny(memTexts, u)) continue;
      if (coveredByMemory(u)) continue;
      out.push(r);
    }
    return out;
  }

  function recallBlock(list) {
    if (!list || !list.length) return '';
    var lines = ['【相关回忆】（从你过去的聊天里检索到的片段，仅供参考）'];
    for (var i = 0; i < list.length; i++) {
      var r = list[i];
      var when = r.at ? new Date(r.at) : null;
      var stamp = when && !isNaN(when.getTime()) ? when.getMonth() + 1 + '/' + when.getDate() : '';
      lines.push(
        (stamp ? '(' + stamp + ') ' : '') + '用户：' + r.user + (r.answer ? '\n助手：' + r.answer : '')
      );
    }
    return lines.join('\n');
  }

  function sys() {
    try {
      var s = getSettings();
      var base = s.systemEnabled ? String(s.system || '').trim() : '';
      var mem = s.memoryEnabled ? memoryBlock(s) : '';
      var out;
      if (base.indexOf('{{memory}}') >= 0) out = base.replace(/\{\{memory\}\}/g, mem).trim();
      else out = !mem ? base : (base ? base + '\n\n' : '') + mem;
      var rec = s.recallEnabled ? recallBlock(api.lastRecall) : '';
      if (rec) out = (out ? out + '\n\n' : '') + rec;
      return out || DEFAULT_SYSTEM;
    } catch (e) {
      return DEFAULT_SYSTEM;
    }
  }

  /** 一次性迁移：早先默认写成 deepseek-v4-pro，统一回到 flash；pro 只在手动选择时使用 */
  function migrateModel() {
    if (safeGet('dshx:model-default-flash') === '1') return;
    safeSet('dshx:model-default-flash', '1');
    try {
      if (getSettings().model === 'deepseek-v4-pro') saveSettings({ model: DEFAULT_MODEL });
    } catch (e) {}
  }

  function model(thinkingOn) {
    try {
      var s = getSettings();
      // 官方 demo 固定用 deepseek-flash；深度思考关闭时如果用推理模型，服务端会无视 disabled 继续思考，
      // 所以关闭时统一走非思考模型。
      if (thinkingOn === false) return s.modelOff || MODEL_OFF;
      var m = s.model;
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
        // 压缩后只保留最近若干轮：从末尾往回找到最近一条 user 作为起点，
        // 保证序列以 user 开头、user/assistant 成对——逐条按哈希剔除会破坏交替，服务端直接 400，
        // 表现就是「压缩完 AI 不回复」。
        var keepRecent = 6;
        var start = Math.max(0, full.length - keepRecent);
        while (start > 0 && (!full[start] || full[start].role !== 'user')) start -= 1;
        var kept = full.slice(start);
        if (!kept.length) kept = full;
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
      try {
        var lastUser = '';
        for (var q = out.length - 1; q >= 0; q--) {
          if (out[q] && out[q].role === 'user') {
            lastUser = typeof out[q].content === 'string' ? out[q].content : '';
            break;
          }
        }
        var pool = s.recallEnabled && lastUser ? recallFor(lastUser, Math.max(6, s.recallTopK * 3)) : [];
        api.lastRecall = s.recallEnabled ? dedupeRecall(pool, out, s).slice(0, s.recallTopK) : [];
      } catch (e) {
        api.lastRecall = [];
      }
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
      items.unshift({ id: 's' + Math.random().toString(36).slice(2, 10), text: text, enabled: true, kind: 'summary', compress: true });

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
    // 每轮结束后在后台重建回忆索引（把这一轮也纳入）
    if (s.recallEnabled) {
      setTimeout(function () {
        refreshRecall(true).catch(function () {});
      }, 1500);
    }
    // 后台：上下文压缩
    // 后台：长对话自动压缩
    if (s.autoCompress) {
      // 优先用服务端返回的 input_tokens（真实计数）；没有才退回字符估算。
      // 之前只用估算，而 estTokens 按 chars/1.5 算，中文场景比真实值小很多，
      // 于是阈值 100k 永远到不了 —— 看起来就是「自动压缩没生效」。
      var lu = api.lastUsage || {};
      // 真实上下文大小 = 未缓存输入 + 缓存读取 + 缓存写入
      var realInput = (lu.input || 0) + (lu.cacheRead || 0) + (lu.cacheWrite || 0);
      var tokens = realInput || (api.lastCtx ? api.lastCtx.tokens : 0);
      api.lastCtxTokens = tokens;
      if (tokens >= (s.compressAt || 100000)) {
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
    // 被 bundle 补丁调用的请求钩子
    sys: sys,
    ctx: ctx,
    model: model,
    safety: safety,
    // 外观
    getCustomCss: getCustomCss,
    getCustomCssAi: getCustomCssAi,
    setCustomCssAi: setCustomCssAi,
    setCustomCss: setCustomCss,
    applyCustomCss: applyCustomCss,
    hookInstalled: function () { return proxyInstalled; },
    exportChats: exportChats,
    importChats: importChats,
    clearChats: clearChats,
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
    refreshRecall: refreshRecall,
    recallFor: recallFor,
    lastRecall: null,
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

  // 先把 fetch 钩子装好：这是记忆 / 用量 / 压缩的入口，不能受后面任何初始化代码影响
  installFetchProxy();

  // 外观初始化放最后，整段包住，出错也不影响上面
  try {
    try {
      migrateModel();
    } catch (e) {}
    if (typeof document !== 'undefined' && document.documentElement) {
      try {
        dropOldSummaries();
      } catch (e) {}
      setTimeout(function () {
        try {
          refreshRecall(true).catch(function () {});
        } catch (e) {}
      }, 2000);
      var dshxReapply = function () {
        try {
          applyTheme();
        } catch (e) {}
      };
      dshxReapply();
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', dshxReapply);
      document.addEventListener('visibilitychange', function () {
        try {
          if (!document.hidden) dshxReapply();
        } catch (e) {}
      });
      if (typeof window !== 'undefined') {
        window.addEventListener('load', dshxReapply);
        window.addEventListener('pageshow', dshxReapply);
        setTimeout(dshxReapply, 400);
        setTimeout(dshxReapply, 1500);
        setTimeout(dshxReapply, 4000);
      }
    }
  } catch (e) {}

  if (typeof module === 'object' && module.exports) module.exports = api;
})();
