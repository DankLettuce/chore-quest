/*! Space Explorers celebrate.js — vanilla, no dependencies.
 *  Celebrate.check(element)          -> pop + rocket launch + star/planet confetti (~1.2s)
 *  Celebrate.allDone({ title, sub, button, onClose, autoCloseMs }) -> full-screen "All done!" with trophy + fireworks
 *  Celebrate.configure({ sound: "sound/check.mp3", soundFallback: "sound/check.wav", volume: .6, muted: false })
 *  Respects prefers-reduced-motion (no flying pieces; a soft glow + static overlay instead).
 */
(function (global) {
  "use strict";
  var INK = "#10183A";
  var COLORS = ["#FFD23F", "#FF7A1A", "#19C3C8", "#6BDB4B", "#8B5CF6", "#4D8BFF"];
  var cfg = { sound: null, soundFallback: null, volume: 0.6, muted: false };
  var audio = null;

  function reduced() { return global.matchMedia && global.matchMedia("(prefers-reduced-motion: reduce)").matches; }
  function rand(a, b) { return a + Math.random() * (b - a); }
  function pick(a) { return a[(Math.random() * a.length) | 0]; }
  function starPts(r) {
    var p = [];
    for (var i = 0; i < 10; i++) { var a = Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.48 : r; p.push((50 + rr * Math.cos(a)).toFixed(1) + "," + (50 - rr * Math.sin(a)).toFixed(1)); }
    return p.join(" ");
  }
  var SHAPES = {
    star: function (c) { return '<svg viewBox="0 0 100 100"><polygon points="' + starPts(46) + '" fill="' + c + '" stroke="' + INK + '" stroke-width="7" stroke-linejoin="round"/></svg>'; },
    planet: function (c) { return '<svg viewBox="0 0 100 100"><ellipse cx="50" cy="52" rx="46" ry="12" fill="none" stroke="' + INK + '" stroke-width="12" transform="rotate(-18 50 52)"/><circle cx="50" cy="50" r="26" fill="' + c + '" stroke="' + INK + '" stroke-width="7"/><ellipse cx="50" cy="52" rx="46" ry="12" fill="none" stroke="#fff" stroke-width="5" stroke-dasharray="60 200" stroke-dashoffset="-70" transform="rotate(-18 50 52)"/></svg>'; },
    dot: function (c) { return '<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="' + c + '" stroke="' + INK + '" stroke-width="10"/></svg>'; }
  };
  var ROCKET = '<svg viewBox="-160 -260 320 600"><path d="M-82 30 L-146 150 L-136 210 L-76 168Z" fill="#FF7A1A"/><path d="M82 30 L146 150 L136 210 L76 168Z" fill="#FF7A1A"/>' +
    '<path d="M-56 186 Q0 400 56 186Z" fill="#FFD23F" stroke="#FF7A1A" stroke-width="18"/><path d="M-54 160 L-44 194 L44 194 L54 160Z" fill="#9AA8C8"/>' +
    '<path d="M0 -250 C80 -180 100 -60 80 160 L-80 160 C-100 -60 -80 -180 0 -250Z" fill="#F5F7FF"/><path d="M0 -250 C40 -215 62 -170 74 -120 L-74 -120 C-62 -170 -40 -215 0 -250Z" fill="#FF7A1A"/>' +
    '<circle cx="0" cy="-20" r="46" fill="#19C3C8"/><g fill="none" stroke="' + INK + '" stroke-width="18" stroke-linejoin="round"><path d="M-82 30 L-146 150 L-136 210 L-76 168Z"/><path d="M82 30 L146 150 L136 210 L76 168Z"/><path d="M0 -250 C80 -180 100 -60 80 160 L-80 160 C-100 -60 -80 -180 0 -250Z"/><circle cx="0" cy="-20" r="46"/></g></svg>';
  var TROPHY = '<svg viewBox="0 0 128 128" class="cel-done__trophy" aria-hidden="true"><g stroke="' + INK + '" stroke-width="6" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M34 34 C14 34 12 62 40 70" fill="none" stroke-width="8"/><path d="M94 34 C114 34 116 62 88 70" fill="none" stroke-width="8"/>' +
    '<path d="M30 18 H98 V46 C98 70 82 84 64 84 C46 84 30 70 30 46Z" fill="#FFD23F"/><rect x="56" y="82" width="16" height="16" fill="#E8A100"/>' +
    '<rect x="34" y="96" width="60" height="22" rx="6" fill="#FF7A1A"/><polygon points="64.0,29.0 59.2,39.4 47.8,40.7 56.2,48.5 54.0,59.8 64.0,54.2 74.0,59.8 71.8,48.5 80.2,40.7 68.8,39.4" fill="#fff" stroke-width="4"/>' +
    '<path d="M40 26 V44" stroke="#fff" stroke-width="6" opacity=".85"/></g></svg>';

  function layer() {
    var l = document.createElement("div"); l.className = "cel-layer"; l.setAttribute("aria-hidden", "true");
    document.body.appendChild(l); return l;
  }
  function el(parent, cls, html, size) {
    var d = document.createElement("div"); d.className = cls; if (html) d.innerHTML = html;
    if (size) { d.style.width = size + "px"; d.style.height = size + "px"; }
    parent.appendChild(d); return d;
  }

  function burst(l, x, y, n, spread, dur) {
    for (var i = 0; i < n; i++) {
      var kind = i % 5 === 0 ? "planet" : i % 3 === 0 ? "dot" : "star";
      var s = kind === "dot" ? rand(10, 16) : rand(22, 36);
      var p = el(l, "cel-piece", SHAPES[kind](pick(COLORS)), s);
      var ang = rand(0, Math.PI * 2), dist = rand(spread * 0.45, spread);
      var dx = Math.cos(ang) * dist, dy = Math.sin(ang) * dist - spread * 0.25;
      var rot = rand(-260, 260);
      p.animate([
        { transform: "translate(" + (x - s / 2) + "px," + (y - s / 2) + "px) scale(.3) rotate(0deg)", opacity: 1 },
        { transform: "translate(" + (x + dx * 0.85 - s / 2) + "px," + (y + dy * 0.85 - s / 2) + "px) scale(1.15) rotate(" + rot * 0.7 + "deg)", opacity: 1, offset: 0.55 },
        { transform: "translate(" + (x + dx - s / 2) + "px," + (y + dy + spread * 0.35 - s / 2) + "px) scale(.8) rotate(" + rot + "deg)", opacity: 0 }
      ], { duration: dur * rand(0.8, 1), easing: "cubic-bezier(.15,.7,.35,1)", fill: "forwards" });
    }
  }

  function rocket(l, x, y, dur) {
    var w = 46, h = 86, r = el(l, "cel-rocket", ROCKET); r.style.width = w + "px"; r.style.height = h + "px";
    var top = -h - 20, drift = rand(-60, 60);
    r.animate([
      { transform: "translate(" + (x - w / 2) + "px," + (y - h / 2) + "px) scale(.4)", opacity: 0 },
      { transform: "translate(" + (x - w / 2) + "px," + (y - h / 2 - 20) + "px) scale(1) rotate(0deg)", opacity: 1, offset: 0.15 },
      { transform: "translate(" + (x - w / 2 + drift * 0.5) + "px," + ((y + top) / 2) + "px) rotate(" + drift / 6 + "deg)", opacity: 1, offset: 0.55 },
      { transform: "translate(" + (x - w / 2 + drift) + "px," + top + "px) rotate(" + drift / 4 + "deg)", opacity: 1 }
    ], { duration: dur, easing: "cubic-bezier(.5,0,.75,.4)", fill: "forwards" });
    // exhaust puffs
    for (var i = 0; i < 7; i++) {
      (function (i) {
        var pf = el(l, "cel-puff", "", rand(10, 18)); pf.style.opacity = 0;
        var t = i / 7, py = y + 30 - (y - top) * t * t * 0.9, px = x + drift * t * t;
        pf.style.background = i % 2 ? "#FFD23F" : "#FF7A1A";
        pf.animate([{ transform: "translate(" + px + "px," + py + "px) scale(1)", opacity: 0.9 }, { transform: "translate(" + (px + rand(-12, 12)) + "px," + (py + 30) + "px) scale(.2)", opacity: 0 }],
          { duration: 450, delay: dur * t * 0.9, easing: "ease-out", fill: "both" });
      })(i);
    }
  }

  function playSound() {
    if (cfg.muted || !cfg.sound) return;
    try {
      if (!audio) {
        audio = new Audio(); var src = cfg.sound;
        if (cfg.soundFallback && !audio.canPlayType("audio/mpeg") && /\.mp3$/i.test(src)) src = cfg.soundFallback;
        audio.src = src; audio.preload = "auto";
      }
      audio.volume = cfg.volume; audio.currentTime = 0;
      var pr = audio.play(); if (pr && pr.catch) pr.catch(function () {});
    } catch (e) {}
  }

  function check(target, opts) {
    opts = opts || {};
    var dur = opts.duration || 1200;
    playSound();
    var rect = target && target.getBoundingClientRect ? target.getBoundingClientRect() : { left: innerWidth / 2, top: innerHeight / 2, width: 0, height: 0 };
    var ox = opts.originEl ? opts.originEl.getBoundingClientRect() : rect;
    var x = ox.left + ox.width / 2, y = ox.top + ox.height / 2;
    if (target && target.classList) { target.classList.remove("cel-pop"); void target.offsetWidth; target.classList.add("cel-pop");
      setTimeout(function () { target.classList.remove("cel-pop"); }, 700); }
    if (reduced()) return Promise.resolve();
    var l = layer();
    burst(l, x, y, opts.pieces || 18, opts.spread || 150, dur);
    if (opts.rocket !== false) rocket(l, x, y, dur);
    return new Promise(function (res) { setTimeout(function () { l.remove(); res(); }, dur + 150); });
  }

  function allDone(opts) {
    opts = opts || {};
    var ov = document.createElement("div"); ov.className = "cel-done"; ov.setAttribute("role", "dialog"); ov.setAttribute("aria-modal", "true");
    ov.setAttribute("aria-label", opts.title || "All done!");
    ov.innerHTML = '<div class="cel-done__inner">' + TROPHY + '<h2 class="cel-done__title"></h2><p class="cel-done__sub"></p>' +
      '<button class="cel-done__btn" type="button"></button></div>';
    ov.querySelector(".cel-done__title").textContent = opts.title || "All done!";
    ov.querySelector(".cel-done__sub").textContent = opts.sub || "Every chore checked. Blast off!";
    ov.querySelector(".cel-done__btn").textContent = opts.button || "Yay!";
    document.body.appendChild(ov);
    var trophy = ov.querySelector(".cel-done__trophy");
    setTimeout(function () { trophy.classList.add("is-wiggle"); }, 900);
    playSound();
    var l = null, timer = null, closed = false;
    if (!reduced()) {
      l = layer(); l.style.zIndex = 10001;
      var fire = function () {
        var x = rand(innerWidth * 0.12, innerWidth * 0.88), y = rand(innerHeight * 0.12, innerHeight * 0.55);
        burst(l, x, y, 16, rand(110, 170), 1300);
      };
      fire(); fire();
      timer = setInterval(fire, 450);
      setTimeout(function () { clearInterval(timer); }, opts.fireworksMs || 3200);
    }
    function close() {
      if (closed) return; closed = true; clearInterval(timer);
      ov.classList.add("is-closing");
      setTimeout(function () { ov.remove(); if (l) l.remove(); if (opts.onClose) opts.onClose(); }, reduced() ? 0 : 260);
    }
    ov.addEventListener("click", close);
    ov.querySelector(".cel-done__btn").focus({ preventScroll: true });
    if (opts.autoCloseMs) setTimeout(close, opts.autoCloseMs);
    return { close: close };
  }

  global.Celebrate = {
    check: check, allDone: allDone, playSound: playSound,
    configure: function (o) { for (var k in o) cfg[k] = o[k]; audio = null; }
  };
})(window);
