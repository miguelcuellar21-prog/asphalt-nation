/* ═══════════════════════════════════════════════════════════════════
   ASPHALT NATION — Graphics Upgrade Layer v3.0
   Injects on top of the existing Three.js game canvas:
   • Speed-line / motion-blur overlay (more lines, sharper at high speed)
   • Nitro flame particle trail (blue/white at high speed, orange at normal)
   • Road heat-shimmer / reflection shimmer (wider, more visible)
   • Dynamic sky gradient (morning → noon → dusk → night) with stars
   • Screen-shake on near-miss / collision
   • Enhanced headlight cone glow (night only)
   • Rain streaks overlay (randomly triggers)
   • Horizon glow / sun bloom
   All features are self-contained and hook into existing globals.
═══════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  function waitFor(pred, cb) {
    if (pred()) return cb();
    const t = setInterval(() => { if (pred()) { clearInterval(t); cb(); } }, 100);
  }

  waitFor(() => document.getElementById('c'), init);

  function init() {
    const gameCanvas = document.getElementById('c');

    // ─── Overlay canvas (above 3D canvas, below HUD) ───
    const ov = document.createElement('canvas');
    ov.id = 'gfx-overlay';
    ov.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:6;width:100%;height:100%';
    document.body.insertBefore(ov, document.getElementById('hud'));
    const ctx = ov.getContext('2d');

    // ─── Sky canvas (behind 3D canvas) ─────────────────
    const skyEl = document.createElement('canvas');
    skyEl.id = 'sky-layer';
    skyEl.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:0;width:100%;height:100%';
    document.body.insertBefore(skyEl, document.getElementById('c'));
    const skyCtx = skyEl.getContext('2d');

    // ─── Particle pool ──────────────────────────────────
    const MAX_PARTICLES = 180;
    const particles = [];
    for (let i = 0; i < MAX_PARTICLES; i++)
      particles.push({ x:0, y:0, vx:0, vy:0, life:0, maxLife:1, size:2, color:'#ff6600', type:'exhaust' });
    let pHead = 0;

    function spawnParticle(x, y, vx, vy, life, size, color, type) {
      const p = particles[pHead % MAX_PARTICLES];
      Object.assign(p, { x, y, vx, vy, life, maxLife: life, size, color, type });
      pHead++;
    }

    // ─── Screen shake ───────────────────────────────────
    let shakeAmt = 0;
    const shakeDecay = 0.82;

    // ─── Rain state ─────────────────────────────────────
    let rainActive = false;
    let rainTimer = 0;
    let rainToggleIn = 30 + Math.random() * 90;
    const rainDrops = Array.from({length: 80}, () => ({
      x: Math.random(),
      y: Math.random(),
      speed: 0.4 + Math.random() * 0.6,
      len: 0.04 + Math.random() * 0.07,
      alpha: 0.15 + Math.random() * 0.25
    }));

    window.GFX = {
      shake: (intensity) => { shakeAmt = Math.max(shakeAmt, intensity); },
      spawnExplosion: (x, y) => {
        for (let i = 0; i < 22; i++) {
          const ang = Math.random() * Math.PI * 2;
          const spd = 1.5 + Math.random() * 4;
          const cols = ['#ff4400','#ffaa00','#ffff88','#ff2200','#ffffff'];
          spawnParticle(x, y, Math.cos(ang)*spd, Math.sin(ang)*spd,
            0.5 + Math.random()*0.5, 3 + Math.random()*6,
            cols[Math.floor(Math.random()*cols.length)], 'spark');
        }
      }
    };

    // ─── Speed lines ─────────────────────────────────────
    const SPEED_LINE_COUNT = 36;
    const speedLines = Array.from({length: SPEED_LINE_COUNT}, makeSpeedLine);
    function makeSpeedLine() {
      return {
        x: Math.random(),
        y: 0.08 + Math.random() * 0.84,
        len: 0.03 + Math.random() * 0.10,
        speed: 0.010 + Math.random() * 0.022,
        alpha: 0.06 + Math.random() * 0.22,
        width: 0.4 + Math.random() * 1.2
      };
    }

    // ─── Sky palette ──────────────────────────────────────
    const skyPalette = [
      ['#0a0520','#1a0840'],['#0a0520','#1a0840'],['#0a0520','#1a0840'],['#0a0520','#1a0840'],
      ['#0d0730','#200d50'],['#1a0c3a','#5a2070'],['#3d1c5a','#c0504a'],['#ff7a2a','#ffcc88'],
      ['#1a6ab0','#7ec8f0'],['#1155aa','#6ab8e8'],['#0d4a99','#55aadd'],['#0d4a99','#55aadd'],
      ['#0d4a99','#55aadd'],['#0d4a99','#55aadd'],['#0d4a99','#55aadd'],['#1a5ab0','#5aaddd'],
      ['#1a5ab0','#5aaddd'],['#f05a10','#ffcc44'],['#c0300a','#ff8040'],['#6a1a40','#c05050'],
      ['#2a1040','#4a1040'],['#150830','#2a1045'],['#0a0520','#1a0840'],['#0a0520','#1a0840'],
    ];

    let hour = new Date().getHours();
    let skyTimer = 0;

    // ─── Road shimmer ────────────────────────────────────
    const shimmerLines = Array.from({length: 8}, () => ({
      phase: Math.random() * Math.PI * 2,
      speed: 0.5 + Math.random() * 1.0
    }));

    // ─── Helpers ─────────────────────────────────────────
    function hexToRgb(hex) {
      return { r: parseInt(hex.slice(1,3),16), g: parseInt(hex.slice(3,5),16), b: parseInt(hex.slice(5,7),16) };
    }
    function lerpColor(a, b, t) {
      const ca = hexToRgb(a), cb = hexToRgb(b);
      return `rgb(${Math.round(ca.r+(cb.r-ca.r)*t)},${Math.round(ca.g+(cb.g-ca.g)*t)},${Math.round(ca.b+(cb.b-ca.b)*t)})`;
    }

    function getGameSpeed() {
      try {
        if (typeof speed !== 'undefined' && speed > 0) return Math.min(speed / 80, 1);
        if (typeof gameSpeed !== 'undefined') return Math.min(gameSpeed / 80, 1);
        if (typeof G !== 'undefined' && G && G.speed) return Math.min(G.speed / 80, 1);
        return 0.35;
      } catch(e) { return 0.35; }
    }

    function isGamePlaying() {
      try {
        const go = document.getElementById('go');
        const ts = document.getElementById('ts');
        const ps2 = document.getElementById('ps2');
        return (!go || go.classList.contains('off')) &&
               (!ts || ts.classList.contains('off')) &&
               (!ps2 || ps2.classList.contains('off'));
      } catch(e) { return true; }
    }

    // ─── Main render loop ─────────────────────────────────
    let last = 0, time = 0;

    function render(ts) {
      requestAnimationFrame(render);
      const dt = Math.min((ts - last) / 1000, 0.05);
      last = ts;
      time += dt;

      const W = window.innerWidth, H = window.innerHeight;
      if (ov.width !== W || ov.height !== H) { ov.width = W; ov.height = H; }
      if (skyEl.width !== W || skyEl.height !== H) { skyEl.width = W; skyEl.height = H; }

      ctx.clearRect(0, 0, W, H);

      const spd = getGameSpeed();
      const playing = isGamePlaying();

      // ── Sky gradient ────────────────────────────────────
      skyTimer += dt;
      if (skyTimer > 60) { hour = new Date().getHours(); skyTimer = 0; }
      const nextHour = (hour + 1) % 24;
      const frac = new Date().getMinutes() / 60;
      const p0 = skyPalette[hour], p1 = skyPalette[nextHour];
      const skyGrad = skyCtx.createLinearGradient(0, 0, 0, H);
      skyGrad.addColorStop(0, lerpColor(p0[0], p1[0], frac));
      skyGrad.addColorStop(0.55, lerpColor(p0[1], p1[1], frac));
      skyGrad.addColorStop(1, '#080808');
      skyCtx.fillStyle = skyGrad;
      skyCtx.fillRect(0, 0, W, H);

      // ── Horizon sun/moon glow ───────────────────────────
      {
        const isDay = hour >= 6 && hour <= 18;
        const glowY = H * (isDay ? 0.42 : 0.38);
        const glowColor = (hour >= 6 && hour <= 9) || (hour >= 16 && hour <= 19)
          ? 'rgba(255,160,40,' : (isDay ? 'rgba(255,240,160,' : 'rgba(200,220,255,');
        const hg = skyCtx.createRadialGradient(W/2, glowY, 0, W/2, glowY, H * 0.28);
        hg.addColorStop(0, glowColor + '0.22)');
        hg.addColorStop(1, 'transparent');
        skyCtx.fillStyle = hg;
        skyCtx.fillRect(0, 0, W, H);
      }

      // ── Stars ────────────────────────────────────────────
      const nightF = (hour >= 20 || hour <= 5) ? 1 :
                     (hour <= 7 ? (7 - hour) / 2 : (hour >= 19 ? (hour - 19) : 0));
      if (nightF > 0.05) {
        ctx.save();
        for (let i = 0; i < 80; i++) {
          const sx = (i * 137.508 + 20) % W;
          const sy = (i * 89.3 + 10) % (H * 0.52);
          const twinkle = 0.35 + 0.65 * Math.sin(time * (0.7 + i * 0.12) + i);
          ctx.globalAlpha = Math.min(nightF, 1) * twinkle * 0.75;
          ctx.fillStyle = i % 5 === 0 ? '#ffffd0' : '#ffffff';
          ctx.beginPath();
          ctx.arc(sx, sy, 0.6 + (i % 4) * 0.35, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }

      if (!playing) return;

      // ── Rain ──────────────────────────────────────────────
      rainTimer += dt;
      if (rainTimer >= rainToggleIn) {
        rainActive = !rainActive;
        rainToggleIn = rainActive ? (20 + Math.random() * 40) : (60 + Math.random() * 120);
        rainTimer = 0;
        const veil = document.getElementById('weather-veil');
        if (veil) {
          veil.style.background = rainActive ? 'rgba(100,130,180,0.12)' : 'transparent';
          veil.style.opacity = rainActive ? '1' : '0';
        }
      }
      if (rainActive) {
        ctx.save();
        ctx.strokeStyle = 'rgba(180,210,255,0.55)';
        ctx.lineWidth = 1;
        for (const rd of rainDrops) {
          rd.y += rd.speed * dt * 0.9;
          rd.x -= rd.speed * dt * 0.12;
          if (rd.y > 1) { rd.y = -rd.len; rd.x = Math.random(); }
          const x1 = rd.x * W, y1 = rd.y * H;
          const x2 = x1 - rd.len * W * 0.08, y2 = y1 + rd.len * H;
          ctx.globalAlpha = rd.alpha * (0.6 + 0.4 * Math.sin(time * 3 + rd.x * 10));
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
        ctx.restore();
      }

      // ── Road shimmer ──────────────────────────────────────
      const shimmerIntensity = 0.25 + spd * 0.65;
      ctx.save();
      for (let i = 0; i < shimmerLines.length; i++) {
        const sl = shimmerLines[i];
        sl.phase += dt * sl.speed;
        const shimY = H * 0.60 + i * (H * 0.055);
        const shimW = W * (0.35 + 0.45 * Math.abs(Math.sin(sl.phase)));
        const shimX = W * 0.5 - shimW / 2 + Math.sin(sl.phase * 0.7) * W * 0.07;
        const alpha = shimmerIntensity * (0.025 + 0.055 * Math.abs(Math.sin(sl.phase * 1.4)));
        const g = ctx.createLinearGradient(shimX, 0, shimX + shimW, 0);
        g.addColorStop(0, 'transparent');
        g.addColorStop(0.5, `rgba(210,230,255,${alpha.toFixed(3)})`);
        g.addColorStop(1, 'transparent');
        ctx.fillStyle = g;
        ctx.fillRect(shimX, shimY - 1, shimW, 2 + i * 0.6);
      }
      ctx.restore();

      // ── Speed lines ────────────────────────────────────────
      if (spd > 0.18) {
        ctx.save();
        const lineAlpha = Math.pow(Math.max(0, (spd - 0.18) / 0.82), 1.4);
        for (const sl of speedLines) {
          sl.x -= sl.speed * spd * 2.5;
          if (sl.x + sl.len < 0) {
            sl.x = 1.0 + Math.random() * 0.25;
            sl.y = 0.08 + Math.random() * 0.84;
            sl.len = 0.03 + Math.random() * 0.10;
          }
          const x1 = sl.x * W, x2 = (sl.x + sl.len) * W, y = sl.y * H;
          const alpha = lineAlpha * sl.alpha;
          const grad = ctx.createLinearGradient(x1, y, x2, y);
          grad.addColorStop(0, 'rgba(255,255,255,0)');
          grad.addColorStop(0.5, `rgba(255,255,255,${alpha.toFixed(3)})`);
          grad.addColorStop(1, 'rgba(255,255,255,0)');
          ctx.strokeStyle = grad;
          ctx.lineWidth = sl.width;
          ctx.beginPath();
          ctx.moveTo(x1, y);
          ctx.lineTo(x2, y);
          ctx.stroke();
        }
        ctx.restore();
      }

      // ── Exhaust / Nitro particles ───────────────────────
      if (spd > 0.25 && Math.random() < spd * 0.9) {
        const cx = W * 0.5 + (Math.random() - 0.5) * W * 0.045;
        const cy = H * 0.73;
        const isNitro = spd > 0.72;
        const colors = isNitro
          ? ['#00ddff','#0099ff','#ffffff','#aae8ff']
          : ['#ff5500','#ff8800','#ffaa00','#ff3300'];
        const count = isNitro ? 2 : 1;
        for (let k = 0; k < count; k++) {
          spawnParticle(
            cx + (Math.random()-0.5)*W*0.02, cy,
            (Math.random() - 0.5) * 1.4,
            -(0.9 + Math.random() * 2.8) * spd,
            0.22 + Math.random() * 0.38,
            isNitro ? 3 + Math.random()*7 : 2 + Math.random()*4.5,
            colors[Math.floor(Math.random() * colors.length)],
            isNitro ? 'nitro' : 'exhaust'
          );
        }
      }

      // ── Draw particles ──────────────────────────────────
      ctx.save();
      for (const p of particles) {
        if (p.life <= 0) continue;
        p.life -= dt;
        p.x += p.vx * W * 0.001;
        p.y += p.vy * H * 0.002;
        p.vy += 0.06;
        const t2 = Math.max(0, p.life / p.maxLife);
        ctx.globalAlpha = t2 * (p.type === 'nitro' ? 0.9 : 0.72);
        ctx.fillStyle = p.color;
        const r = p.size * t2;
        if (p.type === 'nitro') {
          ctx.beginPath();
          ctx.ellipse(p.x, p.y, r * 0.45, r * 2.0, Math.PI / 2, 0, Math.PI * 2);
          ctx.fill();
          // inner bright core
          ctx.globalAlpha = t2 * 0.5;
          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.ellipse(p.x, p.y, r * 0.2, r * 0.9, Math.PI / 2, 0, Math.PI * 2);
          ctx.fill();
        } else if (p.type === 'spark') {
          ctx.beginPath();
          ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
          ctx.fill();
        } else {
          const gr = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
          gr.addColorStop(0, p.color);
          gr.addColorStop(1, 'transparent');
          ctx.fillStyle = gr;
          ctx.beginPath();
          ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
      ctx.restore();

      // ── Speed vignette ──────────────────────────────────
      if (spd > 0.35) {
        ctx.save();
        const vigAlpha = Math.pow((spd - 0.35) / 0.65, 2) * 0.62;
        const vig = ctx.createRadialGradient(W/2, H/2, H*0.25, W/2, H/2, Math.max(W,H)*0.78);
        vig.addColorStop(0, 'transparent');
        vig.addColorStop(1, `rgba(0,0,20,${vigAlpha.toFixed(3)})`);
        ctx.fillStyle = vig;
        ctx.fillRect(0, 0, W, H);
        ctx.restore();
      }

      // ── Screen shake ────────────────────────────────────
      if (shakeAmt > 0.5) {
        const sx = (Math.random() - 0.5) * shakeAmt * 2.2;
        const sy = (Math.random() - 0.5) * shakeAmt * 2.2;
        gameCanvas.style.transform = `translate(${sx}px,${sy}px)`;
        shakeAmt *= shakeDecay;
        if (shakeAmt < 0.5) { shakeAmt = 0; gameCanvas.style.transform = ''; }
      }

      // ── Headlight cone (night) ───────────────────────────
      if (hour >= 19 || hour <= 6) {
        ctx.save();
        const cx2 = W * 0.5, cy2 = H * 0.71;
        const hl = 0.07 + 0.045 * Math.sin(time * 0.6);
        const hlGrad = ctx.createRadialGradient(cx2, cy2, 0, cx2, cy2 - H*0.18, H * 0.42);
        hlGrad.addColorStop(0, `rgba(255,255,210,${hl})`);
        hlGrad.addColorStop(0.45, `rgba(210,220,255,${(hl*0.3).toFixed(3)})`);
        hlGrad.addColorStop(1, 'transparent');
        ctx.fillStyle = hlGrad;
        ctx.beginPath();
        ctx.ellipse(cx2, cy2, W * 0.20, H * 0.42, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }

    requestAnimationFrame(render);

    // ── Patch swipe-flash → screen shake ────────────────
    const bodyObs = new MutationObserver(() => {
      const flash = document.getElementById('swipe-flash');
      if (flash && !flash._gfxPatched) {
        flash._gfxPatched = true;
        new MutationObserver((muts) => {
          muts.forEach(m => {
            if (m.attributeName === 'style' && parseFloat(flash.style.opacity || 0) > 0)
              window.GFX.shake(7);
          });
        }).observe(flash, { attributes: true });
      }
    });
    bodyObs.observe(document.body, { childList: true, subtree: true });
  }
})();
