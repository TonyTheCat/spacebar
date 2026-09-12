/**
 * page-tools-synth — a typed tool list, synthesized from a page's live DOM.
 *
 * A classic script on purpose. It defines one global and imports nothing, so the same
 * file works in every place a synthesizer is needed:
 *
 *   <script src="synthesize.js">          a page, or an example
 *   content_scripts: ["synthesize.js"]    an MV3 content script (no ESM there)
 *   new Function(src)()                   injected into a page you do not control
 *   import { synthesizeTools }            via src/index.mjs, which loads this file
 *
 * Splitting it into modules would read better and break three of those four, and this
 * package has no build step to paper over the difference.
 *
 * Types live in ./types.d.ts — see the note at the top of that file for why.
 */

/** @param {typeof globalThis} global */
(function (global) {
  'use strict';

  /* ============================ text ============================ */

  /** @param {string | null | undefined} s */
  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();

  /** @param {string} s @param {number} n */
  const cut = (s, n) => ((s || '').length > n ? s.slice(0, n - 1) + '…' : s || '');

  /**
   * CSS generated content, which is where an icon-only control often keeps its label.
   * Private-use codepoints are icon-font glyphs, not words, so they are dropped.
   * @param {Element} el
   */
  const pseudo = (el) => {
    let out = '';
    for (const p of ['::before', '::after']) {
      let c = '';
      try {
        c = getComputedStyle(el, p).content;
      } catch {
        continue;
      }
      if (!c || c === 'none' || c === 'normal') continue;
      c = c.replace(/^["']|["']$/g, '');
      if (/[\p{L}\p{N}]/u.test(c) && !/[-]/.test(c)) out += ' ' + c;
    }
    return out;
  };

  /* ============================ visibility ============================
   * This filter is the reason the tool list is not fiction. On one airline home page it
   * discarded fourteen <form> elements — sign-in, sign-up, a chat box, a reservation
   * lookup — every one of them present in the DOM and none of them on screen. A naive
   * querySelectorAll('form') reports those as the page's API.
   */

  /** @param {Element} el */
  const isVisible = (el) => {
    if (!el || !el.isConnected) return false;
    if (el.closest('[aria-hidden="true"],[hidden],[inert]')) return false;
    let cs;
    try {
      cs = getComputedStyle(el);
    } catch {
      return false;
    }
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.visibility === 'collapse') {
      return false;
    }
    if (parseFloat(cs.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    const t = ('type' in el ? String(el.type) : '').toLowerCase();
    // A checkbox or radio is routinely 0×0 with a styled label on top of it.
    if (r.width < 1 && r.height < 1 && t !== 'radio' && t !== 'checkbox') return false;
    return true;
  };

  /* ============================ roles ============================ */

  /** @type {Record<string, string>} */
  const INPUT_ROLE = {
    button: 'button',
    submit: 'button',
    reset: 'button',
    image: 'button',
    checkbox: 'checkbox',
    radio: 'radio',
    range: 'slider',
    number: 'spinbutton',
    text: 'textbox',
    email: 'textbox',
    tel: 'textbox',
    url: 'textbox',
    password: 'textbox',
    search: 'searchbox',
    file: 'file',
    color: 'color',
    date: 'date',
    'datetime-local': 'date',
    month: 'date',
    week: 'date',
    time: 'date',
  };

  /** Does this anchor go anywhere?
   *
   * href, or the xlink:href that an SVG carries — and a map exported from drawing software
   * carries only the second. Measured on the instrument's own fixture, which was built with
   * one state spelled each way: the href state was offered as a target and the xlink state
   * was not offered at all, so the SNAP map's states were invisible whatever we did about
   * pressing them.
   *
   * Namespaced first because that is what the attribute IS; the literal name as a fallback,
   * because an SVG written inline in HTML is parsed with the colon in the attribute's name.
   *
   * @param {Element} el */
  const linked = (el) =>
    el.hasAttribute('href') ||
    el.hasAttributeNS('http://www.w3.org/1999/xlink', 'href') ||
    el.hasAttribute('xlink:href');

  /** Where this anchor goes, as a string.
   *
   * An HTML anchor's .href is a string; an SVG anchor's is an SVGAnimatedString, and putting
   * that in a sentence gives somebody "[object SVGAnimatedString]" read out loud. The
   * resolved value when there is one, the attribute as written otherwise.
   *
   * @param {Element} el @returns {string} */
  const hrefOf = (el) => {
    const live = /** @type {{href?: unknown}} */ (/** @type {unknown} */ (el)).href;
    if (typeof live === 'string') return live;
    const animated = /** @type {{baseVal?: unknown}} */ (live);
    if (animated && typeof animated.baseVal === 'string') return animated.baseVal;
    return (
      el.getAttributeNS('http://www.w3.org/1999/xlink', 'href') ||
      el.getAttribute('xlink:href') ||
      el.getAttribute('href') ||
      ''
    );
  };

  /**
   * An explicit `role` wins, always. Sites lie in both directions — `<a role="button">`,
   * `<button role="link">` — and the author's declared intent is the truthful one.
   * @param {Element} el
   */
  const roleOf = (el) => {
    const explicit = (el.getAttribute('role') || '').trim().split(/\s+/)[0];
    if (explicit) return explicit;
    const tag = el.tagName.toLowerCase();
    if (tag === 'button') return 'button';
    if (tag === 'a' || tag === 'area') return linked(el) ? 'link' : 'generic';
    if (tag === 'input') {
      const t = ('type' in el ? String(el.type) : 'text').toLowerCase();
      return INPUT_ROLE[t] || 'textbox';
    }
    if (tag === 'select') {
      const sel = /** @type {HTMLSelectElement} */ (el);
      return sel.multiple || sel.size > 1 ? 'listbox' : 'combobox';
    }
    if (tag === 'textarea') return 'textbox';
    if (tag === 'summary') return 'button';
    if (tag === 'option') return 'option';
    if (/** @type {HTMLElement} */ (el).isContentEditable) return 'textbox';
    return 'generic';
  };

  const NAME_FROM_CONTENT = new Set([
    'button',
    'link',
    'checkbox',
    'radio',
    'option',
    'tab',
    'menuitem',
    'menuitemcheckbox',
    'menuitemradio',
    'switch',
    'treeitem',
    'heading',
    'gridcell',
    'cell',
    'columnheader',
    'rowheader',
    'tooltip',
    'summary',
    'disclosure',
  ]);

  /* ============================ accessible name ============================
   * Computed here, in full, because the platform will not do it. Chrome exposes neither
   * `Element.computedName` nor `Element.computedRole` (checked on 152), and the CDP
   * accessibility tree needs a debugger attachment that paints a banner across the
   * screen. This chain is a pragmatic reading of the accname spec: enough of it to name
   * every real control on two large public sites, and no more.
   */

  /**
   * The text a screen reader would read out of an element's contents.
   * @param {Node | null} node
   * @returns {string}
   */
  const contentText = (node) => {
    if (!node) return '';
    if (node.nodeType === 3) return node.nodeValue || '';
    if (node.nodeType !== 1) return '';
    const el = /** @type {Element} */ (node);
    if (el.getAttribute('aria-hidden') === 'true') return '';
    const tag = el.tagName.toLowerCase();
    if (tag === 'script' || tag === 'style' || tag === 'noscript' || tag === 'template') return '';
    let cs = null;
    try {
      cs = getComputedStyle(el);
    } catch {
      cs = null;
    }
    if (cs && (cs.display === 'none' || cs.visibility === 'hidden')) return '';
    const al = el.getAttribute('aria-label');
    if (al && al.trim()) return ' ' + al + ' ';
    if (tag === 'img') return ' ' + (el.getAttribute('alt') || '') + ' ';
    if (tag === 'input') {
      const t = ('type' in el ? String(el.type) : '').toLowerCase();
      const v = 'value' in el ? String(el.value) : '';
      return /^(button|submit|reset)$/.test(t) ? ' ' + v + ' ' : '';
    }
    if (tag === 'select' || tag === 'textarea') return '';
    if (tag === 'svg') {
      const ti = el.querySelector('title');
      return ti ? ' ' + ti.textContent + ' ' : '';
    }
    let s = pseudo(el);
    for (const ch of Array.from(el.childNodes)) s += contentText(ch);
    return s;
  };

  /**
   * aria-labelledby → aria-label → label[for] / wrapping <label> → the value of a button
   * input → name from content → title → placeholder → alt → whatever text is inside.
   * @param {Element | null} el
   * @returns {string}
   */
  const accessibleName = (el) => {
    if (!el || el.nodeType !== 1) return '';
    const doc = el.ownerDocument;
    const lb = el.getAttribute('aria-labelledby');
    if (lb) {
      const parts = lb
        .split(/\s+/)
        .map((id) => {
          const t = doc.getElementById(id);
          if (!t) return '';
          return clean(t.getAttribute('aria-label') || contentText(t) || t.getAttribute('title'));
        })
        .filter(Boolean);
      if (parts.length) return clean(parts.join(' '));
    }
    const al = el.getAttribute('aria-label');
    if (al && al.trim()) return clean(al);

    const tag = el.tagName.toLowerCase();
    if (/^(input|select|textarea|meter|progress|output)$/.test(tag)) {
      /** @type {Element[]} */
      let labels = [];
      try {
        const own = /** @type {HTMLInputElement} */ (el).labels;
        labels = own ? Array.from(own) : [];
      } catch {
        labels = [];
      }
      if (!labels.length) {
        const anc = el.closest('label');
        if (anc) labels = [anc];
      }
      const lt = clean(labels.map((l) => contentText(l)).join(' '));
      if (lt) return lt;
      if (tag === 'input') {
        const input = /** @type {HTMLInputElement} */ (el);
        const t = (input.type || '').toLowerCase();
        if (/^(button|submit|reset)$/.test(t) && input.value) return clean(input.value);
        if (t === 'image' && input.alt) return clean(input.alt);
      }
    }

    if (NAME_FROM_CONTENT.has(roleOf(el))) {
      const c = clean(contentText(el));
      if (c) return c;
    }
    for (const a of ['title', 'placeholder', 'aria-placeholder', 'alt']) {
      const v = el.getAttribute(a);
      if (v && v.trim()) return clean(v);
    }
    return clean(contentText(el));
  };

  /** aria-describedby, folded into a field's description. @param {Element} el */
  const describedBy = (el) => {
    const d = el.getAttribute('aria-describedby');
    if (!d) return '';
    const doc = el.ownerDocument;
    return clean(
      d
        .split(/\s+/)
        .map((id) => {
          const t = doc.getElementById(id);
          return t ? contentText(t) : '';
        })
        .join(' ')
    );
  };

  /* ============================ identifiers ============================
   * Build a name ONCE from a word list. Camel-casing an already camel-cased string
   * lower-cases the first pass's work: "Trip Type: One-Way" became clickTriptypeoneway.
   */

  /** @param {string} s @returns {string[]} */
  const words = (s) =>
    (s || '')
      .normalize('NFKD')
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .replace(/([a-z\d])([A-Z])/g, '$1 $2')
      .trim()
      .split(/\s+/)
      .filter(Boolean);

  /** @param {string[]} parts @param {number} [maxWords] */
  const camel = (parts, maxWords) => {
    const w = parts.slice(0, maxWords || 5);
    if (!w.length) return '';
    return w
      .map((x, i) => {
        const low = x.toLowerCase();
        return i === 0 ? low : low[0].toUpperCase() + low.slice(1);
      })
      .join('')
      .slice(0, 56);
  };

  /**
   * A verb and the control's label, in one identifier.
   *
   * A label that already opens with the verb is not repeated: the search box on a site
   * labelled "Search" would otherwise be published as `searchSearch`, and a model reading
   * a tool list has to spend attention on that before deciding it means nothing.
   * @param {string} verb @param {string} label @param {number} [maxWords] six by default
   */
  const toolName = (verb, label, maxWords) => {
    const w = words(label);
    if (w.length && w[0].toLowerCase() === verb.toLowerCase()) w.shift();
    const n = camel([verb].concat(w), maxWords || 6);
    return /^[A-Za-z]/.test(n) ? n : 'tool' + n;
  };

  /**
   * For display and debugging. Execution goes through the live element in `refs` —
   * an nth-of-type chain does not survive the next render.
   * @param {Element} el
   */
  const cssPath = (el) => {
    if (el.id && /^[A-Za-z][\w-]*$/.test(el.id)) return '#' + el.id;
    /** @type {string[]} */
    const parts = [];
    /** @type {Element | null} */
    let n = el;
    while (n && n.nodeType === 1 && parts.length < 6) {
      if (n.id && /^[A-Za-z][\w-]*$/.test(n.id)) {
        parts.unshift('#' + n.id);
        break;
      }
      let s = n.tagName.toLowerCase();
      const nm = n.getAttribute('name');
      if (nm && /^[\w:.-]+$/.test(nm)) s += '[name="' + nm + '"]';
      else {
        const p = n.parentElement;
        if (p) {
          const sibs = Array.from(p.children).filter(
            (c) => c.tagName === /** @type {Element} */ (n).tagName
          );
          if (sibs.length > 1) s += ':nth-of-type(' + (sibs.indexOf(n) + 1) + ')';
        }
      }
      parts.unshift(s);
      n = n.parentElement;
    }
    return parts.join(' > ');
  };

  /* ============================ field schemas ============================ */

  /**
   * Plain JSON Schema — no `x-` extensions. Several providers reject unknown keys, and a
   * caller that needs the element has `refs`.
   * @param {Element} el
   * @returns {JSONSchema}
   */
  const fieldSchema = (el) => {
    const role = roleOf(el);
    const tag = el.tagName.toLowerCase();
    const any = /** @type {HTMLInputElement} */ (el);
    const t = (any.type || '').toLowerCase();

    if (role === 'checkbox' || role === 'switch') return { type: 'boolean' };
    if (role === 'spinbutton' || role === 'slider') {
      /** @type {JSONSchema} */
      const s = { type: 'number' };
      if (any.min !== '' && any.min != null) s.minimum = Number(any.min);
      if (any.max !== '' && any.max != null) s.maximum = Number(any.max);
      return s;
    }
    if (tag === 'select') {
      const sel = /** @type {HTMLSelectElement} */ (el);
      const opts = Array.from(sel.options).filter((o) => clean(o.textContent) || o.value);
      // The visible label, not the value: the model is reading the page, and "California"
      // is something it can choose; "CA-06" is not.
      const values = opts
        .map((o) => clean(o.textContent) || o.value)
        .filter(Boolean)
        .slice(0, 40);
      /** @type {JSONSchema} */
      const base = { type: 'string' };
      if (values.length) base.enum = values;
      return sel.multiple ? { type: 'array', items: base } : base;
    }

    /** @type {JSONSchema} */
    const s = { type: 'string' };
    if (t === 'number') s.type = 'number';
    if (t === 'date' || t === 'month' || t === 'week') s.format = 'date';
    if (t === 'time') s.format = 'time';
    if (t === 'datetime-local') s.format = 'date-time';
    if (t === 'email') s.format = 'email';
    if (t === 'url') s.format = 'uri';
    if (any.maxLength > 0 && any.maxLength < 1e6) s.maxLength = any.maxLength;
    if (any.pattern) s.pattern = any.pattern;
    return s;
  };

  /* ============================ synthesis ============================ */

  const ACTIONABLE = new Set([
    'button',
    'tab',
    'menuitem',
    'menuitemcheckbox',
    'menuitemradio',
    'switch',
  ]);
  const FIELDISH = new Set([
    'textbox',
    'searchbox',
    'combobox',
    'listbox',
    'slider',
    'spinbutton',
    'checkbox',
    'radio',
    'date',
    'color',
    'file',
  ]);
  /* a[*|href] as well as a[href]: the star matches the attribute in ANY namespace, which is
   * where an SVG's xlink:href lives. Without it an anchor drawn inside a map is not even a
   * candidate — the map's states were invisible before anything could ask whether they were
   * links. */
  const SELECTOR =
    'a[href],a[*|href],area[href],button,input,select,textarea,summary,' +
    '[contenteditable=""],[contenteditable="true"],[role],[tabindex]';

  /** A consent wall is not the page's API. */
  const NOISE =
    '#onetrust-consent-sdk,#onetrust-banner-sdk,[id*="cookie" i],[class*="cookie-banner" i],' +
    '[class*="consent" i],[id*="consent" i],[aria-label*="cookie" i]';

  /** Site furniture: collapsed into the navigate tool rather than becoming tools. */
  const CHROME = 'nav,footer,header,[role="navigation"],[role="contentinfo"],[role="banner"]';

  /* A link the page itself presents as a BUTTON is not one of thirty sitemap links. It is the
   * page's call to action, and there are one or two of them.
   *
   * Measured, on the page that made this necessary:
   * ssa.gov/prepare/check-eligibility-for-benefits is a page whose whole purpose is one big
   * "Start" — and Start is an anchor styled as a button. Every link collapses into one
   * navigate tool, so it arrived as one label among twenty-four inside "Follow one link on
   * the current page", beside a header search box that had a tool of its own. The model
   * looking for a way to begin found the search box, called it with an empty query, and a
   * person who cannot see the screen was asked "Fill in and submit Search — shall I?" about
   * a page with a Start button on it.
   *
   * The class is the signal because it is the page telling us, in its own markup, that this
   * is a button: usa-button is the US Web Design System's, and btn/button/cta are what
   * everything else writes. role="button" needs nothing here — that already answers 'button'
   * to roleOf and becomes a click tool of its own.
   *
   * Kept deliberately narrow. Emitting a tool per link is the sitemap this file refuses; this
   * is a handful per page, in the main content, and each one is the thing the page was built
   * to have somebody press. */
  const CALL_TO_ACTION = /(?:^|\s)(?:usa-button|btn|button|cta)(?:$|[\s-])/i;

  /** How many of them. More than this and it is a menu of buttons rather than a call to
   *  action, and the collapse is the right answer again. */
  const MAX_CALLS_TO_ACTION = 3;

  /* Which button COMMITS a group of fields.
   *
   * `type !== 'button'` does not survive contact with a component framework. Measured on a
   * live booking widget: the fields' own container had ZERO buttons matching that rule (its
   * only button, "Switch departure and arrival stations", is type=button); the first match
   * appeared two levels up and was "Return Date", a calendar opener; and the real FIND
   * TRAINS button sat four levels up among twelve buttons, ten of which "matched". Taking
   * the first match in the first ancestor labelled the search widget with a date picker and
   * split it across two tools.
   *
   * So candidates are SCORED instead. What a commit button looks like: it says a committing
   * word, or the markup declares it a submit, and it comes after the fields it commits. */
  const COMMIT_WORDS =
    /\b(search|find|submit|apply|continue|go|send|save|book|next|sign ?in|log ?in|register|create|update|confirm|check ?out|pay|subscribe|start|done|finish|add to (cart|basket|bag))\b/i;
  /* No bare "add" here. It was added for "Add Coupon" and "Add travelers and discounts",
   * but both of those declare aria-haspopup and are already vetoed above — while a plain
   * <button type="submit">Add</button> on a notes form, a cart or a task list is a real
   * commit, and vetoing it by name (the veto runs BEFORE the type=submit score) split
   * those forms into loose fields. "add to cart" stays in COMMIT_WORDS. */
  const NOT_COMMIT_WORDS =
    /\b(date|calendar|close|cancel|clear|reset|switch|swap|back|previous|prev|more info|information|help|menu|toggle|remove|delete|edit|filter|sort|share|print|expand|collapse|dismiss|skip)\b/i;

  /** Below this, a button is not treated as committing anything. */
  const COMMIT_THRESHOLD = 3;

  /**
   * The <form> that owns EVERY one of these fields, or null.
   *
   * Null when they are in different forms, or in none: both are cases where HTML's form
   * semantics say nothing, so nothing below may lean on them.
   * @param {Element[]} fields
   */
  const owningForm = (fields) => {
    if (!fields.length) return null;
    const f = /** @type {HTMLInputElement} */ (fields[0]).form || null;
    if (!f) return null;
    return fields.every((el) => /** @type {HTMLInputElement} */ (el).form === f) ? f : null;
  };

  /**
   * @param {Element} btn
   * @param {Element[]} fields Fields the button would commit, for document-order checks.
   */
  const commitScore = (btn, fields) => {
    if (roleOf(btn) !== 'button') return -Infinity;
    if (!isVisible(btn)) return -Infinity;
    const tag = btn.tagName.toLowerCase();
    const any = /** @type {HTMLInputElement} */ (btn);
    const type = (any.type || '').toLowerCase();
    let score = 0;

    /* Two vetoes, and both outrank the markup's own `type`. Measured on one booking
     * widget, where EVERY button is type="submit" and the attribute therefore says
     * nothing:
     *
     *   Advanced Search   aria-haspopup="dialog"   opens a panel
     *   Add Coupon        aria-haspopup="dialog"   opens a panel
     *   1 Traveler …      aria-haspopup="true"     opens a panel
     *   Trip Type:One-Way aria-expanded="false"    expands a region
     *   Return Date       —                        opens a calendar
     *   FIND TRAINS       —                        the only one that commits
     *
     * 1. A button that DECLARES it opens a popup or expands a region is not committing
     *    anything. That is ARIA's own meaning, not a guess about this site, and it picks
     *    FIND TRAINS out of six look-alikes on its own.
     * 2. What is left is judged by name, because a control a person reads as "Return Date"
     *    does not commit a search however it is typed. */
    const haspopup = btn.getAttribute('aria-haspopup');
    if (haspopup && haspopup !== 'false') return -Infinity;
    if (btn.hasAttribute('aria-expanded')) return -Infinity;

    /* A third veto, and it is HTML's own rather than a reading of the label.
     *
     * When the fields live in a <form>, that form's commit has to be something the form
     * can actually be submitted BY — a submit control associated with it. Google's and
     * Bing's microphones are <div role="button"> sitting inside the search form: a div is
     * not a form-associated control, it is not in `form.elements`, and no click on it can
     * submit anything. Measured on both home pages, the mic scored 3 (it comes after the
     * field, which is all a nameless icon can earn) and sat in a NEARER container than the
     * real submit, so `groupContainerOf` stopped at it and named the whole tool after it.
     * An agent then filled the query and started voice input.
     *
     * This has to be a VETO, not a lower score: the container walk stops at the first
     * ancestor with any plausible button, so a mic that merely scores less still wins by
     * being closer.
     *
     * A name test would not survive contact with the world — the same button reads
     * "Búsqueda por voz" from this machine's address — and the platform offers no ARIA for
     * "starts speech input". What it does offer is form association, which is exact.
     *
     * ASSOCIATION ONLY — the button's `type` is deliberately not part of this. Requiring
     * type=submit here vetoes `<button type="button">Log in</button>`, which is the normal
     * React shape precisely BECAUSE it avoids native submission, and it is genuinely the
     * form's commit. A form-associated button of any type goes on to be scored by the name
     * and position rules below, exactly like the buttons in a widget that has no form.
     *
     * Deliberately scoped to fields that HAVE a form. A div-soup widget has none, HTML
     * says nothing about it, and the scoring below still decides — which is why the
     * booking widget still resolves to FIND TRAINS. */
    const form = owningForm(fields);
    if (form && any.form !== form) return -Infinity;

    const nm = accessibleName(btn);
    const saysCommit = COMMIT_WORDS.test(nm);
    if (NOT_COMMIT_WORDS.test(nm) && !saysCommit) return -Infinity;

    if (tag === 'input' && /^(submit|image)$/.test(type)) score += 8;
    else if (tag === 'button' && type === 'submit') score += 8;
    if (type === 'reset') score -= 10;
    if (tag === 'a') score -= 2; // an anchor navigates; it rarely commits

    if (saysCommit) score += 6;

    // A commit button comes after the things it commits.
    const afterAll = fields.every(
      (f) => !!(btn.compareDocumentPosition(f) & Node.DOCUMENT_POSITION_PRECEDING)
    );
    if (afterAll) score += 3;

    return score;
  };

  /**
   * How many ancestors up before `a` and `b` share one. Smaller means nearer.
   * @param {Element} a
   * @param {Element} b
   */
  const distanceTo = (a, b) => {
    /** @type {Element | null} */
    let n = a;
    for (let i = 0; n && i < 24; i++, n = n.parentElement) if (n.contains(b)) return i;
    return 99;
  };

  /**
   * @param {Element} container
   * @param {Element[]} fields
   * @returns {{submit: Element, score: number} | null}
   */
  const bestCommitButton = (container, fields) => {
    const buttons = Array.from(
      container.querySelectorAll('button,input[type=submit],input[type=image],[role="button"]')
    );
    /** @type {{submit: Element, score: number, near: number} | null} */
    let best = null;
    for (const b of buttons) {
      const score = commitScore(b, fields);
      if (score === -Infinity) continue;
      // The container that finally holds both the fields and the real button can hold ten
      // other plausible ones (Sign In, Join, …). Same score, nearest wins.
      const near = fields.length ? Math.min(...fields.map((f) => distanceTo(b, f))) : 99;
      if (!best || score > best.score || (score === best.score && near < best.near)) {
        best = { submit: b, score, near };
      }
    }
    return best ? { submit: best.submit, score: best.score } : null;
  };

  /**
   * Does Enter go INTO this control as text rather than committing it?
   *
   * Only a real multi-line <textarea> takes a newline. The search boxes on Google, Bing
   * and DuckDuckGo are all `<textarea role="combobox">` — the role is the page saying this
   * is not a paragraph field, and Enter there means send.
   * @param {Element} el
   */
  const enterTypesText = (el) => {
    if (el.tagName !== 'TEXTAREA') return false;
    const r = roleOf(el);
    return r !== 'combobox' && r !== 'searchbox';
  };

  /**
   * Does the markup DECLARE this form a search — something that READS?
   *
   * The distinction matters because a search is the one commit a blind person should not
   * have to approve out loud. Asking "shall I?" before every submit is right for a form
   * that sends something; asking it before "search for trains to Berlin" turns one errand
   * into two turns of conversation for a page that only reads.
   *
   * TWO signals, and both are the page saying so ITSELF — never a guess from the words on the
   * button, which changes with the reader's language:
   *   - `role="search"` on the form: the page's own declaration, and what Google ships.
   *   - an `input[type=search]`: the platform's own control for the job.
   *
   * THERE WAS A THIRD, AND IT IS GONE: "a GET form whose only field is one text box", on the
   * grounds that GET is defined as safe and idempotent and a lone query box is the shape of
   * every search on the web. The shape is not the declaration. A benefit finder's step asks
   * one question in a GET form and is indistinguishable from a search box by that rule — so
   * a step that moves somebody through a government process arrived UNGATED, and was pressed
   * without them hearing what was being sent. That is the product's central promise spent to
   * save one turn of conversation.
   *
   * The cost of removing it was measured rather than assumed: usa.gov's own search form
   * carries role="search" AND input[type=search], and google.com carries role="search". The
   * pages this is for declare themselves; the pages that do not were never searches.
   *
   * Two guards sit in front of ALL THREE, not only the third, because either one alone is
   * the page declaring a side effect and no `role` should be able to talk us out of it:
   *   - a POST form is never a search, whatever it calls itself;
   *   - a form carrying a password is never a search, whatever it calls itself. The whole
   *     form is sent on submit, so a password field two divs away is still going out.
   *
   * @param {Element | null} container The cluster's container, or the field's form.
   */
  const declaresSearch = (container) => {
    const form = /** @type {HTMLFormElement | null} */ (
      container && container.tagName === 'FORM' ? container : container && container.closest('form')
    );
    if (!form) return false;
    if ((form.method || 'get').toLowerCase() !== 'get') return false;
    const own = Array.from(form.elements);
    if (own.some((el) => /** @type {HTMLInputElement} */ (el).type === 'password')) return false;
    if (roleOf(form) === 'search') return true;
    return own.some((el) => /** @type {HTMLInputElement} */ (el).type === 'search');
  };

  /**
   * How a person commits a field whose form offers no button: press Enter in it.
   *
   * Measured on bing.com and duckduckgo.com, whose search forms carry no submit control a
   * person can see: `form.requestSubmit()` and a synthetic Enter key sequence BOTH run the
   * real search. `requestSubmit()` is used because it is the platform's own path — it
   * fires a cancelable `submit` event, so a form's own JavaScript handler still runs — and
   * because it does not depend on a page honouring an untrusted key event. The key
   * sequence stays as the fallback for a form that cannot be asked to submit.
   *
   * @param {Element} el The field to commit.
   * @param {HTMLFormElement} form Its form.
   */
  const commitByEnter = (el, form) => () => {
    /** @type {HTMLElement} */ (el).focus();
    if (typeof form.requestSubmit === 'function') {
      try {
        form.requestSubmit();
        return;
      } catch {
        /* Fall through: a form that refuses is still worth an Enter. */
      }
    }
    for (const type of ['keydown', 'keypress', 'keyup']) {
      el.dispatchEvent(
        new KeyboardEvent(type, {
          key: 'Enter',
          code: 'Enter',
          keyCode: 13,
          which: 13,
          bubbles: true,
          cancelable: true,
        })
      );
    }
  };

  /** @param {Element} c */
  const containerLabel = (c) => {
    const lb = c.getAttribute('aria-labelledby');
    if (lb) {
      const t = c.ownerDocument.getElementById(lb.split(/\s+/)[0]);
      if (t) return clean(t.textContent);
    }
    const al = c.getAttribute('aria-label');
    if (al) return clean(al);
    const h = c.querySelector('legend,h1,h2,h3,h4');
    // The heading only. Taking the container's whole text drags the paragraph under the
    // heading into the tool name, mid-word.
    if (h) return clean(h.textContent);
    return '';
  };

  /**
   * The lowest ancestor holding this field AND a button that commits it — the field's
   * "form", whether or not a <form> element exists. This is the rule that turns a modern
   * booking widget into one composite tool: those are div soup, and the page's real
   * <form> elements are usually hidden panels somewhere else entirely.
   * @param {Element} el
   * @param {Element | Document} root
   */
  const groupContainerOf = (el, root) => {
    const stop = root.nodeType === 9 ? /** @type {Document} */ (root).body : root;
    /** @type {Element | null} */
    let c = el.parentElement;
    for (let i = 0; i < 9 && c && c !== stop; i++, c = c.parentElement) {
      const best = bestCommitButton(c, [el]);
      if (!best || best.score < COMMIT_THRESHOLD) continue;
      // Stop at the FIRST container whose best button actually looks like a commit. Walking
      // on would swallow half the page; stopping at the first container with any button at
      // all is what labelled a search widget with its date picker.
      return { container: c, submit: best.submit };
    }
    // Nothing convincing anywhere above: better one loose field tool than a form named
    // after a button that does something else.
    return null;
  };

  /**
   * Read a page and return the tools it offers right now.
   *
   * Call it again after every action. The tool list is a function of the page's CURRENT
   * state, not a property of the URL: controls appear behind clicks, and a list captured
   * once is wrong by the time it is used.
   *
   * @param {Options} [options]
   * @returns {Result}
   */
  function synthesizeTools(options) {
    const o = options || {};
    const root = o.root || document;
    const doc = root.nodeType === 9 ? /** @type {Document} */ (root) : root.ownerDocument;
    const maxTools = o.maxTools === undefined ? 0 : o.maxTools;
    const maxNav = o.maxNavTargets === undefined ? 24 : o.maxNavTargets;
    const collapseLinks = o.collapseLinks !== false;
    const extraNoise = (o.exclude || []).join(',');
    const noise = extraNoise ? NOISE + ',' + extraNoise : NOISE;

    /** @param {Element} el */
    const isNoise = (el) => !!el.closest(noise);
    /** @param {Element} el */
    const inChrome = (el) => !!el.closest(CHROME);

    /** @type {Tool[]} */
    const tools = [];
    /** @type {Map<string, Ref>} */
    const refs = new Map();
    /** @type {Stats} */
    const stats = {
      candidates: 0,
      visible: 0,
      unnamed: 0,
      groups: 0,
      links: 0,
      dropped: 0,
      total: 0,
      returned: 0,
      truncated: false,
    };

    /** @type {Map<string, number>} */
    const used = new Map();
    /** @param {string} n */
    const uniq = (n) => {
      const c = (used.get(n) || 0) + 1;
      used.set(n, c);
      return c === 1 ? n : n + c;
    };

    /** A name of its own, taken from as much of the label as it needs.
     *
     * A numbered duplicate is what a consumer's shortlist throws away — it cannot tell "the
     * same control listed twice" from "two different questions that happen to start alike",
     * and it is right to cut the first. Measured on the benefit finder's "more about you"
     * step: five questions, all named after the option they offer, so five tools called
     * setYes … setYes5, four of them cut, and the model was handed ONE tool for five
     * questions. It called it twice, noticed it could not tell whether both had landed, and
     * said so to the person — behaving correctly on a list that was lying to it.
     *
     * So before anybody resorts to a number, the name is WIDENED by the next word of the
     * label: "Do you have a disability?" and "Do you have a disability caused or made worse
     * by your active-duty military service?" diverge at the sixth word, and now so do their
     * names. A number is still the last resort, for a label that really is the same label.
     * @param {string} verb @param {string} label */
    const ownName = (verb, label) => {
      const w = words(label);
      for (let take = 6; take <= Math.min(w.length + 1, 16); take++) {
        const n = toolName(verb, label, take);
        if (!used.has(n)) {
          used.set(n, 1);
          return n;
        }
      }
      return uniq(toolName(verb, label));
    };

    const all = Array.from(root.querySelectorAll(SELECTOR));
    stats.candidates = all.length;
    const shown = all.filter((el) => (o.includeHiddenForms || isVisible(el)) && !isNoise(el));
    stats.visible = shown.length;

    /* Drop a wrapper whose (role, name) a descendant repeats. Component libraries render
     * a custom element with role=combobox around an <input role=combobox> carrying the
     * same label, which otherwise yields two tools for one field. */
    /** @type {Map<string, Element[]>} */
    const byKey = new Map();
    for (const el of shown) {
      const k = roleOf(el) + '\u0000' + accessibleName(el);
      byKey.set(k, (byKey.get(k) || []).concat([el]));
    }
    /** @type {Set<Element>} */
    const dropped = new Set();
    for (const group of byKey.values()) {
      if (group.length < 2) continue;
      for (const a of group) {
        for (const b of group) if (a !== b && a.contains(b)) dropped.add(a);
      }
    }
    stats.dropped = dropped.size;
    const live = shown.filter((el) => !dropped.has(el));

    /* Radio groups, document-wide. Grouping them only inside a <form> leaves a two-option
     * toggle looking like two unrelated string fields. */
    /** @type {Map<Element, string>} */
    const radioOwner = new Map();
    /** @type {Map<string, Element[]>} */
    const radioGroups = new Map();
    for (const el of live) {
      if (roleOf(el) !== 'radio') continue;
      const named = /** @type {HTMLInputElement} */ (el).name;
      const key =
        named ||
        'g:' + cssPath(el.closest('fieldset,[role="radiogroup"]') || el.parentElement || el);
      if (!radioGroups.has(key)) radioGroups.set(key, []);
      /** @type {Element[]} */ (radioGroups.get(key)).push(el);
      radioOwner.set(el, key);
    }

    /* Cluster fields by container. */
    const fields = live.filter((el) => FIELDISH.has(roleOf(el)));
    /** @type {Map<Element, {submit: Element, fields: Element[], radioKeys: Set<string>}>} */
    const clusters = new Map();
    /** @type {Element[]} */
    const loose = [];
    /** @param {Element} anchor @param {Element[]} [members] @param {string} [radioKey] */
    const assign = (anchor, members, radioKey) => {
      const g = groupContainerOf(anchor, root);
      if (!g) {
        loose.push(anchor);
        return;
      }
      let c = clusters.get(g.container);
      if (!c) {
        c = { submit: g.submit, fields: [], radioKeys: new Set() };
        clusters.set(g.container, c);
      }
      if (radioKey) c.radioKeys.add(radioKey);
      else c.fields.push(...(members || [anchor]));
    };
    for (const el of fields) {
      if (radioOwner.has(el)) continue;
      assign(el);
    }
    for (const [key, group] of radioGroups) assign(group[0], undefined, key);

    /** @type {Set<Element>} */
    const claimed = new Set();

    for (const [container, c] of clusters) {
      /** @type {Record<string, JSONSchema>} */
      const properties = {};
      /** @type {string[]} */
      const required = [];
      /** @type {FieldRef[]} */
      const fieldRefs = [];

      /** @param {string} label */
      const keyFor = (label) => {
        let k = camel(words(label), 5) || 'value';
        if (properties[k]) {
          let i = 2;
          while (properties[k + i]) i++;
          k = k + i;
        }
        return k;
      };

      for (const el of c.fields) {
        const any = /** @type {HTMLInputElement} */ (el);
        const nm = accessibleName(el);
        if (!nm) stats.unnamed++;
        const key = keyFor(nm || any.name || el.id || 'value');
        const schema = fieldSchema(el);
        const desc = describedBy(el);
        schema.description = cut(clean((nm || '(unlabelled)') + (desc ? ' — ' + desc : '')), 200);
        properties[key] = schema;
        if (any.required || el.getAttribute('aria-required') === 'true') required.push(key);
        fieldRefs.push({ key, kind: 'field', el });
        claimed.add(el);
      }

      for (const rk of c.radioKeys) {
        const group = /** @type {Element[]} */ (radioGroups.get(rk));
        const box = group[0].closest('fieldset,[role="radiogroup"]');
        const label = (box ? containerLabel(box) : '') || rk;
        const key = keyFor(label);
        const labels = group
          .map((r) => accessibleName(r) || /** @type {HTMLInputElement} */ (r).value)
          .filter(Boolean);
        properties[key] = { type: 'string', enum: labels, description: cut(clean(label), 200) };
        if (group.some((r) => /** @type {HTMLInputElement} */ (r).required)) required.push(key);
        fieldRefs.push({ key, kind: 'radio', els: group, labels });
        for (const r of group) claimed.add(r);
      }

      if (!fieldRefs.length) continue;
      stats.groups++;

      const label = containerLabel(container) || accessibleName(c.submit) || 'form';
      const reads = declaresSearch(container);
      const name = uniq(toolName(reads ? 'search' : 'submit', label));
      const action =
        container.tagName === 'FORM' ? /** @type {HTMLFormElement} */ (container).action : '';
      tools.push({
        name,
        description: cut(
          (reads ? 'Runs a search: fill in and submit "' : 'Fill in and submit "') +
            clean(label) +
            '" (' +
            fieldRefs.length +
            ' field' +
            (fieldRefs.length > 1 ? 's' : '') +
            '). Commits with the "' +
            accessibleName(c.submit) +
            '" button.' +
            (action ? ' Sends to ' + action + '.' : ''),
          400
        ),
        inputSchema: { type: 'object', properties, required },
        selector: cssPath(container),
        kind: reads ? 'search' : 'submit',
        gated: !reads,
      });
      /* `commit()` is on both kinds of submit ref so a consumer has ONE call that always
       * works. `submit` stays exactly what it was for anyone already reading it — and an
       * Enter-committed tool has no button, so a consumer that only knows `submit` refuses
       * it rather than reporting a press that never happened. */
      refs.set(name, {
        kind: 'submit',
        el: container,
        submit: c.submit,
        commit: () => /** @type {HTMLElement} */ (c.submit).click(),
        fields: fieldRefs,
      });
      claimed.add(c.submit);
    }

    /* Fields that belong to no cluster: a search box with no button of its own, say. */

    /* How many unclaimed loose fields each <form> holds. The Enter commit below is for a
     * LONE field — a search box. Handing one to every field of a two-field form would
     * produce submitUsername AND submitPassword, each committing the form with only its
     * own half filled in: two tools that each look like the way to log in, and neither is.
     * A form with several fields and no button stays as it was, one `set` tool per field. */
    /** @type {Map<Element, number>} */
    const looseByForm = new Map();
    for (const el of loose) {
      if (claimed.has(el)) continue;
      const f = /** @type {HTMLInputElement} */ (el).form;
      if (f) looseByForm.set(f, (looseByForm.get(f) || 0) + 1);
    }

    for (const el of loose) {
      if (claimed.has(el)) continue;

      /* A RADIO GROUP IS A QUESTION, and the question is not one of its answers.
       *
       * These arrive here as the group's first radio — a group with no committing button of
       * its own is a loose field like any other. Named from that element, every yes/no
       * question on a page becomes "setYes": the tool says the ANSWER and never the thing
       * being asked, five of them collide, and a consumer's shortlist cuts the numbered
       * repeats. Measured on usa.gov's "more about you": five fieldsets, each with its
       * question in a <legend>, published as one tool.
       *
       * So the group is published as ONE tool carrying its own question, with the answers as
       * the enum a caller chooses from — the same shape a radio group already has inside a
       * composite form, which is the one place it was right all along. The question comes
       * from what a person is actually read: the fieldset's legend, the group's aria-label or
       * aria-labelledby, or a heading inside it. When the markup offers none of that, this
       * falls back to what it did before rather than inventing a question. */
      const radioKey = radioOwner.get(el);
      if (radioKey) {
        const group = /** @type {Element[]} */ (radioGroups.get(radioKey));
        const box = el.closest('fieldset,[role="radiogroup"],[role="group"]');
        const asked =
          (box ? containerLabel(box) : '') ||
          /** @type {HTMLInputElement} */ (el).name ||
          accessibleName(el);
        const labels = group
          .map((r) => accessibleName(r) || /** @type {HTMLInputElement} */ (r).value)
          .filter(Boolean);
        const key = camel(words(asked), 5) || 'answer';
        const name = ownName('set', asked || roleOf(el));
        tools.push({
          name,
          description: cut(
            'Answer "' +
              clean(asked || '(unlabelled)') +
              '" with one of: ' +
              labels.join(', ') +
              '.',
            400
          ),
          inputSchema: {
            type: 'object',
            properties: {
              [key]: { type: 'string', enum: labels, description: cut(clean(asked), 200) },
            },
            required: [key],
          },
          selector: cssPath(box || el),
          kind: 'set',
          gated: false,
        });
        /* `fields` carries the group, in the shape a composite form's radio field already
         * uses: one entry, kind 'radio', its elements and their labels index-aligned. A
         * consumer that picks the element whose label was chosen needs nothing new. */
        refs.set(name, {
          kind: 'set',
          el,
          key,
          fields: [{ key, kind: 'radio', els: group, labels }],
        });
        for (const r of group) claimed.add(r);
        if (!asked) stats.unnamed++;
        continue;
      }

      const any = /** @type {HTMLInputElement} */ (el);
      const nm = accessibleName(el);
      if (!nm) stats.unnamed++;
      const key = camel(words(nm || any.name || el.id || 'value'), 5) || 'value';
      const schema = fieldSchema(el);
      schema.description = cut(clean(nm || '(unlabelled)'), 200);

      /* A lone field inside a <form> is not a dead end — the person using that page
       * presses Enter, and until this existed no tool we synthesized could.
       *
       * That gap was total and invisible: measured on google.com, bing.com and
       * duckduckgo.com, the ONLY reason a search ever ran in our own bench was the bench
       * pressing Enter itself. An agent holding the tool list could fill the query box on
       * all three and commit on none of them, and the list gave no hint of it.
       *
       * `gated` like any other commit: it sends something. */
      const form = any.form;
      if (form && looseByForm.get(form) === 1 && !enterTypesText(el)) {
        stats.groups++;
        /* The Enter commit is asked the same question as any other. It has to be: the
         * search boxes on Google, Bing and DuckDuckGo have NO submit button at all, so a
         * rule that only looked at button-committed forms would leave the one search a
         * person actually asks for behind a confirmation. */
        const reads = declaresSearch(form);
        const name = uniq(toolName(reads ? 'search' : 'submit', nm || roleOf(el)));
        tools.push({
          name,
          description: cut(
            (reads ? 'Runs a search: fill in and submit "' : 'Fill in and submit "') +
              clean(nm || '(unlabelled)') +
              '" (1 field). Commits by pressing Enter in the field: this form offers no ' +
              'button that submits it.' +
              (form.action ? ' Sends to ' + form.action + '.' : ''),
            400
          ),
          inputSchema: { type: 'object', properties: { [key]: schema }, required: [key] },
          selector: cssPath(form),
          kind: reads ? 'search' : 'submit',
          gated: !reads,
        });
        refs.set(name, {
          kind: 'submit',
          el: form,
          commit: commitByEnter(el, form),
          fields: [{ key, kind: 'field', el }],
        });
        claimed.add(el);
        continue;
      }

      const name = uniq(toolName('set', nm || roleOf(el)));
      tools.push({
        name,
        description: cut('Set the ' + roleOf(el) + ' "' + clean(nm || '(unlabelled)') + '".', 400),
        inputSchema: { type: 'object', properties: { [key]: schema }, required: [key] },
        selector: cssPath(el),
        kind: 'set',
        gated: false,
      });
      refs.set(name, { kind: 'set', el, key });
      claimed.add(el);
    }

    /* Buttons that are not site furniture. */
    for (const el of live) {
      if (claimed.has(el)) continue;
      if (!ACTIONABLE.has(roleOf(el))) continue;
      if (inChrome(el)) continue;
      const nm = accessibleName(el);
      if (!nm) {
        stats.unnamed++;
        continue; // a tool nobody can describe is worse than no tool
      }
      const name = uniq(toolName('click', nm));
      const desc = describedBy(el);
      tools.push({
        name,
        description: cut(
          'Activate the ' + roleOf(el) + ' "' + clean(nm) + '".' + (desc ? ' ' + desc : ''),
          400
        ),
        inputSchema: { type: 'object', properties: {}, required: [] },
        selector: cssPath(el),
        kind: 'click',
        gated: false,
      });
      refs.set(name, { kind: 'click', el });
      claimed.add(el);
    }

    /* Every link collapses into ONE navigate tool with a ranked enum. Emitting a tool per
     * link hands the model a sitemap: on one government page that was 30 of 36 tools,
     * all of them footer and social links, burying the two that did something. */
    const links = live.filter((el) => roleOf(el) === 'link' && !claimed.has(el));
    const scored = links
      .map((el) => {
        const nm = accessibleName(el);
        let score = 0;
        if (!inChrome(el)) score += 10;
        if (el.closest('main,[role="main"],article')) score += 6;
        if (el.closest('footer,[role="contentinfo"]')) score -= 6;
        if (/^(skip to|back to top)/i.test(nm)) score -= 20;
        if (/facebook|twitter|instagram|linkedin|youtube|pinterest|share this/i.test(nm)) {
          score -= 15;
        }
        if (el.closest('h1,h2,h3,h4')) score += 5; // a result or card heading
        const w = words(nm).length;
        if (w >= 2 && w <= 12) score += 2;
        return { el, nm, score };
      })
      .filter((l) => l.nm)
      .sort((a, b) => b.score - a.score);
    stats.links = scored.length;

    /* The page's own calls to action, each as a tool with a name a model can match against
     * what somebody asked for. Taken out of the collapse rather than duplicated into it: two
     * ways to press one control is two names for the model to choose wrongly between. */
    if (collapseLinks) {
      let given = 0;
      for (const l of scored) {
        if (given >= MAX_CALLS_TO_ACTION) break;
        if (inChrome(l.el)) continue;
        if (!CALL_TO_ACTION.test(l.el.getAttribute('class') || '')) continue;
        const name = uniq(toolName('click', l.nm));
        tools.push({
          name,
          description: cut(
            'Activate "' +
              clean(l.nm) +
              '" — the page presents this as its own button. ' +
              'Follows a link.',
            400
          ),
          inputSchema: { type: 'object', properties: {}, required: [] },
          selector: cssPath(l.el),
          kind: 'click',
          gated: false,
          /* What the PAGE says about it, for whoever is choosing what to offer. The brick
           * reports the fact; a consumer decides whether it leads the list. */
          primary: true,
        });
        refs.set(name, { kind: 'click', el: l.el });
        claimed.add(l.el);
        given++;
      }
    }
    /** The links that are left, which is all of them on a page with no call to action.
     *  stats.links stays the number of links FOUND — that is a fact about the page, not about
     *  what we did with them. */
    const rest = scored.filter((l) => !claimed.has(l.el));

    if (collapseLinks && rest.length) {
      /** @type {{label: string, el: Element}[]} */
      const targets = [];
      /** @type {Set<string>} */
      const seen = new Set();
      for (const l of rest) {
        if (maxNav > 0 && targets.length >= maxNav) break;
        const label = cut(l.nm, 90);
        if (seen.has(label)) continue;
        seen.add(label);
        targets.push({ label, el: l.el });
      }
      const name = 'navigate';
      tools.push({
        name,
        description:
          'Follow one link on the current page. ' +
          targets.length +
          ' of ' +
          rest.length +
          ' links are offered here; the list changes as the page changes.',
        inputSchema: {
          type: 'object',
          properties: {
            target: {
              type: 'string',
              enum: targets.map((t) => t.label),
              description: 'The link to follow, by its visible text.',
            },
          },
          required: ['target'],
        },
        selector: '(' + targets.length + ' of ' + rest.length + ' links)',
        kind: 'navigate',
        gated: false,
        linkTotal: rest.length,
      });
      refs.set(name, { kind: 'navigate', targets });
    } else if (rest.length) {
      for (const l of rest) {
        const name = uniq(toolName('open', l.nm));
        const href = hrefOf(l.el);
        tools.push({
          name,
          description: cut(
            'Follow the link "' + clean(l.nm) + '"' + (href ? ' (' + href + ')' : '') + '.',
            400
          ),
          inputSchema: { type: 'object', properties: {}, required: [] },
          selector: cssPath(l.el),
          kind: 'click',
          gated: false,
        });
        refs.set(name, { kind: 'click', el: l.el });
      }
    }

    /* Composite forms first: they are what an agent should reach for. Then single fields,
     * buttons, and navigation last. A cap that cut by document order would drop the form
     * and keep the footer. */
    /** @type {Record<ToolKind, number>} */
    const rank = { submit: 0, search: 0, set: 1, click: 2, navigate: 3 };
    tools.sort((a, b) => rank[a.kind] - rank[b.kind]);

    stats.total = tools.length;
    if (maxTools > 0 && tools.length > maxTools) {
      const keep = tools.slice(0, maxTools);
      const names = new Set(keep.map((t) => t.name));
      for (const k of Array.from(refs.keys())) if (!names.has(k)) refs.delete(k);
      stats.returned = keep.length;
      stats.truncated = true;
      return { tools: keep, refs, stats };
    }
    stats.returned = tools.length;
    if (doc) void doc; // documented parameter, kept for callers passing an Element root
    return { tools, refs, stats };
  }

  /**
   * The tools, as an OpenAI-compatible `tools` array. Every provider that speaks that
   * shape — including Groq and Anthropic's compatibility endpoint — takes this directly.
   * @param {Tool[]} tools
   */
  function toOpenAITools(tools) {
    return tools.map((t) => ({
      type: /** @type {const} */ ('function'),
      function: { name: t.name, description: t.description, parameters: t.inputSchema },
    }));
  }

  const api = {
    synthesizeTools,
    toOpenAITools,
    // The parts, because half the value here is the accessible name and people will want
    // it on its own.
    accessibleName,
    roleOf,
    isVisible,
    fieldSchema,
    version: '0.1.0',
  };

  global.PageToolsSynth = api;
  // Also hand it to a CommonJS consumer (a jsdom test harness, say) without requiring one.
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
