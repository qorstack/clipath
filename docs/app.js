/* Clipath landing page behaviour: language toggle, tabs, scroll reveal, and the
   typed line in the hero terminal. No dependencies. */

(() => {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Everything the script hides is hidden only once the script is running.
  document.documentElement.classList.add("js");

  // ---- language ------------------------------------------------------------
  // English lives in the markup; Thai lives in data-th. The English copy is
  // captured on first switch so toggling back is lossless.
  const translatable = () => document.querySelectorAll("[data-th]");
  const buttons = document.querySelectorAll(".lang button");

  function setLang(lang) {
    for (const el of translatable()) {
      if (el.dataset.en === undefined) el.dataset.en = el.innerHTML;
      el.innerHTML = lang === "th" ? el.dataset.th : el.dataset.en;
    }
    document.documentElement.lang = lang;
    for (const b of buttons) {
      b.setAttribute("aria-pressed", String(b.dataset.lang === lang));
    }
    try {
      localStorage.setItem("clipath-lang", lang);
    } catch {
      /* private mode — the toggle still works for this visit */
    }
  }

  for (const b of buttons) b.addEventListener("click", () => setLang(b.dataset.lang));

  // ?lang=th wins, so a Thai link can be shared directly; otherwise the last
  // choice, otherwise the browser's own language.
  const asked = new URLSearchParams(location.search).get("lang");
  let saved = null;
  try {
    saved = localStorage.getItem("clipath-lang");
  } catch {
    /* ignore */
  }
  const initial = asked || saved || (navigator.language?.startsWith("th") ? "th" : "en");
  if (initial === "th") setLang("th");

  // ---- nav shadow on scroll -----------------------------------------------
  const nav = document.getElementById("nav");
  const onScroll = () => nav.classList.toggle("scrolled", window.scrollY > 8);
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });

  // ---- guide tabs ----------------------------------------------------------
  const tabs = document.querySelectorAll(".tab");
  for (const tab of tabs) {
    tab.addEventListener("click", () => {
      for (const t of tabs) {
        const on = t === tab;
        t.setAttribute("aria-selected", String(on));
        document.getElementById(t.dataset.panel).hidden = !on;
      }
    });
  }

  // ---- scroll reveal -------------------------------------------------------
  const targets = document.querySelectorAll(".reveal");
  if (reduced || !("IntersectionObserver" in window)) {
    for (const el of targets) el.classList.add("in");
  } else {
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          e.target.classList.add("in");
          io.unobserve(e.target);
        }
      },
      { rootMargin: "0px 0px -12% 0px" },
    );
    // Stagger siblings so a grid arrives as a wave rather than all at once.
    let previous = null;
    let step = 0;
    for (const el of targets) {
      const parent = el.parentElement;
      step = parent === previous ? step + 1 : 0;
      previous = parent;
      el.style.transitionDelay = `${Math.min(step, 5) * 70}ms`;
      io.observe(el);
    }
  }

  // ---- hero terminal -------------------------------------------------------
  const out = document.getElementById("type");
  if (out) {
    const line = "explain this error C:\\Users\\you\\Pictures\\Clipath\\clipath_2026-08-08_12-36-49.png";
    if (reduced) {
      out.textContent = line;
    } else {
      let i = 0;
      const tick = () => {
        out.textContent = line.slice(0, i);
        i += 1;
        if (i <= line.length) setTimeout(tick, i > line.length - 44 ? 18 : 38);
        else setTimeout(() => { i = 0; tick(); }, 3200);
      };
      tick();
    }
  }
})();
