/* Device and viewport behavior, kept separate from the editor controller. */
(() => {
  const root = document.documentElement;
  const coarse = window.matchMedia('(pointer: coarse)');
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const compact = window.matchMedia('(max-width: 650px)');
  function update() {
    root.classList.toggle('device-touch', coarse.matches);
    root.classList.toggle('device-compact', compact.matches);
    root.classList.toggle('device-reduced-motion', reduced.matches);
    root.classList.toggle('device-macos', /Macintosh|Mac OS X/.test(navigator.userAgent));
  }
  for (const query of [coarse, reduced, compact]) query.addEventListener?.('change', update);
  update();
})();
