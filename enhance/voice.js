/*!
 * 语音通话（voice.js）
 * 复刻官方 demo 的语音链路：16k 单声道 WAV 录音 → /v1/tools/asr 转写
 * → 把文字注入聊天输入框发送 → 拿回复 → /v1/tools/tts 拿 PCM 播放。
 * 若 ASR/TTS 接口不可用，自动降级到浏览器自带的语音识别 / speechSynthesis。
 * 依赖 core.js（设置、Key、dshx:turn 事件）。
 */
(function () {
  'use strict';

  var X = window.__DSHXF;
  if (!X) return;

  var BASE = 'https://api.deepseek.com';
  var ASR_URL = BASE + '/v1/tools/asr';
  var TTS_URL = BASE + '/v1/tools/tts';
  var TTS_RATE = 24000; // 与官方 demo 一致
  var REC_RATE = 16000;
  var MAX_REC_MS = 60000;

  // 由脚本自己的 URL 推导出站点根下的图标，避免子路径部署时 404
  var SCRIPT_SRC = (typeof document !== 'undefined' && document.currentScript && document.currentScript.src) || '';
  var ICON_URL = SCRIPT_SRC
    ? SCRIPT_SRC.replace(/\/enhance\/voice\.js.*$/, '/icons/icon-192.png')
    : 'icons/icon-192.png';

  var AVATAR_KEY = 'dshx:avatar';

  function avatarSrc() {
    try {
      var v = localStorage.getItem(AVATAR_KEY);
      if (v) return v;
    } catch (e) {}
    return ICON_URL;
  }

  // 图标文件缺失 / 加载失败时，退化成字母头像，不要显示裂图
  function applyAvatar() {
    var img = document.getElementById('dc-avatar-img');
    if (!img) return;
    var box = document.getElementById('dc-avatar');
    if (box) {
      var old = box.querySelector('.dc-avatar-letter');
      if (old) old.remove();
    }
    img.style.display = '';
    img.onerror = function () {
      img.style.display = 'none';
      if (!box || box.querySelector('.dc-avatar-letter')) return;
      var span = document.createElement('span');
      span.className = 'dc-avatar-letter';
      span.textContent = 'DS';
      box.appendChild(span);
    };
    img.src = avatarSrc();
  }

  var state = {
    phase: 'idle', // idle | listening | transcribing | thinking | speaking | error | ended
    handsFree: true,
    startedAt: 0,
    bubbles: [],
    timer: 0,
    err: '',
    apiAsr: true, // 运行时探测：接口 ASR 是否可用
    apiTts: true,
    pendingTurn: null,
    rec: null,
    vadTimer: 0,
    listenStartedAt: 0,
    speakCtx: null,
    speaking: null,
    silentSince: 0,
    ended: false,
    muted: false
  };

  try {
    state.handsFree = localStorage.getItem('dshx:hands-free') !== '0';
  } catch (e) {}

  /* ---------------- 纯函数：WAV 编码 ---------------- */

  function encodeWav(chunks, srcRate) {
    var total = 0;
    for (var i = 0; i < chunks.length; i++) total += chunks[i].length;

    var rate = srcRate || REC_RATE;
    if (rate !== REC_RATE && total > 0) {
      // 线性重采样到 16k，避免设备不支持指定采样率时录出来是慢放
      var merged = new Float32Array(total);
      var off0 = 0;
      for (var m = 0; m < chunks.length; m++) {
        merged.set(chunks[m], off0);
        off0 += chunks[m].length;
      }
      var ratio = rate / REC_RATE;
      var outLen = Math.floor(total / ratio);
      var res = new Float32Array(outLen);
      for (var o = 0; o < outLen; o++) {
        var pos = o * ratio;
        var i0 = Math.floor(pos);
        var i1 = Math.min(i0 + 1, total - 1);
        var frac = pos - i0;
        res[o] = merged[i0] * (1 - frac) + merged[i1] * frac;
      }
      chunks = [res];
      total = outLen;
    }
    var buf = new ArrayBuffer(44 + total * 2);
    var v = new DataView(buf);
    function str(off, s) {
      for (var k = 0; k < s.length; k++) v.setUint8(off + k, s.charCodeAt(k));
    }
    str(0, 'RIFF');
    v.setUint32(4, 36 + total * 2, true);
    str(8, 'WAVE');
    str(12, 'fmt ');
    v.setUint32(16, 16, true);
    v.setUint16(20, 1, true);
    v.setUint16(22, 1, true);
    v.setUint32(24, REC_RATE, true);
    v.setUint32(28, REC_RATE * 2, true);
    v.setUint16(32, 2, true);
    v.setUint16(34, 16, true);
    str(36, 'data');
    v.setUint32(40, total * 2, true);
    var off = 44;
    for (var c = 0; c < chunks.length; c++) {
      var ch = chunks[c];
      for (var j = 0; j < ch.length; j++) {
        var s = ch[j];
        if (s > 1) s = 1;
        else if (s < -1) s = -1;
        v.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
        off += 2;
      }
    }
    return new Blob([buf], { type: 'audio/wav' });
  }

  /* ---------------- 录音 ---------------- */

  // 麦克风与 AudioContext 只建一次：iOS 上每次 getUserMedia 都可能再弹权限，
  // 一通电话里反复调用就是"一直弹授权"的根源。
  var mic = { stream: null, ctx: null, released: true };

  function micLive() {
    try {
      return !!(
        mic.stream &&
        mic.stream.getAudioTracks &&
        mic.stream.getAudioTracks().some(function (t) {
          return t.readyState === 'live';
        })
      );
    } catch (e) {
      return false;
    }
  }

  async function ensureMic() {
    if (micLive()) return mic.stream;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('这个浏览器不支持麦克风');
    }
    mic.stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }
    });
    mic.released = false;
    try {
      mic.stream.getAudioTracks().forEach(function (t) {
        t.addEventListener('ended', function () {
          mic.stream = null;
        });
      });
    } catch (e) {}
    return mic.stream;
  }

  function ensureCtx() {
    if (mic.ctx && mic.ctx.state !== 'closed') return mic.ctx;
    var Ctx = window.AudioContext || window.webkitAudioContext;
    try {
      mic.ctx = new Ctx({ sampleRate: REC_RATE });
    } catch (e) {
      mic.ctx = new Ctx(); // Safari 不支持指定采样率时退回设备默认，编码时再重采样
    }
    return mic.ctx;
  }

  // 挂断/切后台时彻底释放，避免一直占着麦克风
  function releaseMic() {
    try {
      if (mic.stream) mic.stream.getTracks().forEach(function (t) { t.stop(); });
    } catch (e) {}
    mic.stream = null;
    try {
      if (mic.ctx && mic.ctx.state !== 'closed') mic.ctx.close();
    } catch (e) {}
    mic.ctx = null;
    mic.released = true;
  }

  function micState() {
    if (micLive()) return 'live';
    return mic.released ? 'released' : 'probably-denied';
  }

  var Rec = {
    async start() {
      var stream = await ensureMic();
      var ctx = ensureCtx();
      if (ctx.state === 'suspended') await ctx.resume();

      var source = ctx.createMediaStreamSource(stream);
      var proc = ctx.createScriptProcessor(4096, 1, 1);
      var analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.2;
      var chunks = [];
      var level = 0;
      var closed = false;

      proc.onaudioprocess = function (e) {
        if (closed) return;
        var d = new Float32Array(e.inputBuffer.getChannelData(0));
        chunks.push(d);
        var sum = 0;
        for (var i = 0; i < d.length; i += 8) sum += d[i] * d[i];
        level = Math.sqrt(sum / (d.length / 8));
      };
      source.connect(analyser);
      analyser.connect(proc);
      proc.connect(ctx.destination);

      // 只拆这一轮的节点，麦克风流和 AudioContext 留着复用
      function cleanup() {
        if (closed) return;
        closed = true;
        try { proc.onaudioprocess = null; } catch (e) {}
        [proc, analyser, source].forEach(function (node) {
          try { node && node.disconnect(); } catch (e) {}
        });
      }

      return {
        level: function () { return level; },
        stop: function () {
          var rate = ctx && ctx.sampleRate ? ctx.sampleRate : REC_RATE;
          cleanup();
          return encodeWav(chunks, rate);
        },
        cancel: function () {
          cleanup();
        }
      };
    }
  };

  /* ---------------- ASR ---------------- */

  async function transcribeApi(blob) {
    var key = X.getKey();
    if (!key) throw new Error('还没有填写 API Key');
    var fd = new FormData();
    fd.append('file', blob, 'recording.wav');
    var res = await fetch(ASR_URL, { method: 'POST', headers: { authorization: 'Bearer ' + key }, body: fd });
    var raw = '';
    var data = null;
    try {
      raw = await res.text();
      data = JSON.parse(raw);
    } catch (e) {}
    if (!res.ok) throw new Error((data && data.error && data.error.message) || raw || 'HTTP ' + res.status);
    if (!data || typeof data.text !== 'string') throw new Error('转写返回格式不对');
    return data.text.trim();
  }

  function browserRecognitionAvailable() {
    return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  }

  function listenBrowser() {
    return new Promise(function (resolve, reject) {
      var Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!Ctor) return reject(new Error('浏览器不支持语音识别'));
      var rec = new Ctor();
      var text = '';
      var done = false;
      function finish() {
        if (done) return;
        done = true;
        try { rec.stop(); } catch (e) {}
        resolve(text.trim());
      }
      rec.lang = 'zh-CN';
      rec.interimResults = true;
      rec.continuous = false;
      rec.onresult = function (e) {
        var out = '';
        for (var i = 0; i < e.results.length; i++) out += e.results[i][0].transcript;
        text = out;
      };
      rec.onerror = function (e) {
        if (done) return;
        done = true;
        reject(new Error(e && e.error === 'not-allowed' ? '没有麦克风权限' : '浏览器语音识别失败'));
      };
      rec.onend = finish;
      try {
        rec.start();
      } catch (e) {
        reject(e);
      }
      setTimeout(finish, 20000);
    });
  }

  /* ---------------- TTS ---------------- */

  function speakBrowser(text) {
    return new Promise(function (resolve) {
      if (!window.speechSynthesis) return resolve();
      try {
        window.speechSynthesis.cancel();
        var u = new SpeechSynthesisUtterance(text);
        u.lang = 'zh-CN';
        u.rate = 1.02;
        u.onend = resolve;
        u.onerror = resolve;
        window.speechSynthesis.speak(u);
        setTimeout(resolve, Math.min(60000, 1200 + text.length * 120));
      } catch (e) {
        resolve();
      }
    });
  }

  async function speakApi(text, voiceId) {
    var key = X.getKey();
    if (!key) throw new Error('还没有填写 API Key');
    var res = await fetch(TTS_URL, {
      method: 'POST',
      headers: { authorization: 'Bearer ' + key, 'content-type': 'application/json' },
      body: JSON.stringify({ text: text, voice_id: voiceId, format: 'pcm', filter_markdown: true })
    });
    if (!res.ok || !res.body) {
      var raw = '';
      try { raw = await res.text(); } catch (e) {}
      throw new Error(raw || 'HTTP ' + res.status);
    }
    var Ctx = window.AudioContext || window.webkitAudioContext;
    if (!state.speakCtx) state.speakCtx = new Ctx({ sampleRate: TTS_RATE });
    var ctx = state.speakCtx;
    if (ctx.state === 'suspended') await ctx.resume();

    var reader = res.body.getReader();
    var carry = new Uint8Array(0);
    var cursor = ctx.currentTime + 0.08;
    var last = null;
    for (;;) {
      var r = await reader.read();
      if (r.done) break;
      var merged = new Uint8Array(carry.length + r.value.length);
      merged.set(carry);
      merged.set(r.value, carry.length);
      var usable = merged.length - (merged.length % 2);
      if (usable <= 0) {
        carry = merged;
        continue;
      }
      var view = new DataView(merged.buffer, merged.byteOffset, usable);
      var n = usable / 2;
      var f = new Float32Array(n);
      for (var i = 0; i < n; i++) f[i] = view.getInt16(i * 2, true) / 32768;
      carry = merged.slice(usable);
      if (!n) continue;
      var buf = ctx.createBuffer(1, n, TTS_RATE);
      buf.copyToChannel(f, 0);
      var src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      src.start(cursor);
      cursor += buf.duration;
      last = src;
    }
    if (!last) return;
    await new Promise(function (resolve) {
      last.onended = resolve;
      setTimeout(resolve, Math.max(5000, (cursor - ctx.currentTime) * 1000 + 3000));
    });
  }

  /* ---------------- UI ---------------- */

  var ui = {};

  function el(id) {
    return document.getElementById(id);
  }

  function svg(path, cls) {
    return (
      '<svg class="' + (cls || 'dc-ico') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + path + '</svg>'
    );
  }

  var ICON = {
    micOff: svg('<path d="M9 9v3a3 3 0 0 0 5 2.2"/><path d="M15 10V6a3 3 0 0 0-5.6-1.5"/><path d="M5.5 11.5a6.5 6.5 0 0 0 9.9 5.6"/><path d="M18.5 11.5a6.4 6.4 0 0 1-.6 2.7"/><path d="M12 18v3.5"/><path d="M4 4l16 16"/>'),
    mic: svg('<rect x="9" y="2.5" width="6" height="11.5" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0"/><path d="M12 18v3.5"/>'),
    wave: svg('<path d="M4 12h2"/><path d="M8 8v8"/><path d="M12 5v14"/><path d="M16 8v8"/><path d="M20 12h-2"/>'),
    call: svg('<path d="M6.5 4h3l1.6 4-2 1.4a12.5 12.5 0 0 0 5.5 5.5l1.4-2 4 1.6v3a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 3.5 6.2 2 2 0 0 1 5.5 4z"/>'),
    hang: '<svg class="dc-ico" viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true"><path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08c-.18-.17-.29-.42-.29-.7 0-.28.11-.53.29-.71C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67c.18.18.29.43.29.71 0 .28-.11.53-.29.7l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.11-.7-.28-.79-.74-1.69-1.36-2.67-1.85-.33-.16-.56-.5-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z"/></svg>'
  };

  function buildUi() {
    if (el('dshx-call')) return;
    var root = document.createElement('div');
    root.id = 'dshx-call';
    root.setAttribute('aria-hidden', 'true');
    root.innerHTML =
      '<div class="dc-sheet" role="dialog" aria-modal="true" aria-label="语音通话">' +
      '<div class="dc-top">' +
      '<button class="dc-avatar" id="dc-avatar" aria-label="点一下说话">' +
      '<img id="dc-avatar-img" src="' + avatarSrc() + '" alt="" />' +
      '</button>' +
      '<div class="dc-name">DChat</div>' +
      '<div class="dc-sub" id="dc-sub">继续当前对话</div>' +
      '<div class="dc-time" id="dc-timer">00:00</div>' +
      '<div class="dc-wave" id="dc-wave"><i></i><i></i><i></i><i></i><i></i></div>' +
      '<div class="dc-caption" id="dc-caption"></div>' +
      '</div>' +
      '<div class="dc-controls">' +
      '<button class="dc-ctl" id="dc-mute" aria-pressed="false"><span class="dc-ico-wrap">' + ICON.mic + '</span><em>静音</em></button>' +
      '<button class="dc-ctl" id="dc-hands" aria-pressed="true"><span class="dc-ico-wrap">' + ICON.wave + '</span><em>免手持</em></button>' +
      '<button class="dc-hang" id="dc-end" aria-label="挂断"><span class="dc-ico-wrap">' + ICON.hang + '</span><em>挂断</em></button>' +
      '</div>' +
      '</div>';
    document.body.appendChild(root);

    ui.root = root;
    ui.log = el('dc-caption');
    ui.sub = el('dc-sub');
    ui.timer = el('dc-timer');
    ui.wave = el('dc-wave');
    ui.mute = el('dc-mute');
    ui.hands = el('dc-hands');

    el('dc-end').addEventListener('click', endCall);
    ui.mute.addEventListener('click', toggleMute);
    ui.hands.addEventListener('click', function () {
      state.handsFree = !state.handsFree;
      try { localStorage.setItem('dshx:hands-free', state.handsFree ? '1' : '0'); } catch (e) {}
      this.setAttribute('aria-pressed', String(state.handsFree));
      if (state.phase === 'idle' && state.handsFree) startListening();
      renderState();
    });
    // 非免手持时，点头像开始/结束一句话
    el('dc-avatar').addEventListener('click', function () {
      if (state.muted) return;
      if (state.phase === 'listening') stopListeningAndSend();
      else if (state.phase === 'idle') startListening();
    });
  }

  function toggleMute() {
    state.muted = !state.muted;
    if (ui.mute) {
      ui.mute.setAttribute('aria-pressed', String(state.muted));
      ui.mute.querySelector('.dc-ico-wrap').innerHTML = state.muted ? ICON.micOff : ICON.mic;
    }
    if (state.muted) {
      clearInterval(state.vadTimer);
      if (state.rec) {
        try { state.rec.cancel(); } catch (e) {}
        state.rec = null;
      }
      setPhase('muted', '已静音');
    } else {
      setPhase('idle');
      if (state.handsFree) startListening();
    }
  }

  function renderState() {
    var p = state.phase;
    if (ui.wave) ui.wave.classList.toggle('dc-wave-on', p === 'listening' || p === 'speaking');
    if (ui.root) ui.root.setAttribute('data-phase', p);
  }

  function setPhase(p, text) {
    state.phase = p;
    renderState();
    if (ui.sub) ui.sub.textContent = text || phaseText(p);
  }

  function phaseText(p) {
    return {
      idle: state.handsFree ? '正在聆听…' : '点一下头像开始说话',
      listening: '正在聆听…',
      transcribing: '正在识别…',
      thinking: '正在思考…',
      speaking: '正在说话…',
      muted: '已静音',
      error: '出错了',
      ended: '通话已结束'
    }[p] || '';
  }

  function addBubble(role, text) {
    state.bubbles.push({ role: role, text: text });
    if (state.bubbles.length > 40) state.bubbles.shift();
    if (!ui.log) return;
    var shown = text.length > 220 ? text.slice(0, 220) + '…' : text;
    ui.log.textContent = shown;
    ui.log.className = 'dc-caption dc-caption-' + role + ' dc-caption-on';
    ui.log.scrollTop = ui.log.scrollHeight;
  }

  function tick() {
    if (!state.startedAt || !ui.timer) return;
    var s = Math.floor((Date.now() - state.startedAt) / 1000);
    var m = String(Math.floor(s / 60)).padStart(2, '0');
    ui.timer.textContent = m + ':' + String(s % 60).padStart(2, '0');
  }

  /* ---------------- 聊天页头部按钮 ---------------- */

  var fab = null;

  var fabPos = { top: -1, left: -1, shown: null };
  var fabRaf = 0;

  function scheduleFab() {
    if (fabRaf) return;
    fabRaf = requestAnimationFrame(function () {
      fabRaf = 0;
      positionFab();
    });
  }

  function hideFab() {
    if (!fab) return;
    if (fabPos.shown !== false) {
      fab.style.display = 'none';
      fabPos.shown = false;
    }
    fabPos.top = -1;
    fabPos.left = -1;
  }

  function positionFab() {
    if (!fab) return;
    var anchor =
      document.querySelector('button[aria-label="开启新对话"]') ||
      document.querySelector('button[aria-label="New chat"]');
    if (!anchor) return hideFab();

    // 隐藏的按钮（欢迎页没有「＋」）就别显示
    try {
      if (getComputedStyle(anchor).display === 'none') return hideFab();
    } catch (e) {}

    var r = anchor.getBoundingClientRect();
    if (!r.width) {
      // 布局还没算出来（首帧 / 无布局环境）：先按右上角占位，等真实 rect 再校正
      if (fabPos.shown !== true) {
        fab.style.left = 'auto';
        fab.style.right = '56px';
        fab.style.top = 'calc(env(safe-area-inset-top) + 10px)';
        fab.style.display = 'flex';
        fabPos.shown = true;
      }
      return;
    }

    var top = Math.round(r.top + r.height / 2 - 17);
    var left = Math.round(r.left - 46);
    if (top !== fabPos.top || left !== fabPos.left) {
      fab.style.right = 'auto';
      fab.style.top = top + 'px';
      fab.style.left = left + 'px';
      fabPos.top = top;
      fabPos.left = left;
    }
    if (fabPos.shown !== true) {
      fab.style.display = 'flex';
      fabPos.shown = true;
    }
  }

  function mountFab() {
    if (fab) return;
    fab = document.createElement('button');
    fab.id = 'dshx-call-fab';
    fab.setAttribute('aria-label', '语音通话');
    fab.innerHTML = ICON.call;
    fab.addEventListener('click', function () {
      openCall();
    });
    document.body.appendChild(fab);
    positionFab();

    window.addEventListener('resize', scheduleFab);
    window.addEventListener('orientationchange', function () {
      setTimeout(scheduleFab, 60);
      setTimeout(scheduleFab, 280);
    });

    // 头部按钮是 React 渲染的：挂个观察器，跟着它的出现/消失/位移同帧更新
    var root = document.getElementById('root') || document.body;
    try {
      var mo = new MutationObserver(scheduleFab);
      mo.observe(root, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class', 'style', 'aria-hidden', 'hidden']
      });
    } catch (e) {}

    // 兜底：滚动/动画等观察器覆盖不到的情况
    setInterval(scheduleFab, 3000);
  }

  /* ---------------- 录音 + 语音识别 ---------------- */

  async function startListening() {
    if (state.phase === 'listening' || state.phase === 'thinking' || state.phase === 'speaking') return;
    try {
      state.rec = await Rec.start();
    } catch (e) {
      var msg = e && e.name === 'NotAllowedError' ? '没有麦克风权限，去 Safari 设置里允许' : '无法开始录音';
      setPhase('error', msg);
      return;
    }
    state.listenStartedAt = Date.now();
    setPhase('listening', state.handsFree ? '我在听…' : '点一下结束');

    clearInterval(state.vadTimer);
    var heard = false;
    state.vadTimer = setInterval(function () {
      if (state.phase !== 'listening' || !state.rec) return;
      var lv = state.rec.level();
      if (lv > 0.03) heard = true;
      var silentLong = heard && lv < 0.012;
      var tooLong = Date.now() - state.listenStartedAt > MAX_REC_MS;
      if (tooLong) stopListeningAndSend();
      else if (state.handsFree && heard && silentLong) {
        if (!state.silentSince) state.silentSince = Date.now();
        else if (Date.now() - state.silentSince > 1100) stopListeningAndSend();
      } else if (lv >= 0.012) {
        state.silentSince = 0;
      }
    }, 120);
  }

  async function stopListeningAndSend() {
    clearInterval(state.vadTimer);
    var rec = state.rec;
    state.rec = null;
    state.silentSince = 0;
    if (!rec) return;
    var blob = rec.stop();
    if (blob.size < 44 + 1600) {
      setPhase('idle', '没听到声音，再说一次');
      return;
    }

    setPhase('transcribing');
    var text = '';
    try {
      text = await transcribeApi(blob);
      state.apiAsr = true;
    } catch (e) {
      state.apiAsr = false;
      if (!browserRecognitionAvailable()) {
        setPhase('error', '语音识别不可用：' + (e && e.message ? e.message : ''));
        return;
      }
      setPhase('transcribing', '接口不可用，改用系统识别…');
      try {
        text = await listenBrowser();
      } catch (e2) {
        setPhase('error', '识别失败：' + (e2 && e2.message ? e2.message : ''));
        return;
      }
    }

    if (!text) {
      setPhase('idle', '没听清，再说一次');
      if (state.handsFree) setTimeout(startListening, 600);
      return;
    }
    addBubble('user', text);
    await askAndSpeak(text);
  }

  /* ---------------- 走聊天这条链路 ---------------- */

  function setNativeValue(ta, value) {
    var proto = window.HTMLTextAreaElement && window.HTMLTextAreaElement.prototype;
    var desc = proto && Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) desc.set.call(ta, value);
    else ta.value = value;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function findSendButton() {
    var root = document.getElementById('root') || document;
    return (
      root.querySelector('button[aria-label="发送"]') ||
      root.querySelector('button[aria-label="Send"]')
    );
  }

  function askInChat(text) {
    return new Promise(function (resolve, reject) {
      var root = document.getElementById('root') || document;
      var ta = root.querySelector('textarea');
      if (!ta) return reject(new Error('找不到聊天输入框'));
      setNativeValue(ta, text);
      var btn = findSendButton();
      if (!btn || btn.getAttribute('aria-disabled') === 'true') {
        return reject(new Error('发送按钮不可用（可能没 Key 或正在上传）'));
      }
      var timer = setTimeout(function () {
        state.pendingTurn = null;
        reject(new Error('等回复超时'));
      }, 150000);
      state.pendingTurn = {
        resolve: function (t) {
          clearTimeout(timer);
          resolve(t);
        }
      };
      btn.click();
    });
  }

  async function askAndSpeak(text) {
    setPhase('thinking');
    var reply = '';
    try {
      reply = await askInChat(text);
    } catch (e) {
      setPhase('error', e && e.message ? e.message : '发送失败');
      return;
    }
    if (!reply) reply = '（没有文字回复）';
    addBubble('assistant', reply);

    setPhase('speaking');
    var voice = 'tide';
    try {
      voice = localStorage.getItem('chat-demo:tts-voice') === 'stella' ? 'stella' : 'tide';
    } catch (e) {}
    try {
      if (state.apiTts) {
        await speakApi(reply, voice);
        state.apiTts = true;
      } else {
        await speakBrowser(reply);
      }
    } catch (e) {
      state.apiTts = false;
      await speakBrowser(reply);
    }

    if (!state.startedAt) return; // 已经挂断
    setPhase('idle', '正在聆听…');
    if (state.handsFree) {
      await new Promise(function (r) { setTimeout(r, 350); });
      if (state.startedAt) startListening();
    }
  }

  /* ---------------- 开始 / 结束 ---------------- */

  function openCall() {
    if (!X.getKey()) {
      try {
        window.dispatchEvent(
          new CustomEvent('dshx:toast', { detail: { text: '先在「设置 → 账户 → API Key」填好 Key', kind: 'err' } })
        );
      } catch (e) {}
      return false;
    }
    buildUi();
    applyAvatar(); // 每次打开都同步一次头像（图标缺失会退化成字母）
    state.startedAt = Date.now();
    state.bubbles = [];
    state.ended = false;
    state.muted = false;
    if (ui.mute) {
      ui.mute.setAttribute('aria-pressed', 'false');
      ui.mute.querySelector('.dc-ico-wrap').innerHTML = ICON.mic;
    }
    if (ui.log) {
      ui.log.textContent = '';
      ui.log.className = 'dc-caption';
    }
    ui.root.classList.add('dc-open');
    ui.root.setAttribute('aria-hidden', 'false');
    if (ui.hands) ui.hands.setAttribute('aria-pressed', String(state.handsFree));
    setPhase('idle', state.handsFree ? '点一下开始（之后自动听）' : '点一下说话');
    clearInterval(state.timer);
    state.timer = setInterval(tick, 1000);
    tick();
    // 注意：这里必须是 idle，否则 startListening 会因为 phase==='listening' 直接返回
    if (state.handsFree) startListening();
    return true;
  }

  function endCall() {
    state.startedAt = 0;
    state.ended = true;
    clearInterval(state.timer);
    clearInterval(state.vadTimer);
    state.pendingTurn = null;
    if (state.rec) {
      try { state.rec.cancel(); } catch (e) {}
      state.rec = null;
    }
    releaseMic();
    try { window.speechSynthesis && window.speechSynthesis.cancel(); } catch (e) {}
    try { state.speakCtx && state.speakCtx.suspend(); } catch (e) {}
    if (ui.root) {
      ui.root.classList.remove('dc-open');
      ui.root.setAttribute('aria-hidden', 'true');
    }
    setPhase('idle');
    window.dispatchEvent(new CustomEvent('dshx:call-end'));
  }

  window.addEventListener('dshx:turn', function (e) {
    var p = state.pendingTurn;
    if (!p) return;
    state.pendingTurn = null;
    var text = (e.detail && e.detail.text) || '';
    p.resolve(text);
  });

  /* ---------------- 设置页用的能力检测 ---------------- */

  function capability() {
    return {
      mic: !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia),
      secure: window.isSecureContext !== false,
      browserAsr: browserRecognitionAvailable(),
      browserTts: !!window.speechSynthesis,
      apiAsr: state.apiAsr,
      apiTts: state.apiTts,
      handsFree: state.handsFree
    };
  }

  window.__DSHV = {
    start: openCall,
    end: endCall,
    capability: capability,
    _encodeWav: encodeWav,
    _debugBubble: addBubble,
    _ask: askInChat,
    _listen: startListening,
    refreshAvatar: applyAvatar,
    micState: micState,
    releaseMic: releaseMic,
    state: state
  };

  if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') releaseMic();
    });
    window.addEventListener('pagehide', releaseMic);
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountFab);
    else setTimeout(mountFab, 0);
  }

  if (typeof module === 'object' && module.exports) module.exports = { encodeWav: encodeWav };
})();
