/* Hackatoa games — tiny synthesized sound effects (WebAudio, no asset files).
 * window.SFX.play('click' | 'place' | 'place2' | 'turn' | 'join' | 'win' | 'lose' | 'draw'
 *   | 'hit' | 'miss' | 'sunk' | 'flip' | 'pop' | 'reveal' | 'flag' | 'boom' | 'error' | 'tick')
 * Mute is shared across every game on the same origin via localStorage 'sfxMuted'.
 * Fail-soft: if WebAudio or storage is unavailable, everything silently no-ops. */
(function () {
  if (window.SFX) return;
  var KEY = 'sfxMuted';
  var ctx = null, master = null, noiseBuf = null;
  var muted = false;
  try { muted = localStorage.getItem(KEY) === '1'; } catch (e) {}

  function ensure() {
    if (ctx) return ctx;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try {
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.35;
      master.connect(ctx.destination);
    } catch (e) { ctx = null; }
    return ctx;
  }

  // Browsers keep the context suspended until a user gesture; resume on the first one.
  function unlock() {
    var c = ensure();
    if (c && c.state === 'suspended') c.resume();
  }
  ['pointerdown', 'keydown', 'touchstart'].forEach(function (ev) {
    window.addEventListener(ev, unlock, { passive: true, capture: true });
  });

  function tone(freq, dur, o) {
    o = o || {};
    var t0 = ctx.currentTime + (o.delay || 0);
    var osc = ctx.createOscillator();
    var g = ctx.createGain();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t0 + dur);
    var v = o.vol == null ? 0.5 : o.vol;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(v, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g); g.connect(master);
    osc.start(t0); osc.stop(t0 + dur + 0.02);
  }

  function noise(dur, o) {
    o = o || {};
    if (!noiseBuf) {
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      var d = noiseBuf.getChannelData(0);
      for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    var t0 = ctx.currentTime + (o.delay || 0);
    var src = ctx.createBufferSource();
    src.buffer = noiseBuf; src.loop = true;
    var f = ctx.createBiquadFilter();
    f.type = o.filter || 'lowpass';
    f.frequency.setValueAtTime(o.freq || 1000, t0);
    if (o.to) f.frequency.exponentialRampToValueAtTime(o.to, t0 + dur);
    var g = ctx.createGain();
    var v = o.vol == null ? 0.5 : o.vol;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(v, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f); f.connect(g); g.connect(master);
    src.start(t0); src.stop(t0 + dur + 0.02);
  }

  function arp(notes, step, o) {
    notes.forEach(function (n, i) { tone(n, step * 1.8, Object.assign({ delay: i * step }, o)); });
  }

  var SOUNDS = {
    click:  function () { tone(620, 0.06, { type: 'square', vol: 0.18 }); },
    pop:    function () { tone(400, 0.09, { type: 'sine', to: 800, vol: 0.4 }); },
    place:  function () { tone(520, 0.12, { type: 'triangle', to: 380, vol: 0.5 }); },
    place2: function () { tone(330, 0.14, { type: 'triangle', to: 260, vol: 0.5 }); },
    turn:   function () { arp([660, 880], 0.08, { type: 'sine', vol: 0.3 }); },
    join:   function () { arp([440, 660], 0.1, { type: 'triangle', vol: 0.35 }); },
    win:    function () { arp([523, 659, 784, 1047], 0.11, { type: 'triangle', vol: 0.45 }); },
    lose:   function () { arp([392, 330, 262, 196], 0.17, { type: 'sawtooth', vol: 0.22 }); },
    draw:   function () { arp([440, 440], 0.16, { type: 'triangle', vol: 0.35 }); },
    hit:    function () { tone(160, 0.25, { type: 'sawtooth', to: 50, vol: 0.5 }); noise(0.2, { freq: 1800, to: 300, vol: 0.5 }); },
    miss:   function () { noise(0.35, { filter: 'bandpass', freq: 2200, to: 500, vol: 0.35 }); tone(300, 0.2, { type: 'sine', to: 120, vol: 0.2 }); },
    sunk:   function () { noise(0.7, { freq: 2500, to: 80, vol: 0.7 }); tone(140, 0.7, { type: 'sawtooth', to: 35, vol: 0.55 }); tone(90, 0.5, { type: 'square', to: 30, vol: 0.3, delay: 0.1 }); },
    flip:   function () { noise(0.07, { filter: 'highpass', freq: 3000, vol: 0.3 }); },
    reveal: function () { tone(900, 0.04, { type: 'square', vol: 0.1 }); },
    flag:   function () { tone(700, 0.06, { type: 'square', vol: 0.16 }); tone(1000, 0.07, { type: 'square', vol: 0.16, delay: 0.06 }); },
    boom:   function () { noise(0.9, { freq: 3000, to: 60, vol: 0.8 }); tone(120, 0.8, { type: 'sawtooth', to: 30, vol: 0.6 }); },
    error:  function () { tone(150, 0.18, { type: 'square', vol: 0.25 }); },
    tick:   function () { tone(1200, 0.03, { type: 'square', vol: 0.12 }); }
  };

  var last = {};
  function play(name) {
    if (muted || !SOUNDS[name]) return;
    var now = Date.now();
    if (last[name] && now - last[name] < 40) return; // collapse duplicate triggers (e.g. same state broadcast twice)
    last[name] = now;
    var c = ensure();
    if (!c) return;
    if (c.state === 'suspended') { c.resume(); }
    try { SOUNDS[name](); } catch (e) {}
  }

  var btn = null;
  function paint() {
    if (!btn) return;
    btn.textContent = muted ? '🔇' : '🔊';
    btn.setAttribute('aria-pressed', muted ? 'true' : 'false');
    btn.setAttribute('aria-label', muted ? 'Unmute sound effects' : 'Mute sound effects');
    btn.title = btn.getAttribute('aria-label');
  }
  function setMuted(m) {
    muted = !!m;
    try { localStorage.setItem(KEY, muted ? '1' : '0'); } catch (e) {}
    paint();
    if (!muted) play('click');
  }
  function mount() {
    if (btn || !document.body) return;
    btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'sfx-toggle';
    btn.style.cssText = 'position:fixed;left:10px;top:10px;z-index:9999;width:38px;height:38px;border-radius:50%;' +
      'border:1px solid rgba(255,255,255,.25);background:rgba(20,20,28,.85);color:#fff;font-size:18px;line-height:1;' +
      'cursor:pointer;padding:0;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(0,0,0,.4);';
    btn.addEventListener('click', function () { setMuted(!muted); });
    document.body.appendChild(btn);
    paint();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();

  window.SFX = { play: play, setMuted: setMuted, isMuted: function () { return muted; } };
})();
