/**
 * tour.js - makes the guided tour usable on a phone, and binds it to the scale ladder.
 *
 * THE PROBLEM THIS SOLVES
 * -----------------------
 * The page ships a good 12-stop tour, but on a phone the card is the viewport.
 * Two concrete failures, both reported from real devices:
 *
 *   1. On long stops the text pushed the Back/Next buttons off the bottom of the
 *      screen entirely. There was no way to advance.
 *   2. The card covered the object it was describing, so you read about the
 *      Milky Way while looking at something else.
 *
 * The fix is to stop making the card and the view compete for the same screen,
 * and alternate between them instead:
 *
 *   * The card becomes a bottom sheet with a STICKY footer, so Back/Next are
 *     always on screen no matter how long the text is, and the text scrolls.
 *   * A peek bar at the top of the sheet carries the step, the title and its own
 *     Next button. Collapsed, only that bar remains and the scene is fully
 *     visible - and you can still advance from it.
 *   * Pressing Next collapses the sheet, flies the camera, and re-opens it on
 *     arrival. You watch the move, then read about where you landed.
 *
 * It also rewrites each stop's camera behaviour to drive the scale ladder, so
 * "You are here" actually shows the solar system and "the Local Group" actually
 * shows the Local Group, rather than flying to a distance in Mpc/h.
 */

const CSS = `
  body.touring #tour {
    position: fixed; left: 0; right: 0; bottom: 0; top: auto;
    width: auto; max-width: none; margin: 0;
    max-height: min(64vh, 560px);
    display: flex; flex-direction: column; gap: 0;
    padding: 0; overflow: hidden;
    border-radius: 18px 18px 0 0;
    transition: transform .34s cubic-bezier(.22,.61,.36,1);
    padding-bottom: env(safe-area-inset-bottom, 0px);
  }
  body.touring.um-peek #tour { transform: translateY(calc(100% - var(--um-peek, 62px) - env(safe-area-inset-bottom, 0px))); }

  #tour .um-peekbar {
    flex: 0 0 auto; min-height: var(--um-peek, 62px);
    display: flex; align-items: center; gap: 10px;
    padding: 10px 14px; cursor: pointer;
    border-bottom: 1px solid var(--edge);
    background: rgba(8,15,36,0.5);
  }
  #tour .um-grab {
    position: absolute; top: 6px; left: 50%; transform: translateX(-50%);
    width: 38px; height: 4px; border-radius: 2px; background: var(--edge);
  }
  #tour .um-peektext { flex: 1 1 auto; min-width: 0; }
  #tour .um-peekstep { font: 500 10px/1.2 var(--font-mono); letter-spacing: .09em;
                       text-transform: uppercase; color: var(--gold); }
  #tour .um-peektitle { font-family: var(--font-display); font-size: 15px; line-height: 1.2;
                        color: var(--fg); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  #tour .um-chev { flex: 0 0 auto; opacity: .7; transition: transform .3s; }
  body.touring.um-peek #tour .um-chev { transform: rotate(180deg); }

  #tour .um-body { flex: 1 1 auto; overflow-y: auto; -webkit-overflow-scrolling: touch;
                   padding: 12px 16px 4px; overscroll-behavior: contain; }
  #tour .nav {
    flex: 0 0 auto; position: sticky; bottom: 0; z-index: 2;
    display: flex; align-items: center; gap: 8px;
    padding: 10px 14px calc(12px + env(safe-area-inset-bottom, 0px));
    border-top: 1px solid var(--edge);
    background: linear-gradient(180deg, rgba(8,15,36,0.0), rgba(8,15,36,0.86) 38%);
  }
  #tour .nav .dots { flex: 1 1 auto; }
  #tour .nav .btn { flex: 0 0 auto; min-height: 42px; padding: 0 16px; }
  #tour .um-peekbar .btn { min-height: 38px; padding: 0 14px; }
  #tour #tourClose { top: 10px; right: 10px; z-index: 3; }

  /* Desktop keeps the floating card, but gains the sticky footer and the peek toggle. */
  @media (min-width: 761px) {
    body.touring #tour {
      left: auto; right: 24px; bottom: 24px; width: min(420px, 38vw);
      border-radius: 14px; max-height: min(72vh, 680px);
    }
    body.touring.um-peek #tour { transform: translateY(calc(100% - var(--um-peek, 62px) - 24px)); }
  }
  @media (prefers-reduced-motion: reduce) { body.touring #tour { transition: none; } }
`;

const CHEV = '<svg class="um-chev" width="16" height="16" viewBox="0 0 16 16" fill="none" '
  + 'stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" '
  + 'aria-hidden="true"><path d="M4 10l4-4 4 4"/></svg>';

