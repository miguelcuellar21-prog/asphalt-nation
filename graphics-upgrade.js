/* ═══════════════════════════════════════════════════════════════════
   ASPHALT NATION — Graphics Upgrade Layer v2.0
   Injects on top of the existing Three.js game canvas:
   • Speed-line / motion-blur overlay
   • Nitro flame particle trail behind the player car
   • Road heat-shimmer / reflection shimmer
   • Dynamic sky gradient (morning → noon → dusk → night)
   • Screen-shake on near-miss / collision
   • Enhanced headlight cone glow
   All features are self-contained and hook into existing globals.
═══════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  // ─── Wait for game canvas to be ready ────────────────────────────
  function waitFor(pred, cb) {
    if (pred()) return cb();
    const t = setInterval(() => { if (pred()) { clearInterval(t); cb(); } }, 100);
  }

  waitFor(() => document.getElementById('c'), init);

  function init() {
    const gameCanvas = document.getElementById('c');

    // ─── Create overlay canvas (sits above 3D canvas, below HUD) ───
    const ov = document.createElement('canvas');
    ov.id = 'gfx-overlay';
    ov.style.cssText = [
      'position:fixed', 'inset:0', 'pointer-events:none',
      'z-index:6', 'width:100%', 'height:100%'
    ].join(';');
    document.body.insertBefore(ov, document.getElementById('hud'));
    const ctx = ov.getContext('2d');

    // ─── Sky gradient canvas (behind 3D canvas) ─────────────────────
    const skyEl = document.createElement('canvas');
    skyEl.id = 'sky-layer';
    skyEl.style.cssText = [
      'position:fixed', 'inset:0', 'pointer-events:none',
      'z-index:0', 'width:100%', 'height:100%'
    ].join(';');
    document.body.insertBefore(skyEl, document.getElementById('c'));
    const skyCtx = skyEl.getContext('2d');

    // ─── Particle pool ──────────────────────────────────────────────
    const MAX_PARTICLES = 120;
    const particles = [];
    for (let i = 0; i < MAX_PARTICLES; i++) {
      particles.push({ x:0, y:0, vx:0, vy:0, life:0, maxLife:1, size:2, color:'#ff6600', type:'exhaust' });
    }
    let pHead = 0;

    function spawnParticle(x, y, vx, vy, life, size, color, type) {
      const p = particles[pHead % MAX_PARTICLES];
      p.x = x; p.y = y; p.vx = vx; p.vy = vy;
      p.life = life; p.maxLife = life;
      p.size = size; p.color = color; p.type = type;
      pHead++;
    }

    // ─── Screen shake state ─────────────────────────────────────────
    let shakeAmt = 0;
    let shakeDecay = 0.85;

    // Expose shake trigger globally so game code can call it
    window.GFX = {
      shake: (intensity) => { shakeAmt = Math.max(shakeAmt, intensity); },
      spawnExplosion: (x, y) => {
        for (let i = 0; i < 18; i++) {
          const ang = Math.random() * Math.PI * 2;
          const spd = 1.5 + Math.random() * 3;
          const cols = ['#ff4400','#ffaa00','#ffff88','#ff2200'];
          spawnParticle(x, y, Math.cos(ang)*spd, Math.sin(ang)*spd,
            0.6 + Math.random()*0.4, 3 + Math.random()*5,
            cols[Math.floor(Math.random()*cols.length)], 'spark');
        }
      }
    };

    // ─── Speed-line state ───────────────────────────────────────────
    const SPEED_LINE_COUNT = 28;
    const speedLines = [];
    for (let i = 0; i < SPEED_LINE_COUNT; i++) {
      speedLines.push(makeSpeedLine());
    }
    function makeSpeedLine() {
      return {
        x: Math.random(),
        y: 0.1 + Math.random() * 0.8,
        len: 0.04 + Math.random() * 0.08,
        speed: 0.012 + Math.random() * 0.02,
        alpha: 0.08 + Math.random() * 0.18,
        width: 0.5 + Math.random() * 1
      };
    }

    // ─── Sky palette (hour 0–23) ────────────────────────────────────
    const skyPalette = [
      // [topHex, bottomHex]
      ['#0a0520','#1a0840'], // 0 midnight
      ['#0a0520','#1a0840'],
      ['#0a0520','#1a0840'],
      ['#0a0520','#1a0840'],
      ['#0d0730','#200d50'], // 4 pre-dawn
      ['#1a0c3a','#5a2070'],
      ['#3d1c5a','#c0504a'], // 6 sunrise
      ['#ff7a2a','#ffcc88'], // 7 golden hour
      ['#1a6ab0','#7ec8f0'], // 8 morning
      ['#1155aa','#6ab8e8'],
      ['#0d4a99','#55aadd'],
      ['#0d4a99','#55aadd'],
      ['#0d4a99','#55aadd'], // 12 noon
      ['#0d4a99','#55aadd'],
      ['#0d4a99','#55aadd'],
      ['#1a5ab0','#5aaddd'],
      ['#1a5ab0','#5aaddd'],
      ['#f05a10','#ffcc44'], // 17 dusk
      ['#c0300a','#ff8040'], // 18 sunset
      ['#6a1a40','#c05050'], // 19
      ['#2a1040','#4a1040'], // 20 twilight
      ['#150830','#2a1045'],
      ['#0a0520','#1a0840'], // 22
      ['#0a0520','#1a0840'],
    ];

    let hour = new Date().getHours();
    let skyTimer = 0;

    // ─── Road shimmer lines ─────────────────────────────────────────
    const shimmerLines = [];
    for (let i = 0; i < 6; i++) {
      shimmerLines.push({ phase: Math.random() * Math.PI * 2, speed: 0.6 + Math.random() * 0.8 });
    }

    // ─── Helpers ────────────────────────────────────────────────────
    function hexToRgb(hex) {
      const r = parseInt(hex.slice(1,3),16);
      const g = parseInt(hex.slice(3,5),16);
      const b = parseInt(hex.slice(5,7),16);
      return {r,g,b};
    }
    function lerpColor(a, b, t) {
      const ca = hexToRgb(a), cb = hexToRgb(b);
      return `rgb(${Math.round(ca.r+(cb.r-ca.r)*t)},${Math.round(ca.g+(cb.g-ca.g)*t)},${Math.round(ca.b+(cb.b-ca.b)*t)})`;
    }

    // ─── Get speed from game globals (safe) ─────────────────────────
    function getGameSpeed() {
      try {
        // Try common variable names the game might use
        if (typeof speed !== 'undefined') return Math.min(speed / 80, 1);
        if (typeof gameSpeed !== 'undefined') return Math.min(gameSpeed / 80, 1);
        if (typeof G !== 'undefined' && G.speed) return Math.min(G.speed / 80, 1);
        return 0.4; // fallback
      } catch(e) { return 0.4; }
    }

    function isGamePlaying() {
      try {
        const go = document.getElementById('go');
        const ts = document.getElementById('ts');
        const ps2 = document.getElementById('ps2');
        if (!go || !ts) return true;
        const goOff = go.classList.contains('off');
        const tsOff = ts.classList.contains('off');
        const psOff = !ps2 || ps2.classList.contains('off');
        return goOff && tsOff && psOff;
      } catch(e) { return true; }
    }

    // ─── Main render loop ───────────────────────────────────────────
    let last = 0;
    let time = 0;

    function render(ts) {
      requestAnimationFrame(render);
      const dt = Math.min((ts - last) / 1000, 0.05);
      last = ts;
      time += dt;

      const W = window.innerWidth;
      const H = window.innerHeight;

      if (ov.width !== W || ov.height !== H) { ov.width = W; ov.height = H; }
      if (skyEl.width !== W || skyEl.height !== H) { skyEl.width = W; skyEl.height = H; }

      ctx.clearRect(0, 0, W, H);

      const spd = getGameSpeed();
      const playing = isGamePlaying();

      // ── Sky gradient ──────────────────────────────────────────────
      skyTimer += dt;
      if (skyTimer > 60) { hour = new Date().getHours(); skyTimer = 0; }
      const nextHour = (hour + 1) % 24;
      const frac = (new Date().getMinutes()) / 60;
      const p0 = skyPalette[hour];
      const p1 = skyPalette[nextHour];
      const skyTop = lerpColor(p0[0], p1[0], frac);
      const skyBot = lerpColor(p0[1], p1[1], frac);
      const skyGrad = skyCtx.createLinearGradient(0, 0, 0, H);
      skyGrad.addColorStop(0, skyTop);
      skyGrad.addColorStop(0.55, skyBot);
      skyGrad.addColorStop(1, '#0a0a0a');
      skyCtx.fillStyle = skyGrad;
      skyCtx.fillRect(0, 0, W, H);

      // ── Stars (night only) ───────────────────────────────────────
      const nightFactor = Math.max(0, 1 - Math.abs(hour - 1) / 4);
      if (nightFactor > 0.1) {
        ctx.save();
        for (let i = 0; i < 60; i++) {
          const sx = ((i * 137.508 + 20) % W);
          const sy = ((i * 89.3 + 10) % (H * 0.55));
          const twinkle = 0.4 + 0.6 * Math.sin(time * (0.8 + i * 0.1));
          ctx.globalAlpha = nightFactor * twinkle * 0.7;
          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.arc(sx, sy, 0.7 + (i % 3) * 0.4, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }

      if (!playing) return;

      // ── Road shimmer ─────────────────────────────────────────────
      const shimmerIntensity = 0.3 + spd * 0.5;
      ctx.save();
      for (let i = 0; i < shimmerLines.length; i++) {
        const sl = shimmerLines[i];
        sl.phase += dt * sl.speed;
        const shimY = H * 0.62 + i * (H * 0.06);
        const shimW = W * (0.3 + 0.4 * Math.abs(Math.sin(sl.phase)));
        const shimX = W * 0.5 - shimW / 2 + Math.sin(sl.phase * 0.7) * W * 0.08;
        const alpha = shimmerIntensity * (0.03 + 0.05 * Math.abs(Math.sin(sl.phase * 1.3)));
        const g = ctx.createLinearGradient(shimX, 0, shimX + shimW, 0);
        g.addColorStop(0, 'transparent');
        g.addColorStop(0.5, `rgba(200,220,255,${alpha.toFixed(3)})`);
        g.addColorStop(1, 'transparent');
        ctx.fillStyle = g;
        ctx.fillRect(shimX, shimY - 1, shimW, 2 + i * 0.5);
      }
      ctx.restore();

      // ── Speed lines ───────────────────────────────────────────────
      if (spd > 0.2) {
        ctx.save();
        const lineAlpha = Math.pow((spd - 0.2) / 0.8, 1.5);
        for (let i = 0; i < speedLines.length; i++) {
          const sl = speedLines[i];
          sl.x -= sl.speed * spd * 2.2;
          if (sl.x + sl.len < 0) {
            sl.x = 1.0 + Math.random() * 0.2;
            sl.y = 0.1 + Math.random() * 0.8;
            sl.len = 0.04 + Math.random() * 0.08;
          }
          const x1 = sl.x * W;
          const x2 = (sl.x + sl.len) * W;
          const y = sl.y * H;
          const alpha = lineAlpha * sl.alpha;
          const grad = ctx.createLinearGradient(x1, y, x2, y);
          grad.addColorStop(0, `rgba(255,255,255,0)`);
          grad.addColorStop(0.5, `rgba(255,255,255,${alpha.toFixed(3)})`);
          grad.addColorStop(1, `rgba(255,255,255,0)`);
          ctx.strokeStyle = grad;
          ctx.lineWidth = sl.width;
          ctx.beginPath();
          ctx.moveTo(x1, y);
          ctx.lineTo(x2, y);
          ctx.stroke();
        }
        ctx.restore();
      }

      // ── Nitro / exhaust particles (behind player car center) ─────
      if (spd > 0.3 && Math.random() < spd * 0.8) {
        const cx = W * 0.5 + (Math.random() - 0.5) * W * 0.04;
        const cy = H * 0.72;
        const isNitro = spd > 0.75;
        const colors = isNitro
          ? ['#00ccff','#0088ff','#ffffff','#aaddff']
          : ['#ff5500','#ff8800','#ffaa00','#ff3300'];
        spawnParticle(
          cx, cy,
          (Math.random() - 0.5) * 1.2,
          -(0.8 + Math.random() * 2.5) * spd,
          0.25 + Math.random() * 0.35,
          isNitro ? (3 + Math.random() * 6) : (2 + Math.random() * 4),
          colors[Math.floor(Math.random() * colors.length)],
          isNitro ? 'nitro' : 'exhaust'
        );
      }

      // Update & draw particles
      ctx.save();
      for (let i = 0; i < MAX_PARTICLES; i++) {
        const p = particles[i];
        if (p.life <= 0) continue;
        p.life -= dt;
        p.x += p.vx * W * 0.001;
        p.y += p.vy * H * 0.002;
        p.vy += 0.05; // slight gravity
        const t2 = Math.max(0, p.life / p.maxLife);
        ctx.globalAlpha = t2 * (p.type === 'nitro' ? 0.85 : 0.7);
        ctx.fillStyle = p.color;
        const r = p.size * t2;
        if (p.type === 'nitro') {
          // draw elongated streak
          ctx.beginPath();
          ctx.ellipse(p.x, p.y, r * 0.5, r * 1.8, Math.PI / 2, 0, Math.PI * 2);
          ctx.fill();
        } else if (p.type === 'spark') {
          ctx.beginPath();
          ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
          ctx.fill();
        } else {
          // soft round blob
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

      // ── Speed vignette (edges darken at high speed) ───────────────
      if (spd > 0.4) {
        ctx.save();
        const vigAlpha = Math.pow((spd - 0.4) / 0.6, 2) * 0.55;
        const vig = ctx.createRadialGradient(W/2, H/2, H*0.3, W/2, H/2, Math.max(W,H)*0.75);
        vig.addColorStop(0, 'transparent');
        vig.addColorStop(1, `rgba(0,0,20,${vigAlpha.toFixed(3)})`);
        ctx.fillStyle = vig;
        ctx.fillRect(0, 0, W, H);
        ctx.restore();
      }

      // ── Screen shake ─────────────────────────────────────────────
      if (shakeAmt > 0.5) {
        const sx = (Math.random() - 0.5) * shakeAmt * 2;
        const sy = (Math.random() - 0.5) * shakeAmt * 2;
        document.getElementById('c').style.transform = `translate(${sx}px,${sy}px)`;
        shakeAmt *= shakeDecay;
        if (shakeAmt < 0.5) {
          shakeAmt = 0;
          document.getElementById('c').style.transform = '';
        }
      }

      // ── Headlight cone glow at night ─────────────────────────────
      if (hour >= 19 || hour <= 6) {
        ctx.save();
        const cx2 = W * 0.5;
        const cy2 = H * 0.70;
        const hlGrad = ctx.createRadialGradient(cx2, cy2, 0, cx2, cy2 - H*0.15, H * 0.4);
        const hl = 0.06 + 0.04 * Math.sin(time * 0.5);
        hlGrad.addColorStop(0, `rgba(255,255,200,${hl})`);
        hlGrad.addColorStop(0.5, `rgba(200,210,255,${hl*0.3})`);
        hlGrad.addColorStop(1, 'transparent');
        ctx.fillStyle = hlGrad;
        ctx.beginPath();
        ctx.ellipse(cx2, cy2, W * 0.18, H * 0.4, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }

    requestAnimationFrame(render);

    // ── Hook near-miss shake into existing collision logic ────────
    // Patch the swipe-flash element click to also trigger shake
    const origBody = document.body;
    const observer = new MutationObserver(() => {
      const flash = document.getElementById('swipe-flash');
      if (flash && !flash._gfxPatched) {
        flash._gfxPatched = true;
        const flashObs = new MutationObserver((muts) => {
          muts.forEach(m => {
            if (m.attributeName === 'style') {
              const op = parseFloat(flash.style.opacity || 0);
              if (op > 0) window.GFX.shake(6);
            }
          });
        });
        flashObs.observe(flash, { attributes: true });
      }
    });
    observer.observe(origBody, { childList: true, subtree: true });
  }
})();
