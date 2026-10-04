// Gives the Director and Betsee Desk their own look on the shared Betsee login. Every login URL
// names its client; for these two the page gets data-look="director", and every rule in
// css/director.css is scoped to html[data-look="director"], so other clients (the ecosystem, its
// act 5 step-up) keep the theme exactly as it is. The Desk gets the bare form; only the Director
// gets the side panel. If this script does not run, the page simply keeps the default Betsee look.
(function () {
  var client = new URLSearchParams(window.location.search).get('client_id');
  if (client !== 'betsee-director' && client !== 'betsee-desk') return;

  var html = document.documentElement;
  html.setAttribute('data-client', client);
  html.setAttribute('data-look', 'director');

  // The Director is a light interface; PatternFly's dark mode follows the OS, so keep it off here.
  // Guarded: classList.remove rewrites the class attribute even when the token is absent, which
  // Firefox reports as a mutation, so an unguarded remove re-triggers this observer forever.
  var keepLight = function () {
    if (html.classList.contains('pf-v5-theme-dark')) html.classList.remove('pf-v5-theme-dark');
  };
  keepLight();
  new MutationObserver(keepLight).observe(html, { attributes: true, attributeFilter: ['class'] });
  if (client === 'betsee-desk') return;

  var icon = function (path) {
    return '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' + path + '</svg>';
  };
  // The Betsee mark (docs/design/brand/betsee-mark.svg), 0..100 viewBox.
  var MARK =
    '<svg viewBox="0 0 100 100" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M46.67 92.36C46.49 92.33 45.79 92.26 45.12 92.19C35.66 91.27 26.61 87.42 18.88 81.05C17.18 79.64 13.51 75.89 12.11 74.12C6.90 67.55 3.16 59.57 2.10 52.76C1.88 51.33 1.88 51.23 2.14 51.81C2.55 52.69 4.01 54.76 5.06 55.93C8.55 59.83 15.24 64.30 22.50 67.60C26.87 69.59 32.91 71.56 38.41 72.79C44.12 74.07 50.69 74.75 53.59 74.35C55.74 74.06 57.02 73.66 58.87 72.69C61.48 71.33 63.15 70.21 65.25 68.40C69.33 64.88 72.19 60.11 73.18 55.15C73.47 53.73 73.53 50.64 73.30 49.09C72.70 44.99 70.86 41.47 67.64 38.24C65.11 35.71 62.09 33.73 58.89 32.52L57.90 32.15L58.78 31.96C61.56 31.35 65.45 31.24 68.58 31.69C72.71 32.29 76.49 33.55 80.94 35.80C88.62 39.69 94.32 44.88 96.71 50.19C97.97 52.98 98.36 55.73 97.86 58.37C97.73 59.07 97.52 59.97 97.39 60.37C95.52 66.17 90.73 73.20 84.98 78.57C79.11 84.04 72.51 87.83 64.53 90.31C62.36 90.98 59.12 91.66 56.21 92.05C54.40 92.29 53.60 92.34 50.55 92.37C48.60 92.38 46.86 92.38 46.67 92.36ZM48.31 68.57C45.59 68.31 42.56 67.17 40.40 65.58C39.19 64.69 37.53 63.01 36.67 61.81C34.70 59.06 33.59 55.32 33.79 52.08C33.95 49.51 34.44 47.58 35.44 45.63C36.26 44.05 37.01 43.03 38.35 41.68C41.48 38.55 45.52 36.82 50.11 36.67C51.60 36.62 52.11 36.65 53.26 36.85C55.74 37.27 57.67 38.04 59.76 39.43C64.97 42.90 67.61 49.34 66.35 55.52C66.04 57.05 65.80 57.75 65.03 59.32C63.47 62.53 60.99 65.05 57.83 66.67C55.24 68.00 53.36 68.49 50.50 68.62C49.86 68.65 48.88 68.62 48.31 68.57ZM20.39 60.18C19.34 59.44 15.96 57.28 13.57 55.81C7.88 52.30 5.46 50.25 4.15 47.83C2.93 45.55 2.83 42.83 3.86 39.65C4.67 37.16 7.18 32.81 10.23 28.60C13.80 23.68 18.37 19.30 23.29 16.09C29.44 12.08 36.33 9.39 43.57 8.20C48.21 7.43 54.16 7.38 59.04 8.09C66.91 9.22 74.82 12.52 81.27 17.35C84.24 19.57 85.61 20.80 88.27 23.64C90.56 26.08 92.55 28.57 94.10 30.92C95.27 32.71 95.79 33.58 96.56 35.08C98.05 38.00 98.05 37.99 96.78 36.64C94.75 34.49 91.75 32.09 88.93 30.37C81.26 25.70 72.06 24.02 62.59 25.55C55.54 26.69 45.74 29.95 39.52 33.22C36.50 34.81 33.15 36.94 30.87 38.73C29.36 39.91 27.35 41.38 25.66 42.53C21.57 45.31 17.74 47.07 14.12 47.85C13.20 48.05 12.60 48.10 11.24 48.10C10.29 48.10 9.31 48.05 9.05 47.98C8.79 47.91 8.58 47.90 8.58 47.94C8.58 47.99 8.86 48.42 9.20 48.90C11.93 52.72 16.03 56.80 20.31 59.96C21.18 60.61 21.44 60.83 21.30 60.81C21.29 60.81 20.88 60.52 20.39 60.18Z"/></svg>';
  var PULSE = '<path d="m9 7.539l6 14L18.66 13H23v-2h-5.66L15 16.461l-6-14L5.34 11H1v2h5.66z"/>';
  var ORG =
    '<path d="M15 3a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1h-2v2h4a1 1 0 0 1 1 1v3h2a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1h-6a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1h2v-2H8v2h2a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1h2v-3a1 1 0 0 1 1-1h4V9H9a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM9 17H5v2h4zm10 0h-4v2h4zM14 5h-4v2h4z"/>';
  var SCALE =
    '<path d="m12.999 2l-.001 1.278l5 1.668l3.633-1.21l.632 1.896l-3.031 1.011l3.095 8.512A5.98 5.98 0 0 1 17.998 17a5.98 5.98 0 0 1-4.328-1.845l3.094-8.512l-3.766-1.256V19h4v2h-10v-2h4V5.387L7.232 6.643l3.095 8.512A5.98 5.98 0 0 1 6 17a5.98 5.98 0 0 1-4.33-1.845l3.095-8.512l-3.03-1.01l.632-1.898L6 4.945l4.999-1.667V2zm5 7.103L16.58 13h2.835zm-12 0L4.58 13h2.835z"/>';

  // Requests wander in (a model can phrase anything), cross the deterministic gate, and leave as
  // straight lines in their outcome's colour: the Director's own picture, drawn once, animated by SVG.
  var lanes = [40, 92, 144, 196];
  var outcomes = [
    { y: 46, color: '#14a05a' },
    { y: 98, color: '#e28a0c' },
    { y: 150, color: '#8a52c7' },
    { y: 202, color: '#e0484e' },
  ];
  var wave = function (y0, phase) {
    var d = '';
    for (var i = 0; i <= 40; i++) {
      var t = i / 40;
      var x = 10 + 180 * t;
      var ease = t * t * (3 - 2 * t);
      var y = y0 + (121 - y0) * ease + 9 * Math.pow(1 - t, 1.3) * Math.sin(t * 20 + phase);
      d += (i ? ' L ' : 'M ') + x.toFixed(1) + ' ' + y.toFixed(1);
    }
    return d;
  };
  var fan = function (y) {
    return 'M 290 121 C 330 121, 340 ' + y + ', 390 ' + y;
  };
  var svg = '<svg class="dx-boundary" viewBox="0 0 400 242" aria-hidden="true">';
  lanes.forEach(function (y, i) {
    svg += '<path d="' + wave(y, i * 1.4) + '" fill="none" stroke="rgba(255,255,255,0.28)" stroke-width="1.4" stroke-dasharray="2 4"/>';
    svg += '<circle cx="10" cy="' + y + '" r="5" fill="#ffffff" opacity="0.85"/>';
  });
  outcomes.forEach(function (o) {
    svg += '<path d="' + fan(o.y) + '" fill="none" stroke="' + o.color + '" stroke-opacity="0.55" stroke-width="2"/>';
    svg += '<circle cx="390" cy="' + o.y + '" r="5" fill="' + o.color + '"/>';
  });
  svg += '<rect x="190" y="61" width="100" height="120" rx="18" fill="rgba(255,255,255,0.08)" stroke="rgba(255,255,255,0.22)"/>';
  svg += '<g transform="translate(226 103) scale(1.5)" fill="#ffffff" opacity="0.9">' + SCALE + '</g>';
  lanes.forEach(function (y, i) {
    var o = outcomes[(i + 1) % outcomes.length];
    var path = wave(y, i * 1.4) + ' L 290 121 ' + fan(o.y).replace('M 290 121', '');
    // A negative begin starts each dot part-way along, so none waits at the origin before it moves.
    svg +=
      '<circle r="4.5" fill="' + o.color + '"><animateMotion dur="' + (3.2 + i * 0.5) + 's" begin="-' + (i * 0.8 + 0.3) + 's" repeatCount="indefinite" path="' + path + '"/></circle>';
  });
  svg += '</svg>';

  var feature = function (path, title, body) {
    return '<li><span class="dx-feature-icon">' + icon(path) + '</span><span><strong>' + title + '</strong><span>' + body + '</span></span></li>';
  };

  var copy = {
    name: 'Director',
    eyebrow: 'Security officers and org admins',
    headline: 'Every agent action, decided by policy and explained.',
    body: 'Watch your agents act, see who launched them, and open any decision down to the control that made it.',
    features: [
      [PULSE, 'Live', 'Every decision as it happens'],
      [ORG, 'Org chart', 'People and the agents they run'],
      [SCALE, 'Deterministic', 'AI may only make it stricter'],
    ],
  };

  document.addEventListener('DOMContentLoaded', function () {
    var login = document.querySelector('.pf-v5-c-login');
    if (!login) return;
    var panel = document.createElement('aside');
    panel.className = 'dx-panel';
    panel.setAttribute('aria-hidden', 'true');
    panel.innerHTML =
      '<div class="dx-aura"><span></span><span></span><span></span></div>' +
      '<div class="dx-brand"><span class="dx-logo">' + MARK + '</span><span><strong>' + copy.name + '</strong><span>Betsee</span></span></div>' +
      '<div class="dx-copy"><h2>' + copy.headline + '</h2><p>' + copy.body + '</p></div>' +
      svg +
      '<ul class="dx-features">' +
      copy.features
        .map(function (f) {
          return feature(f[0], f[1], f[2]);
        })
        .join('') +
      '</ul>';
    login.insertBefore(panel, login.firstChild);
    var eyebrow = document.createElement('p');
    eyebrow.className = 'dx-eyebrow';
    eyebrow.textContent = copy.eyebrow;
    var title = document.getElementById('kc-page-title');
    if (title && title.parentNode) title.parentNode.insertBefore(eyebrow, title);
  });
})();
