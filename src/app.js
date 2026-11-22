(() => {
  'use strict';

  // ── i18n ────────────────────────────────────────────────
  const zh = (navigator.language || 'zh').toLowerCase().startsWith('zh');
  const T = zh ? {
    open: '打开视频', copy: '复制', save: '保存当前帧',
    emptyTitle: '将视频拖到此处', emptySub: '或点击“打开视频”选择文件',
    dropHere: '松开以打开视频',
    tipPrev: '上一帧  ←', tipNext: '下一帧  →', tipPlay: '播放 / 暂停  空格',
    saved: n => `已保存 ${n}`, reveal: '在文件夹中显示',
    copied: '已复制到剪贴板',
    errDecode: '无法播放此视频：格式或编码不受支持',
    errSave: e => `保存失败：${e}`, errCopy: '复制失败',
    errNotVideo: '这不是受支持的视频文件',
    frame: '帧', videoFiles: '视频文件', allFiles: '所有文件',
    saveTitle: '保存当前帧', openTitle: '打开视频',
  } : {
    open: 'Open video', copy: 'Copy', save: 'Save frame',
    emptyTitle: 'Drop a video here', emptySub: 'or choose a file with “Open video”',
    dropHere: 'Release to open',
    tipPrev: 'Previous frame  ←', tipNext: 'Next frame  →', tipPlay: 'Play / Pause  Space',
    saved: n => `Saved ${n}`, reveal: 'Show in folder',
    copied: 'Copied to clipboard',
    errDecode: 'Can’t play this video: unsupported format or codec',
    errSave: e => `Couldn’t save: ${e}`, errCopy: 'Couldn’t copy',
    errNotVideo: 'Not a supported video file',
    frame: 'Frame', videoFiles: 'Video files', allFiles: 'All files',
    saveTitle: 'Save frame', openTitle: 'Open video',
  };
  document.documentElement.lang = zh ? 'zh-CN' : 'en';
  document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = T[el.dataset.i18n]; });
  document.querySelectorAll('[data-tip-key]').forEach(el => { el.dataset.tip = T[el.dataset.tipKey]; });

  // ── Handles ─────────────────────────────────────────────
  const $ = id => document.getElementById(id);
  const video = $('video'), stage = $('stage'), seek = $('seek');
  const tcInput = $('tcInput'), tcDur = $('tcDur'), meta = $('meta'), fileName = $('fileName');
  const openBtn = $('openBtn'), saveBtn = $('saveBtn'), copyBtn = $('copyBtn');
  const prevBtn = $('prevBtn'), nextBtn = $('nextBtn'), playBtn = $('playBtn');
  const toast = $('toast'), toastText = $('toastText'), toastAction = $('toastAction');
  const filePicker = $('filePicker');

  const tauri = window.__TAURI__ || null;
  const invoke = tauri ? tauri.core.invoke : null;
  const VIDEO_EXT = ['mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v', 'wmv', 'ts', 'mts', 'm2ts', 'flv', '3gp', 'mpg', 'mpeg', 'ogv'];

  const state = { path: null, name: '', fps: 30, fpsKnown: false, ready: false, scrubbing: false, format: 'png' };
  try { state.format = localStorage.getItem('format') === 'jpg' ? 'jpg' : 'png'; } catch {}

  // ── Helpers ─────────────────────────────────────────────
  const pad = (n, l = 2) => String(n).padStart(l, '0');
  function fmtTime(t, sep = ':', dot = '.') {
    if (!isFinite(t) || t < 0) t = 0;
    const ms = Math.round(t * 1000);
    return pad(Math.floor(ms / 3600000)) + sep + pad(Math.floor(ms / 60000) % 60) + sep +
      pad(Math.floor(ms / 1000) % 60) + dot + pad(ms % 1000, 3);
  }
  function parseTime(s) {
    const parts = s.trim().replace(/,/g, '.').split(':').map(Number);
    if (!parts.length || parts.length > 3 || parts.some(n => !isFinite(n) || n < 0)) return null;
    return parts.reduce((acc, n) => acc * 60 + n, 0);
  }
  const baseName = p => p.split(/[\\/]/).pop();
  const dirName = p => p.replace(/[\\/][^\\/]*$/, '');
  const stem = n => n.replace(/\.[^.]+$/, '');
  const snapFps = f => {
    for (const c of [23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60, 100, 120]) if (Math.abs(f - c) / c < 0.012) return c;
    return Math.round(f * 100) / 100;
  };

  // Start time of the frame on screen (seeks land mid-frame on purpose).
  const frameTime = () => {
    const t = video.currentTime || 0;
    return state.fpsKnown && video.paused ? Math.floor(t * state.fps + 1e-3) / state.fps : t;
  };

  let toastTimer;
  function showToast(text, { error = false, action = null, label = '' } = {}) {
    toastText.textContent = text;
    toast.classList.toggle('error', error);
    toastAction.hidden = !action;
    toastAction.textContent = label;
    toastAction.onclick = action;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), error ? 6000 : 4500);
  }

  function setEnabled(on) {
    for (const el of [saveBtn, copyBtn, prevBtn, nextBtn, playBtn, seek, tcInput]) el.disabled = !on;
  }

  function renderMeta() {
    if (!state.ready) { meta.textContent = ''; return; }
    const f = Math.floor(video.currentTime * state.fps + 1e-3);
    const fps = state.fpsKnown ? `${state.fps} fps` : '';
    meta.textContent = [`${video.videoWidth} × ${video.videoHeight}`, fps, `${T.frame} ${f}`].filter(Boolean).join('   ·   ');
  }
  function renderTime() {
    const t = video.currentTime || 0;
    if (!state.scrubbing) seek.value = t;
    seek.style.setProperty('--p', (video.duration ? (seek.value / video.duration) * 100 : 0) + '%');
    if (document.activeElement !== tcInput) tcInput.value = fmtTime(frameTime());
    renderMeta();
  }

  // ── Loading ─────────────────────────────────────────────
  let loadToken = 0;
  async function loadVideo(src, name, path) {
    const token = ++loadToken;
    video.pause();
    state.ready = false; state.fpsKnown = false; state.fps = 30;
    state.path = path || null; state.name = name;
    setEnabled(false);
    if (tauri) video.crossOrigin = 'anonymous'; // asset:// is cross-origin; needed to read pixels
    video.src = src;
    video.load();
    try {
      await new Promise((res, rej) => {
        video.addEventListener('loadeddata', res, { once: true });
        video.addEventListener('error', rej, { once: true });
      });
    } catch {
      if (token !== loadToken) return;
      stage.classList.remove('has-video');
      fileName.textContent = '';
      showToast(T.errDecode, { error: true });
      return;
    }
    if (token !== loadToken) return;
    state.ready = true;
    stage.classList.add('has-video');
    fileName.textContent = name;
    if (tauri) tauri.window.getCurrentWindow().setTitle(`${name} - FrameGrab`).catch(() => {});
    seek.max = video.duration; seek.value = 0;
    tcDur.textContent = '/ ' + fmtTime(video.duration);
    setEnabled(true);
    renderTime();
    probeFps(token);
  }

  // Measure real frame spacing by letting a few frames present, muted, then rewinding.
  async function probeFps(token) {
    if (!video.requestVideoFrameCallback) return;
    const times = [];
    video.muted = true;
    state.probing = true;
    const done = new Promise(res => {
      const tick = (_, m) => {
        times.push(m.mediaTime);
        if (times.length < 8 && token === loadToken) video.requestVideoFrameCallback(tick); else res();
      };
      video.requestVideoFrameCallback(tick);
      setTimeout(res, 1500);
    });
    try { await video.play(); } catch {}
    await done;
    video.pause();
    state.probing = false;
    if (token !== loadToken) return;
    video.muted = false;
    const d = [];
    for (let i = 1; i < times.length; i++) if (times[i] > times[i - 1]) d.push(times[i] - times[i - 1]);
    d.sort((a, b) => a - b);
    if (d.length >= 3) { state.fps = snapFps(1 / d[d.length >> 1]); state.fpsKnown = true; }
    video.currentTime = 0;
    renderTime();
  }

  async function openPath(path) {
    const name = baseName(path);
    const ext = name.split('.').pop().toLowerCase();
    if (!VIDEO_EXT.includes(ext)) { showToast(T.errNotVideo, { error: true }); return; }
    try { await invoke('allow_video', { path }); } catch { showToast(T.errNotVideo, { error: true }); return; }
    loadVideo(tauri.core.convertFileSrc(path), name, path);
  }

  async function openDialog() {
    if (!tauri) { filePicker.click(); return; }
    const picked = await tauri.dialog.open({
      title: T.openTitle, multiple: false,
      filters: [{ name: T.videoFiles, extensions: VIDEO_EXT }, { name: T.allFiles, extensions: ['*'] }],
    });
    if (picked) openPath(typeof picked === 'string' ? picked : picked.path);
  }

  // ── Transport ───────────────────────────────────────────
  function seekTo(t) {
    if (!state.ready) return;
    video.currentTime = Math.min(Math.max(t, 0), video.duration || 0);
  }
  function stepFrame(n) {
    if (!state.ready) return;
    video.pause();
    const cur = Math.floor(video.currentTime * state.fps + 1e-3);
    // Aim at the middle of the target frame so rounding never lands on a neighbour.
    seekTo((Math.max(cur + n, 0) + 0.5) / state.fps);
  }
  function togglePlay() {
    if (!state.ready) return;
    if (video.paused) { if (video.ended) video.currentTime = 0; video.play().catch(() => {}); } else video.pause();
  }
  function syncPlayIcon() {
    const playing = !video.paused && !state.probing;
    $('icoPlay').hidden = playing; $('icoPause').hidden = !playing;
  }

  // ── Capture ─────────────────────────────────────────────
  async function grab(format) {
    video.pause();
    if (video.seeking) await new Promise(r => video.addEventListener('seeked', r, { once: true }));
    const c = document.createElement('canvas');
    c.width = video.videoWidth; c.height = video.videoHeight;
    c.getContext('2d').drawImage(video, 0, 0, c.width, c.height);
    const blob = await new Promise(r => c.toBlob(r, format === 'jpg' ? 'image/jpeg' : 'image/png', 0.95));
    if (!blob) throw new Error('encode');
    return blob;
  }

  async function saveFrame() {
    if (!state.ready) return;
    const ext = state.format;
    video.pause();
    const name = `${stem(state.name)}_${fmtTime(frameTime(), '-', '-')}.${ext}`;
    try {
      const blob = await grab(ext);
      if (!tauri) {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob); a.download = name; a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
        showToast(T.saved(name));
        return;
      }
      let dir = null;
      try { dir = localStorage.getItem('lastDir'); } catch {}
      if (!dir && state.path) dir = dirName(state.path);
      const sep = dir && dir.includes('/') && !dir.includes('\\') ? '/' : '\\';
      const target = await tauri.dialog.save({
        title: T.saveTitle,
        defaultPath: dir ? dir + sep + name : name,
        filters: [{ name: ext.toUpperCase(), extensions: ext === 'jpg' ? ['jpg', 'jpeg'] : ['png'] }],
      });
      if (!target) return;
      await invoke('save_image', new Uint8Array(await blob.arrayBuffer()), {
        headers: { 'x-path': encodeURIComponent(target) },
      });
      try { localStorage.setItem('lastDir', dirName(target)); } catch {}
      showToast(T.saved(baseName(target)), { label: T.reveal, action: () => invoke('reveal', { path: target }) });
    } catch (e) {
      showToast(T.errSave(e && e.message ? e.message : e), { error: true });
    }
  }

  async function copyFrame() {
    if (!state.ready) return;
    try {
      const blob = await grab('png');
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      showToast(T.copied);
    } catch { showToast(T.errCopy, { error: true }); }
  }

  // ── Wiring ──────────────────────────────────────────────
  function setFormat(f) {
    state.format = f;
    document.querySelectorAll('#formatSeg button').forEach(b => b.setAttribute('aria-checked', String(b.dataset.fmt === f)));
    try { localStorage.setItem('format', f); } catch {}
  }
  setFormat(state.format);
  $('formatSeg').addEventListener('click', e => { const b = e.target.closest('button'); if (b) setFormat(b.dataset.fmt); });

  openBtn.onclick = openDialog;
  saveBtn.onclick = saveFrame;
  copyBtn.onclick = copyFrame;
  prevBtn.onclick = () => stepFrame(-1);
  nextBtn.onclick = () => stepFrame(1);
  playBtn.onclick = togglePlay;
  video.onclick = togglePlay;
  $('empty').onclick = openDialog;

  seek.addEventListener('pointerdown', () => { state.scrubbing = true; video.pause(); });
  seek.addEventListener('input', () => { seekTo(Number(seek.value)); renderTime(); });
  const endScrub = () => { state.scrubbing = false; };
  seek.addEventListener('change', endScrub);
  window.addEventListener('pointerup', endScrub);
  seek.addEventListener('keydown', e => e.preventDefault()); // arrows are frame steps, handled globally

  tcInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') { const t = parseTime(tcInput.value); if (t != null) { video.pause(); seekTo(t); } tcInput.blur(); }
    if (e.key === 'Escape') tcInput.blur();
    e.stopPropagation();
  });
  tcInput.addEventListener('focus', () => tcInput.select());
  tcInput.addEventListener('blur', renderTime);

  for (const ev of ['timeupdate', 'seeked', 'seeking']) video.addEventListener(ev, renderTime);
  for (const ev of ['play', 'pause', 'ended']) video.addEventListener(ev, syncPlayIcon);
  (function raf() { if (state.ready && !video.paused) renderTime(); requestAnimationFrame(raf); })();

  window.addEventListener('keydown', e => {
    const ctrl = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (ctrl && k === 'o') { e.preventDefault(); openDialog(); return; }
    if (ctrl && k === 's') { e.preventDefault(); saveFrame(); return; }
    if (ctrl && k === 'c') { e.preventDefault(); copyFrame(); return; }
    if (ctrl || e.altKey) return;
    if (e.key === ' ') { e.preventDefault(); togglePlay(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); e.shiftKey ? (video.pause(), seekTo(video.currentTime - 1)) : stepFrame(-1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); e.shiftKey ? (video.pause(), seekTo(video.currentTime + 1)) : stepFrame(1); }
    else if (e.key === 'Home') { e.preventDefault(); seekTo(0); }
    else if (e.key === 'End') { e.preventDefault(); video.pause(); seekTo(video.duration - 0.5 / state.fps); }
  });
  // Space on a focused button would otherwise click it as well.
  document.querySelectorAll('button').forEach(b => b.addEventListener('keyup', e => { if (e.key === ' ') e.preventDefault(); }));
  window.addEventListener('contextmenu', e => { if (e.target !== tcInput) e.preventDefault(); });

  // Drag & drop / launch argument
  if (tauri) {
    tauri.webview.getCurrentWebview().onDragDropEvent(({ payload }) => {
      if (payload.type === 'enter' || payload.type === 'over') stage.classList.add('dragging');
      else stage.classList.remove('dragging');
      if (payload.type === 'drop' && payload.paths && payload.paths[0]) openPath(payload.paths[0]);
    });
    invoke('initial_file').then(p => { if (p) openPath(p); }).catch(() => {});
  } else {
    filePicker.onchange = () => { const f = filePicker.files[0]; if (f) loadVideo(URL.createObjectURL(f), f.name, null); };
    window.addEventListener('dragover', e => { e.preventDefault(); stage.classList.add('dragging'); });
    window.addEventListener('dragleave', () => stage.classList.remove('dragging'));
    window.addEventListener('drop', e => {
      e.preventDefault(); stage.classList.remove('dragging');
      const f = e.dataTransfer.files[0]; if (f) loadVideo(URL.createObjectURL(f), f.name, null);
    });
  }
})();
