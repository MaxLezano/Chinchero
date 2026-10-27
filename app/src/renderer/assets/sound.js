// Sonidos de interacción, sintetizados con Web Audio: no hay archivos de audio ni nada que descargar.
// Apagados por defecto (preferencia "sounds"); el volumen ("soundVol", 0–100) se suma al del sistema, que manda.
(function () {
  let ctx = null, noise = null;
  const last = {};
  let recent = [];

  function audio() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      // Un segundo de ruido blanco que reutilizan todos los sonidos
      noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }

  // Envolvente rápida: sube en `a` segundos hasta `peak` y cae hasta casi cero en `dur`
  function env(g, t, peak, a, dur) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  }
  function burst(out, t, dur, type, freq, q, peak, a = 0.003) {
    const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    env(g, t, peak, a, dur);
    src.connect(f).connect(g).connect(out);
    src.start(t, Math.random() * 0.5, dur + 0.05);
    return f;
  }
  function tone(out, t, dur, type, f0, f1, peak) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    env(g, t, peak, 0.002, dur);
    o.connect(g).connect(out);
    o.start(t); o.stop(t + dur + 0.05);
  }

  const SOUNDS = {
    // Chinche que entra en el corcho: golpe seco grave y un clic metálico corto
    pin(out, t) {
      tone(out, t, 0.07, "sine", 190, 70, 0.7);
      burst(out, t, 0.025, "highpass", 3500, 0.7, 0.5);
      tone(out, t + 0.004, 0.03, "triangle", 2600, 1900, 0.12);
    },
    // Papel que se apoya: roce suave de ruido filtrado que baja de tono
    paper(out, t) {
      const f = burst(out, t, 0.16, "bandpass", 2600, 0.9, 0.35, 0.03);
      f.frequency.exponentialRampToValueAtTime(900, t + 0.16);
    },
    // Cinta que se despega y se pega: chasquidos rápidos y un roce final
    tape(out, t) {
      for (let i = 0; i < 7; i++) burst(out, t + i * 0.022 + Math.random() * 0.008, 0.018, "bandpass", 3000 + Math.random() * 1500, 2, 0.35);
      burst(out, t + 0.16, 0.08, "lowpass", 1800, 0.7, 0.3, 0.01);
    },
    // «Tic» de lápiz al tachar una tarea
    tick(out, t) {
      tone(out, t, 0.035, "triangle", 2200, 1500, 0.25);
      burst(out, t, 0.02, "highpass", 5000, 0.7, 0.18);
    },
    // Papelera: papel que se hace una bola (crujidos densos e irregulares sobre un siseo agudo) y se arroja («fsss» que baja)
    trash(out, t) {
      const dur = 0.35;
      for (let i = 0; i < 40; i++) {
        const at = t + Math.pow(Math.random(), 0.8) * dur;
        burst(out, at, 0.004 + Math.random() * 0.012, "bandpass", 1800 + Math.random() * 5000, 0.8 + Math.random() * 1.5, 0.15 + Math.random() * 0.45, 0.001);
      }
      burst(out, t, dur, "highpass", 2500, 0.5, 0.1, 0.08);
      const w = burst(out, t + dur, 0.18, "bandpass", 3000, 0.8, 0.2, 0.04);
      w.frequency.exponentialRampToValueAtTime(800, t + dur + 0.18);
    },
  };

  const Sound = {
    enabled() { return window.getPref?.("sounds") === "1"; },
    volume() {
      const v = parseInt(window.getPref?.("soundVol") ?? "50", 10);
      return Number.isFinite(v) ? Math.min(100, Math.max(0, v)) / 100 : 0.5;
    },
    // force: suena aunque estén apagados (vista previa en Ajustes)
    play(name, force) {
      if ((!force && !Sound.enabled()) || !SOUNDS[name]) return;
      const vol = Sound.volume();
      if (!vol) return;
      // Sin ráfagas: el mismo sonido no se repite en menos de 80 ms y no más de 4 sonidos por medio segundo
      const now = performance.now();
      if (now - (last[name] || 0) < 80) return;
      recent = recent.filter(x => now - x < 500);
      if (recent.length >= 4) return;
      last[name] = now; recent.push(now);
      try {
        const ac = audio();
        if (!ac) return;
        const out = ac.createGain();
        out.gain.value = vol * vol * 0.6; // curva cuadrática: el control se siente más parejo
        out.connect(ac.destination);
        SOUNDS[name](out, ac.currentTime + 0.005);
      } catch (e) {}
    },
  };

  window.Sound = Sound;
})();