/**
 * @param {object} opts
 *   setLevel(name)      - drive the scale ladder
 *   levelForStop(i,title) -> level name or null
 *   flyDurationMs       - how long to stay collapsed after Next
 */
export function install(opts = {}) {
  const {
    setLevel = () => {},
    levelForStop = () => null,
    flyDurationMs = 1800,
  } = opts;

  // Guard for non-DOM hosts (the Node smoke test imports this module).
  if (typeof document === 'undefined') return null;
  const $ = (id) => document.getElementById(id);
  const card = $('tour');
  if (!card) return null;

  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  // --- restructure the card: peek bar / scrolling body / sticky footer ------
  const nav = card.querySelector('.nav');
  const close = $('tourClose');
  const body = document.createElement('div');
  body.className = 'um-body';
  // everything that is not the close button or the nav becomes scrollable body
  for (const child of Array.from(card.children)) {
    if (child === nav || child === close) continue;
    body.appendChild(child);
  }

  const bar = document.createElement('div');
  bar.className = 'um-peekbar';
  bar.innerHTML = '<div class="um-grab"></div>'
    + '<div class="um-peektext"><div class="um-peekstep"></div><div class="um-peektitle"></div></div>'
    + CHEV;
  const barNext = document.createElement('button');
  barNext.type = 'button'; barNext.className = 'btn primary'; barNext.id = 'umPeekNext';
  barNext.textContent = 'Next';
  bar.appendChild(barNext);

  card.insertBefore(bar, card.firstChild);
  card.insertBefore(body, nav);

  const barStep = bar.querySelector('.um-peekstep');
  const barTitle = bar.querySelector('.um-peektitle');

  // --- peek / open ---------------------------------------------------------
  let peeked = false;
  function setPeek(on) {
    peeked = on;
    document.body.classList.toggle('um-peek', on);
    bar.setAttribute('aria-expanded', String(!on));
  }
  bar.addEventListener('click', (e) => {
    if (e.target.closest('#umPeekNext')) return;   // the Next button has its own job
    setPeek(!peeked);
  });

  // --- mirror the page's own state into the bar ----------------------------
  const stepEl = $('tourStep'), titleEl = $('tourTitle');
  function sync() {
    const step = stepEl ? stepEl.textContent : '';
    const title = titleEl ? titleEl.textContent : '';
    if (barStep.textContent !== step) barStep.textContent = step;
    if (barTitle.textContent !== title) barTitle.textContent = title;
    const next = $('tourNext');
    const label = next ? next.textContent : '';
    if (barNext.textContent !== label) barNext.textContent = label;
    const atEnd = !!(next && /finish/i.test(label || ''));
    if (barNext.classList.contains('primary') === atEnd) barNext.classList.toggle('primary', !atEnd);
  }
  // Watch the page's own step/title/button, not the whole card. The peek bar
  // lives inside the card, so observing the card retriggers sync() forever.
  const mirror = new MutationObserver(sync);
  for (const el of [stepEl, titleEl, $('tourNext')]) {
    if (el) mirror.observe(el, { childList: true, subtree: true, characterData: true });
  }

  // --- the rhythm: Next collapses, camera moves, card returns --------------
  let timer = null;
  function advanceVisuals() {
    sync();
    const i = currentIndex();
    const lvl = levelForStop(i, titleEl ? titleEl.textContent : '');
    // The page's own go() has already started a flight. Later stops keep that
    // flight (fly:false). Stop 1 must end on the day-side Earth frame, so its
    // flight replaces the page's cosmological one.
    if (lvl) setLevel(lvl, { fly: lvl === 'earth' });
    setPeek(true);                               // get out of the way
    clearTimeout(timer);
    timer = setTimeout(() => setPeek(false), flyDurationMs);   // then come back
  }
  function currentIndex() {
    const m = /(\d+)\s*of\s*(\d+)/i.exec(stepEl ? stepEl.textContent : '');
    return m ? (+m[1] - 1) : 0;
  }

  const realNext = $('tourNext'), realBack = $('tourBack');
  barNext.addEventListener('click', () => { if (realNext) realNext.click(); });
  for (const b of [realNext, realBack]) {
    if (b) b.addEventListener('click', () => setTimeout(advanceVisuals, 0));
  }

  // first paint, and whenever the tour opens
  new MutationObserver(() => {
    if (!card.hidden) { sync(); setTimeout(advanceVisuals, 0); }
  }).observe(card, { attributes: true, attributeFilter: ['hidden'] });

  sync();
  return {
    card, bar,
    setPeek,
    isPeeked: () => peeked,
    sync,
    currentIndex,
    dispose() { style.remove(); clearTimeout(timer); },
  };
}
