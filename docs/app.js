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

  // The demo writes its own captions from a script rather than from markup, so
  // it is told about the language separately. It is built further down, hence
  // the handle rather than a direct call.
  let demoApi = null;
  let currentLang = "en";

  function setLang(lang) {
    currentLang = lang;
    demoApi?.setLang(lang);
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

  // ---- the editor demo -----------------------------------------------------
  // Walks the toolbar one tool at a time, drawing each annotation onto a mocked
  // screenshot and leaving it there, so the canvas fills up the way a real
  // session does — then copies the path and starts over.

  const demo = (() => {
    const svg = document.getElementById("demo");
    if (!svg) return { setLang() {} };

    const shot = svg.closest(".shot");
    const toolbar = document.getElementById("demo-tools");
    const nameEl = document.getElementById("demo-tool");
    const hintEl = document.getElementById("demo-hint");
    const cursor = document.getElementById("demo-cursor");
    const copyChip = document.getElementById("demo-copy");
    const toast = document.getElementById("demo-toast");

    // tool: which toolbar button lights up (none, for the capture itself).
    // ink: which annotation appears. from/at: where the pointer travels, in
    // the SVG's own coordinates. transient: cleared when the step ends, which
    // is what makes the capture scrim lift once the region is taken.
    const STEPS = [
      { ink: "ink-capture", from: [136, 65], at: [504, 234], transient: true, zoom: true, hold: 2800,
        en: ["Capture", "Drag the region — it is on disk the moment you let go"],
        th: ["แคปหน้าจอ", "ลากเลือกพื้นที่ ปล่อยเมาส์ปุ๊บไฟล์ถูกบันทึกทันที"] },
      { tool: "highlighter", ink: "ink-highlighter", at: [386, 133],
        en: ["Highlighter", "Mark the line you are talking about"],
        th: ["ไฮไลต์", "ทำเครื่องหมายบรรทัดที่กำลังพูดถึง"] },
      { tool: "rect", ink: "ink-rect", at: [398, 229],
        en: ["Rectangle", "Box the part that broke"],
        th: ["สี่เหลี่ยม", "ตีกรอบส่วนที่พัง"] },
      { tool: "arrow", ink: "ink-arrow", at: [406, 217],
        en: ["Arrow", "Point straight at it — hold Shift for 45°"],
        th: ["ลูกศร", "ชี้ตรงไปที่จุดนั้น กด Shift เพื่อล็อกมุม 45°"] },
      { tool: "text", ink: "ink-text", at: [482, 188],
        en: ["Text", "Say what you want done"],
        th: ["ข้อความ", "เขียนบอกว่าต้องการอะไร"] },
      { tool: "blur", ink: "ink-blur", at: [356, 91],
        en: ["Blur", "Hide the key before anyone sees it"],
        th: ["เบลอ", "ปิดคีย์ลับก่อนใครเห็น"] },
      { tool: "counter", ink: "ink-counter", at: [150, 218],
        en: ["Step counter", "Number the steps as you go"],
        th: ["เลขลำดับ", "ใส่เลขไล่ลำดับให้อัตโนมัติ"] },
      { tool: "crop", ink: "ink-crop", at: [120, 32], transient: true,
        en: ["Crop", "Push the edges in — or pick a ratio"],
        th: ["ครอป", "ดันขอบเข้ามา หรือเลือกอัตราส่วนสำเร็จรูป"] },
    ];
    const FINALE = {
      en: ["Copy Path", "Ctrl+C, then paste it into your prompt"],
      th: ["คัดลอกพาธ", "กด Ctrl+C แล้ววางลงในพรอมต์ได้เลย"],
    };

    const inks = STEPS.map((s) => document.getElementById(s.ink));
    const buttons = new Map(
      [...toolbar.querySelectorAll("[data-tool]")].map((b) => [b.dataset.tool, b]),
    );

    let lang = "en";
    let current = FINALE; // replaced on the first tick
    let timers = [];
    let running = false;

    // Each step arms two timers; stopping has to cancel both, or a paused demo
    // still paints its next annotation.
    const after = (ms, fn) => timers.push(setTimeout(fn, ms));
    const cancel = () => {
      for (const t of timers) clearTimeout(t);
      timers = [];
    };

    function caption(step) {
      current = step;
      const [name, hint] = step[lang] ?? step.en;
      nameEl.textContent = name;
      hintEl.textContent = hint;
    }

    /**
     * Put the pointer somewhere, in the SVG's user units, expressed relative to
     * the mock-up as a whole. Measured on every move rather than cached: the
     * canvas scales with the viewport, so any stored mapping goes stale the
     * moment the window is resized.
     */
    function point(ux, uy) {
      const box = svg.getBoundingClientRect();
      const host = shot.getBoundingClientRect();
      moveTo(
        box.left - host.left + (ux / 640) * box.width,
        box.top - host.top + (uy / 300) * box.height,
      );
    }

    /** Put the pointer on a real element — used for the Copy Path button. */
    function pointAt(el) {
      const target = el.getBoundingClientRect();
      const host = shot.getBoundingClientRect();
      moveTo(
        target.left - host.left + target.width * 0.4,
        target.top - host.top + target.height * 0.5,
      );
    }

    function moveTo(x, y) {
      cursor.classList.add("on");
      cursor.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    }

    function reset() {
      svg.classList.add("pre");
      for (const ink of inks) ink.classList.remove("in");
      for (const b of buttons.values()) b.classList.remove("on");
      copyChip.classList.remove("pressed");
      toast.classList.remove("on");
      cursor.classList.remove("on");
    }

    function step(i) {
      if (i < STEPS.length) {
        const s = STEPS[i];
        for (const b of buttons.values()) b.classList.remove("on");
        if (s.tool) buttons.get(s.tool)?.classList.add("on");
        caption(s);

        if (s.from) {
          // A drag: start at one corner, then travel to the other so the
          // selection reads as being pulled out rather than appearing.
          point(s.from[0], s.from[1]);
          after(500, () => {
            inks[i].classList.add("in");
            point(s.at[0], s.at[1]);
          });
        } else {
          point(s.at[0], s.at[1]);
          // Let the pointer arrive before the ink appears under it.
          after(420, () => inks[i].classList.add("in"));
        }

        after(s.hold ?? 2200, () => {
          if (s.transient) inks[i].classList.remove("in");
          // Dropping `pre` scales the captured region up to fill the frame —
          // the moment the screen stops being a screen and becomes the image.
          if (s.zoom) svg.classList.remove("pre");
          step(i + 1);
        });
        return;
      }
      // Finale: the whole point of the app — take the path and go. The pointer
      // is aimed at the button itself, not at a coordinate that happens to sit
      // near it.
      for (const b of buttons.values()) b.classList.remove("on");
      caption(FINALE);
      pointAt(copyChip);
      after(750, () => {
        copyChip.classList.add("pressed");
        toast.classList.add("on");
      });
      after(2600, () => {
        reset();
        after(700, () => step(0));
      });
    }

    function start() {
      if (running) return;
      running = true;
      step(0);
    }
    function stop() {
      running = false;
      cancel();
    }

    if (reduced) {
      // No motion: show the finished result and name it, rather than an empty
      // canvas that never fills. Crop and the capture scrim are left out —
      // both dim everything outside their frame, which would bury the rest.
      for (const ink of inks) {
        if (ink.id !== "ink-crop" && ink.id !== "ink-capture") ink.classList.add("in");
      }
      svg.classList.remove("pre");
      // The end state includes having copied the path, so show that too rather
      // than a half-finished result.
      copyChip.classList.add("pressed");
      toast.classList.add("on");
      caption(FINALE);
      cursor.style.display = "none";
    } else {
      // Start unconditionally: the demo sits in the hero, so it is on screen
      // the moment the page opens, and waiting for an observer callback that
      // may never come would leave a blank canvas. The observer only pauses it
      // once it has scrolled away.
      start();
      if ("IntersectionObserver" in window) {
        new IntersectionObserver(
          (entries) => {
            for (const e of entries) (e.isIntersecting ? start : stop)();
          },
          { threshold: 0.05 },
        ).observe(svg);
      }
    }

    return {
      setLang(next) {
        lang = next;
        caption(current);
      },
    };
  })();

  demoApi = demo;
  demo.setLang(currentLang);

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
