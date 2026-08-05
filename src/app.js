(function () {
  "use strict";

  // ---- Tauri bridge (global Tauri is enabled via `withGlobalTauri`) ----
  // IMPORTANT: under `withGlobalTauri`, only the *core* modules are attached to
  // `window.__TAURI__` (tauri/core/event/window/...). Plugin modules such as
  // `dialog` are NOT auto-mounted, so we call the dialog plugin's Rust commands
  // directly via `invoke("plugin:dialog|open" | "plugin:dialog|save")`.
  // The dialog commands expect their options under a top-level `options` key.
  var TA = window.__TAURI__ || {};
  var tauriMod = TA.tauri || TA.core || {};
  var eventMod = TA.event || {};
  var winMod = TA.window || {};
  var hasTauri = !!(TA && (TA.tauri || TA.core));
  var invoke = tauriMod.invoke || function () {
    return Promise.reject(new Error("Tauri invoke unavailable"));
  };
  var listen = eventMod.listen || function () {
    return Promise.resolve(function () {});
  };
  var appWindow = winMod && winMod.getCurrentWindow ? winMod.getCurrentWindow() : null;

  function errMsg(e) {
    if (!e) return "未知错误";
    if (typeof e === "string") return e;
    return (e && e.message) || e.toString();
  }

  // ---- State ----
  var current = { path: null, name: "未命名.md", content: "" };
  var lastSaved = "";
  var isSource = false;
  var docLoaded = false; // false → show the empty state instead of the editor

  // ---- Settings ----
  var SETTINGS_KEY = "jam_md_settings";
  var DEFAULT_SETTINGS = { font: "system", fontSize: 14, lineHeight: 1.7, theme: "light" };
  var settings = Object.assign({}, DEFAULT_SETTINGS);
  var fontStacks = {
    system: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", system-ui, sans-serif',
    serif: '"Iowan Old Style", "Palatino Linotype", "Songti SC", "Noto Serif SC", Georgia, "Times New Roman", serif',
    mono: '"SF Mono", "JetBrains Mono", Menlo, Consolas, "Courier New", monospace',
  };

  // ---- Element refs ----
  var preview, sourceEl, contentEl, outlinePanel, outlineList, settingsModal, workspaceEl;
  var docNameEl, saveStateEl;
  var fabSource, fabOutline, fabSettings, fabOpen, fabSave, fabTop, toastEl;
  var fontSegItems, themeSegItems, fontSizeInput, lineHeightInput, fontSizeVal, lineHeightVal;
  var closeTrayEl, minTrayEl;
  // Runtime copy of tray behaviour fetched from Rust (so the minimize button
  // can decide between `minimize` and `hide` without re-querying Rust).
  var tray = { closeToTray: false, minimizeToTray: false };

  function $(id) {
    return document.getElementById(id);
  }

  function init() {
    preview = $("preview");
    sourceEl = $("source");
    contentEl = $("content");
    workspaceEl = document.querySelector(".workspace");
    outlinePanel = $("outline-panel");
    outlineList = $("outline-list");
    settingsModal = $("settings-modal");
    docNameEl = $("doc-name");
    saveStateEl = $("save-state");
    fabSource = $("fab-source");
    fabOutline = $("fab-outline");
    fabSettings = $("fab-settings");
    fabOpen = $("fab-open");
    fabSave = $("fab-save");
    fabTop = $("fab-top");
    toastEl = $("toast");
    fontSizeInput = $("set-font-size");
    lineHeightInput = $("set-line-height");
    fontSizeVal = $("font-size-val");
    lineHeightVal = $("line-height-val");
    fontSegItems = document.querySelectorAll("[data-font]");
    themeSegItems = document.querySelectorAll("[data-theme]");
    closeTrayEl = $("set-close-tray");
    minTrayEl = $("set-min-tray");

    setupMarked();
    loadSettings();
    bindUI();
    bindShortcuts();
    bindWindowControls();

    invoke("get_initial_file")
      .then(function (p) {
        if (p && p.content != null) openFile(p);
        else showEmptyState();
      })
      .catch(function () {
        showEmptyState();
      });

    // Load tray behaviour settings so the minimize button and the settings
    // switches reflect the persisted (and runtime-switchable) state.
    invoke("get_settings")
      .then(function (s) {
        if (!s) return;
        tray.closeToTray = !!s.close_to_tray;
        tray.minimizeToTray = !!s.minimize_to_tray;
        if (closeTrayEl) closeTrayEl.checked = tray.closeToTray;
        if (minTrayEl) minTrayEl.checked = tray.minimizeToTray;
      })
      .catch(function () {});

    listen("open-file", function (e) {
      if (e && e.payload) openFile(e.payload);
    });
  }

  // ---- Markdown ----
  function setupMarked() {
    if (window.marked && window.marked.setOptions) {
      window.marked.setOptions({ gfm: true, breaks: false });
    }
  }

  function slug(text) {
    return (
      (text || "")
        .toLowerCase()
        .trim()
        .replace(/[^\w一-龥]+/g, "-")
        .replace(/^-+|-+$/g, "") || "section"
    );
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // ---- Math ($...$ and $$...$$) protected from markdown, rendered with KaTeX ----
  var MATH_OPEN = "", MATH_CLOSE = "";
  function extractMath(md) {
    var store = [];
    md = md.replace(/\$\$([\s\S]+?)\$\$/g, function (_, t) {
      store.push({ d: true, t: t.trim() });
      return MATH_OPEN + "MATH" + (store.length - 1) + MATH_CLOSE;
    });
    md = md.replace(/(?<!\\)\$(?!\s)([^$\n]+?)(?<!\s)\$/g, function (_, t) {
      store.push({ d: false, t: t.trim() });
      return MATH_OPEN + "MATH" + (store.length - 1) + MATH_CLOSE;
    });
    return { md: md, store: store };
  }

  function restoreMath(html, store) {
    if (!window.katex || !store.length) return html;
    return html.replace(/MATH(\d+)/g, function (_, i) {
      var b = store[+i];
      if (!b) return "";
      try {
        return window.katex.renderToString(b.t, {
          displayMode: b.d,
          throwOnError: false,
          output: "html",
        });
      } catch (e) {
        var esc = escapeHtml(b.t);
        return b.d ? '<div class="math-error">' + esc + "</div>" : '<code class="math-error">' + esc + "</code>";
      }
    });
  }

  function render(md) {
    var math = extractMath(md || "");
    var html;
    try {
      html = window.marked ? window.marked.parse(math.md) : escapeHtml(math.md);
    } catch (err) {
      html = "<pre>" + escapeHtml(String(err)) + "</pre>";
    }
    html = restoreMath(html, math.store);
    preview.innerHTML = '<article class="doc">' + html + "</article>";

    // ---- Diagrams (mermaid) ----
    var mermaidCodes = preview.querySelectorAll("pre > code.language-mermaid");
    if (mermaidCodes.length) {
      Array.prototype.forEach.call(mermaidCodes, function (codeEl) {
        var pre = codeEl.parentNode;
        var div = document.createElement("div");
        div.className = "mermaid";
        div.textContent = codeEl.textContent;
        pre.parentNode.replaceChild(div, pre);
      });
      ensureMermaid().then(function (m) {
        if (!m) return;
        try {
          m.initialize({
            startOnLoad: false,
            theme: settings.theme === "dark" ? "dark" : "default",
            securityLevel: "loose",
          });
          // v9 API: init() with no args renders every `.mermaid` element in the
          // document by reading its own textContent.
          if (typeof m.init === "function") {
            m.init();
          }
        } catch (e) {
          console.error(e);
        }
      });
    }

    // ---- Syntax highlighting (highlight.js) ----
    if (window.hljs) {
      Array.prototype.forEach.call(preview.querySelectorAll("pre code"), function (el) {
        try {
          window.hljs.highlightElement(el);
        } catch (e) {
          /* ignore */
        }
      });
    }

    renderOutline(buildOutline(preview));
  }

  var mermaidPromise = null;
  function ensureMermaid() {
    if (mermaidPromise) return mermaidPromise;
    mermaidPromise = new Promise(function (resolve) {
      if (window.mermaid) {
        resolve(window.mermaid);
        return;
      }
      var s = document.createElement("script");
      s.src = "vendor/mermaid/mermaid.min.js";
      s.onload = function () {
        resolve(window.mermaid || null);
      };
      s.onerror = function () {
        mermaidPromise = null;
        resolve(null);
      };
      document.head.appendChild(s);
    });
    return mermaidPromise;
  }

  function buildOutline(root) {
    var heads = root.querySelectorAll("h1,h2,h3,h4,h5,h6");
    var list = [];
    for (var i = 0; i < heads.length; i++) {
      var h = heads[i];
      var id = "sec-" + i + "-" + slug(h.textContent);
      h.id = id;
      list.push({
        level: parseInt(h.tagName.charAt(1), 10),
        text: h.textContent,
        id: id,
      });
    }
    return list;
  }

  function renderOutline(list) {
    outlineList.innerHTML = "";
    if (!list.length) {
      var empty = document.createElement("span");
      empty.className = "outline-item";
      empty.textContent = "(暂无标题)";
      outlineList.appendChild(empty);
      return;
    }
    list.forEach(function (item) {
      var a = document.createElement("a");
      a.className = "outline-item lv" + item.level;
      a.textContent = item.text || "(无标题)";
      a.title = item.text || "";
      a.href = "javascript:void(0)";
      a.addEventListener("click", function (ev) {
        ev.preventDefault();
        var el = document.getElementById(item.id);
        toggleOutline(false);
        if (el) {
          var target =
            el.getBoundingClientRect().top -
            contentEl.getBoundingClientRect().top +
            contentEl.scrollTop -
            24; /* matches .doc h* scroll-margin-top */
          smoothScrollTo(target);
          el.classList.add("scroll-target");
          setTimeout(function () {
            el.classList.remove("scroll-target");
          }, 1200);
        }
      });
      outlineList.appendChild(a);
    });
  }

  // ---- File operations ----
  // Toggle the "has-doc" state on both <html> (so global elements like the
  // top bar title and the floating rail can react) and .workspace (so the
  // empty state can hide itself).
  function setHasDoc(on) {
    document.documentElement.classList.toggle("has-doc", on);
    workspaceEl.classList.toggle("has-doc", on);
  }

  function openFile(p) {
    current = { path: p.path || null, name: p.name || "未命名.md", content: p.content || "" };
    lastSaved = current.content;
    docLoaded = true;
    setHasDoc(true);
    setDirty(false);
    setSourceMode(false);
    hideSettings();
    updateDocName();
    render(current.content);
  }

  function showEmptyState() {
    docLoaded = false;
    setHasDoc(false);
    preview.innerHTML = "";
    outlineList.innerHTML = "";
  }

  function newDoc() {
    current = { path: null, name: "未命名.md", content: "" };
    lastSaved = "";
    docLoaded = true;
    setHasDoc(true);
    setDirty(false);
    setSourceMode(true);
    updateDocName();
    render("");
  }

  function updateDocName() {
    docNameEl.textContent = current.name || "未命名.md";
    docNameEl.title = current.name || "未命名.md";
  }

  function setDirty(d) {
    saveStateEl.textContent = d ? "● 未保存" : "";
  }

  var toastTimer = null;
  function showToast(msg) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toastEl.classList.remove("show");
    }, 1800);
  }

  // Custom rAF easing scroll — guaranteed smooth even where native
  // `behavior:"smooth"` is flaky inside the WebView.
  var scrollAnim = null;
  function smoothScrollTo(targetTop) {
    var el = contentEl || preview;
    if (!el) return;
    var max = el.scrollHeight - el.clientHeight;
    targetTop = Math.max(0, Math.min(targetTop, max));
    var start = el.scrollTop;
    var dist = targetTop - start;
    if (Math.abs(dist) < 2) return;
    if (scrollAnim) cancelAnimationFrame(scrollAnim);
    var dur = 520;
    var t0 = null;
    function step(ts) {
      if (t0 === null) t0 = ts;
      var p = Math.min(1, (ts - t0) / dur);
      var e = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2; /* easeInOutCubic */
      el.scrollTop = start + dist * e;
      if (p < 1) scrollAnim = requestAnimationFrame(step);
      else scrollAnim = null;
    }
    scrollAnim = requestAnimationFrame(step);
  }

  function scrollToTop() {
    smoothScrollTo(0);
  }

  function save() {
    if (isSource) {
      current.content = sourceEl.value;
      setDirty(current.content !== lastSaved);
    }
    var doWrite = function (path) {
      invoke("save_file", { path: path, content: current.content })
        .then(function () {
          current.path = path;
          current.name = basename(path);
          lastSaved = current.content;
          setDirty(false);
          updateDocName();
          showToast("已保存");
        })
        .catch(function (err) {
          console.error(err);
          alert("保存失败：" + errMsg(err));
        });
    };
    if (current.path) {
      doWrite(current.path);
      return;
    }
    invoke("plugin:dialog|save", {
      options: {
        filters: [{ name: "Markdown", extensions: ["md", "markdown"] }],
      },
    })
      .then(function (res) {
        var p = pickDialogPath(res);
        if (p) doWrite(p);
      })
      .catch(function (err) {
        console.error(err);
        alert("保存失败：" + errMsg(err));
      });
  }

  function openDialog() {
    invoke("plugin:dialog|open", {
      options: {
        multiple: false,
        filters: [{ name: "Markdown", extensions: ["md", "markdown"] }],
      },
    })
      .then(function (res) {
        var p = pickDialogPath(res);
        if (!p) return;
        invoke("read_file", { path: p })
          .then(function (payload) {
            openFile(payload);
          })
          .catch(function (err) {
            console.error(err);
            alert("读取失败：" + errMsg(err));
          });
      })
      .catch(function (err) {
        console.error(err);
        alert("打开失败：" + errMsg(err));
      });
  }

  function basename(p) {
    var s = String(p).replace(/\\/g, "/");
    return s.substring(s.lastIndexOf("/") + 1) || p;
  }

  // Dialog commands expect their options under a top-level `options` key.
  // The return value may be a plain string/path, null, or (in some versions)
  // an object with `.file` or `.path`; normalize all of these.
  function pickDialogPath(res) {
    if (res == null) return null;
    if (typeof res === "string") return res;
    if (typeof res === "object") {
      if (res.file != null) return res.file;
      if (res.path != null) return res.path;
    }
    return null;
  }

  // ---- Source / preview toggle ----
  // In source mode the <textarea> owns its own scroll (fixed height via CSS),
  // so the native textarea behavior keeps the caret visible while typing —
  // we no longer auto-grow the textarea and no longer scroll the whole window.
  function sizeSource() {
    if (!isSource) return;
    // Nothing to size: CSS gives the textarea a fixed height and its own
    // scrollbar. Kept as a no-op hook for future tweaks.
  }

  function setSourceMode(on) {
    isSource = on;
    if (on) {
      contentEl.classList.add("source-mode");
      fabSource.classList.add("active");
      sourceEl.value = current.content;
      sizeSource();
      sourceEl.focus();
    } else {
      contentEl.classList.remove("source-mode");
      fabSource.classList.remove("active");
    }
  }

  function toggleSource() {
    if (isSource) {
      current.content = sourceEl.value;
      setSourceMode(false);
      render(current.content);
      setDirty(current.content !== lastSaved);
    } else {
      setSourceMode(true);
    }
  }

  // ---- Outline toggle ----
  function toggleOutline(force) {
    var willOpen = typeof force === "boolean" ? force : !outlinePanel.classList.contains("open");
    if (willOpen) {
      outlinePanel.classList.add("open");
      fabOutline.classList.add("active");
    } else {
      outlinePanel.classList.remove("open");
      fabOutline.classList.remove("active");
    }
  }

  // ---- Settings ----
  function loadSettings() {
    try {
      var s = JSON.parse(localStorage.getItem(SETTINGS_KEY));
      if (s && typeof s === "object") settings = Object.assign({}, DEFAULT_SETTINGS, s);
    } catch (e) {
      /* ignore */
    }
    fontSizeInput.value = settings.fontSize;
    lineHeightInput.value = settings.lineHeight;
    fontSizeVal.textContent = settings.fontSize;
    lineHeightVal.textContent = Number(settings.lineHeight).toFixed(2);
    syncSegActive();
    applySettings();
  }

  function persistSettings() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch (e) {
      /* ignore */
    }
  }

  function applySettings() {
    var root = document.documentElement;
    root.setAttribute("data-theme", settings.theme);
    root.style.setProperty("--doc-font-size", settings.fontSize + "px");
    root.style.setProperty("--doc-line-height", String(settings.lineHeight));
    root.style.setProperty("--doc-font", fontStacks[settings.font] || fontStacks.system);
    syncSegActive();
    // Re-render so diagrams pick up the new theme.
    if (docLoaded) render(current.content);
  }

  function syncSegActive() {
    fontSegItems.forEach(function (b) {
      b.classList.toggle("active", b.getAttribute("data-font") === settings.font);
    });
    themeSegItems.forEach(function (b) {
      b.classList.toggle("active", b.getAttribute("data-theme") === settings.theme);
    });
  }

  function openSettings() {
    settingsModal.classList.add("open");
    settingsModal.setAttribute("aria-hidden", "false");
  }
  function hideSettings() {
    settingsModal.classList.remove("open");
    settingsModal.setAttribute("aria-hidden", "true");
  }

  // ---- UI bindings ----
  function bindUI() {
    if (fabOpen) fabOpen.addEventListener("click", openDialog);
    if (fabSave) fabSave.addEventListener("click", save);
    if (fabTop) fabTop.addEventListener("click", scrollToTop);
    fabSource.addEventListener("click", toggleSource);
    fabOutline.addEventListener("click", function () {
      toggleOutline();
    });
    fabSettings.addEventListener("click", openSettings);
    $("outline-close").addEventListener("click", function () {
      toggleOutline(false);
    });
    $("empty-open").addEventListener("click", openDialog);
    $("empty-new").addEventListener("click", newDoc);

    settingsModal.addEventListener("click", function (e) {
      // Use closest() so clicks on child nodes (e.g. an icon inside the button)
      // still resolve to the [data-close] trigger.
      if (e.target && e.target.closest('[data-close="settings"]')) hideSettings();
    });

    sourceEl.addEventListener("input", function () {
      current.content = sourceEl.value;
      setDirty(current.content !== lastSaved);
      sizeSource();
    });

    fontSegItems.forEach(function (b) {
      b.addEventListener("click", function () {
        settings.font = b.getAttribute("data-font");
        persistSettings();
        applySettings();
      });
    });
    themeSegItems.forEach(function (b) {
      b.addEventListener("click", function () {
        settings.theme = b.getAttribute("data-theme");
        persistSettings();
        applySettings();
      });
    });
    fontSizeInput.addEventListener("input", function () {
      settings.fontSize = parseInt(fontSizeInput.value, 10);
      fontSizeVal.textContent = settings.fontSize;
      persistSettings();
      applySettings();
    });
    lineHeightInput.addEventListener("input", function () {
      settings.lineHeight = parseFloat(lineHeightInput.value);
      lineHeightVal.textContent = settings.lineHeight.toFixed(2);
      persistSettings();
      applySettings();
    });

    // Tray behaviour switches — take effect immediately (no restart needed).
    if (closeTrayEl) {
      closeTrayEl.addEventListener("change", function () {
        tray.closeToTray = closeTrayEl.checked;
        invoke("set_close_to_tray", { value: tray.closeToTray }).catch(function () {});
      });
    }
    if (minTrayEl) {
      minTrayEl.addEventListener("change", function () {
        tray.minimizeToTray = minTrayEl.checked;
        invoke("set_minimize_to_tray", { value: tray.minimizeToTray }).catch(function () {});
      });
    }
  }

  function bindShortcuts() {
    document.addEventListener("keydown", function (e) {
      var mod = e.ctrlKey || e.metaKey;
      if (mod && (e.key === "s" || e.key === "S")) {
        e.preventDefault();
        save();
      } else if (mod && (e.key === "o" || e.key === "O")) {
        e.preventDefault();
        openDialog();
      } else if (e.key === "Escape") {
        hideSettings();
        toggleOutline(false);
      }
    });
  }

  // ---- Custom window controls (borderless window) ----
  function bindWindowControls() {
    if (!appWindow) return; // running outside Tauri (e.g. browser preview)

    // Drag the window from any element marked as a drag region (top bar, etc).
    // `data-tauri-drag-region` alone is unreliable across WebView versions, so
    // we explicitly start the native drag on pointer-down.
    var dragRegions = document.querySelectorAll("[data-tauri-drag-region]");
    Array.prototype.forEach.call(dragRegions, function (el) {
      var onDown = function (e) {
        // Let real interactive controls (buttons, links, inputs) work normally.
        if (e.target.closest("button, a, input, textarea, select, [data-no-drag]")) return;
        if (e.button != null && e.button !== 0) return; // only left button / touch
        try {
          appWindow.startDragging();
        } catch (err) {
          console.error(err);
        }
      };
      el.addEventListener("mousedown", onDown);
      el.addEventListener("touchstart", onDown, { passive: true });
    });

    var wmin = $("win-min"),
      wmax = $("win-max"),
      wclose = $("win-close");
    function guard(fn) {
      return function (e) {
        e.preventDefault();
        try {
          fn();
        } catch (err) {
          console.error(err);
        }
      };
    }
    if (wmin) wmin.addEventListener("click", guard(function () {
      // Respect the "minimize to tray" setting: hide the window so it lives in
      // the system tray instead of sitting on the taskbar.
      if (tray.minimizeToTray) appWindow.hide();
      else appWindow.minimize();
    }));
    if (wmax) wmax.addEventListener("click", guard(function () { appWindow.toggleMaximize(); }));
    if (wclose) wclose.addEventListener("click", guard(function () { appWindow.close(); }));
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
