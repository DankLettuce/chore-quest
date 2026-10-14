// Runs before anything else (classic, blocking). Keeps the family key in the address bar,
// because iOS "Add to Home Screen" saves the current page URL, and points the manifest at a
// version whose start_url carries the key. iOS home-screen apps don't share Safari's storage.
(function () {
  try {
    var RE = /^[A-Za-z0-9_-]{24,64}$/;
    var q = new URLSearchParams(location.search);
    var k = q.get('k');
    if (k && RE.test(k)) {
      localStorage.setItem('chores.key', k);
    } else {
      k = localStorage.getItem('chores.key');
      if (k && RE.test(k)) { q.set('k', k); history.replaceState(null, '', location.pathname + '?' + q.toString()); } else k = null;
    }
    var l = document.createElement('link');
    l.rel = 'manifest'; l.id = 'manifest-link';
    l.href = '/manifest.webmanifest' + (k ? '?k=' + encodeURIComponent(k) : '');
    document.head.appendChild(l);
  } catch (e) { /* storage blocked: app.js shows the setup screen */ }
})();
