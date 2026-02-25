/**
 * hero-chrome.js — Mouse-tracked reflections + page-wide glint sweep
 * 
 * WHAT IT DOES:
 *   1. Tracks mouse position and maps it to reflection coordinates
 *      on all .bar elements within the #brow container
 *   2. Runs a page-wide glint beam that sweeps across ALL elements
 *      with .bar or .chrome-glint class (including nav CTA)
 *   3. Starts idle drift animation after 3s of no mouse movement
 *
 * DEPENDS ON:
 *   - CSS custom properties: --rx, --ry, --rx2, --ry2, --sx, --sy,
 *     --ref-opacity, --beam-offset-x, --beam-offset-y, --beam-pos
 *   - DOM: #brow container, .bar elements, .chrome-glint elements
 */

(function() {
  'use strict';

  const row = document.getElementById('brow');
  if (!row) return; // No hero on this page

  const bars = document.querySelectorAll('.bar');
  if (!bars.length) return;

  let ticking = false;
  let mx = window.innerWidth * 0.38;
  let my = window.innerHeight * 0.3;

  // ---- Mouse reflection tracking ----
  function update() {
    const rowRect = row.getBoundingClientRect();
    const globalX = (mx - rowRect.left) / rowRect.width;
    const globalY = (my - rowRect.top) / rowRect.height;

    bars.forEach(function(b) {
      const r = b.getBoundingClientRect();
      const bL = (r.left - rowRect.left) / rowRect.width;
      const bR = (r.right - rowRect.left) / rowRect.width;
      const bT = (r.top - rowRect.top) / rowRect.height;
      const bB = (r.bottom - rowRect.top) / rowRect.height;
      const lx = ((globalX - bL) / (bR - bL)) * 100;
      const ly = ((globalY - bT) / (bB - bT)) * 100;

      b.style.setProperty('--rx', lx + '%');
      b.style.setProperty('--ry', ly + '%');
      b.style.setProperty('--rx2', (100 - lx * 0.4) + '%');
      b.style.setProperty('--ry2', (100 - ly * 0.3) + '%');
      b.style.setProperty('--sx', (lx * 0.9 + 5) + '%');
      b.style.setProperty('--sy', (ly * 0.85) + '%');

      const d = Math.abs(lx - 50) / 50;
      b.style.setProperty('--ref-opacity', Math.max(0.2, 1 - d * 0.5).toFixed(2));
    });
    ticking = false;
  }

  document.addEventListener('mousemove', function(e) {
    mx = e.clientX;
    my = e.clientY;
    if (!ticking) { requestAnimationFrame(update); ticking = true; }
  });

  document.addEventListener('touchmove', function(e) {
    if (e.touches.length) {
      mx = e.touches[0].clientX;
      my = e.touches[0].clientY;
      if (!ticking) { requestAnimationFrame(update); ticking = true; }
    }
  }, { passive: true });


  // ---- Page-wide glint sweep ----
  var SWEEP = 7000;  // ms to cross viewport
  var PAUSE = 6000;  // ms between sweeps
  var OVER  = 300;   // px overshoot past edges
  var sweepStart = null;
  var pausing = false;
  var pauseStart = null;

  function glint(ts) {
    if (pausing) {
      if (!pauseStart) pauseStart = ts;
      if (ts - pauseStart >= PAUSE) {
        pausing = false;
        pauseStart = null;
        sweepStart = null;
      }
      requestAnimationFrame(glint);
      return;
    }

    if (!sweepStart) sweepStart = ts;
    var raw = Math.min((ts - sweepStart) / SWEEP, 1);

    // Quadratic ease-in-out
    var t = raw < 0.5
      ? 2 * raw * raw
      : 1 - Math.pow(-2 * raw + 2, 2) / 2;

    var total = window.innerWidth + OVER * 2;
    var px = -OVER + t * total;

    // Update ALL chrome elements (bars + nav CTA + any future chrome elements)
    document.querySelectorAll('.bar, .chrome-glint').forEach(function(el) {
      var r = el.getBoundingClientRect();
      el.style.setProperty('--beam-offset-x', r.left.toFixed(0));
      el.style.setProperty('--beam-offset-y', r.top.toFixed(0));
      el.style.setProperty('--beam-pos', px.toFixed(0));
    });

    if (raw >= 1) pausing = true;
    requestAnimationFrame(glint);
  }

  requestAnimationFrame(glint);


  // ---- Idle drift ----
  var idleTimer;
  var angle = 0;
  var isIdle = false;
  var rowCache = row.getBoundingClientRect();

  window.addEventListener('resize', function() {
    rowCache = row.getBoundingClientRect();
  });

  function drift() {
    if (!isIdle) return;
    angle += 0.004;
    mx = rowCache.left + rowCache.width * (0.5 + Math.sin(angle) * 0.65);
    my = rowCache.top + rowCache.height * (0.4 + Math.cos(angle * 0.4) * 0.2);
    if (!ticking) { requestAnimationFrame(update); ticking = true; }
    requestAnimationFrame(drift);
  }

  function resetIdle() {
    isIdle = false;
    clearTimeout(idleTimer);
    rowCache = row.getBoundingClientRect();
    idleTimer = setTimeout(function() {
      isIdle = true;
      drift();
    }, 3000);
  }

  document.addEventListener('mousemove', resetIdle);
  idleTimer = setTimeout(function() { isIdle = true; drift(); }, 3000);

  // Initial render
  update();
})();