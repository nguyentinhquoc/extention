class TextEditor {
  constructor() {
    this.isEditing = false;
    this.originalContents = new Map();
    this.editedElements = new Set();
    this.currentPageKey = null;
    this.settings = { showIndicators: true };
    this.saveTimeout = null;
    this.observer = null;
    this.urlCheckInterval = null;
    this.urlChangeTimeout = null;
    this.init();
  }

  init() {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => this.initializeEditor());
    } else {
      this.initializeEditor();
    }
  }

  initializeEditor() {
    this.generatePageKey();
    this.injectStyles();
    this.loadSettings();
    this.loadSavedEdits();
    this.setupObservers();
    this.setupUrlChangeListener();
    console.log("✅ Text Editor đã khởi động");
  }

  generatePageKey() {
    try {
      const url = new URL(window.location.href);
      const href = url.href;

      // For TikTok Ads Manage and Facebook Ads Manager, ignore query parameters
      const ignoreQuery =
        href.startsWith("https://ads.tiktok.com/i18n/manage") ||
        href.startsWith("https://adsmanager.facebook.com/adsmanager");

      this.currentPageKey = ignoreQuery
        ? "page_" + url.hostname + url.pathname
        : "page_" + url.hostname + url.pathname + url.search;
    } catch (error) {
      this.currentPageKey = "page_" + window.location.hostname + window.location.pathname;
    }
  }

  injectStyles() {
    const styleId = "text-editor-styles";
    if (document.getElementById(styleId)) return;

    const css = `
      /* Editing mode indicator */
      .text-editor-editing {
        outline: 2px dashed #70f !important;
        cursor: pointer !important;
        background: rgba(119, 0, 255, 0.05) !important;
        border-radius: 4px !important;
        padding: 2px 6px !important;
        min-height: 1.2em !important;
        position: relative !important;
        z-index: 9999 !important;
      }

      /* Disable links when editing mode is active */
      body.text-editor-active a {
        pointer-events: none !important;
        cursor: text !important;
        opacity: 0.6 !important;
      }

      /* Edited element styling */
      .text-editor-edited {
        position: relative !important;
        transition: all 0.2s ease !important;
      }

      /* Toast notification */
      .text-editor-toast {
        position: fixed !important;
        top: 20px !important;
        right: 20px !important;
        background: linear-gradient(135deg, #333, #555) !important;
        color: white !important;
        padding: 12px 24px !important;
        border-radius: 10px !important;
        z-index: 1000000 !important;
        font-family: 'Segoe UI', sans-serif !important;
        font-size: 14px !important;
        box-shadow: 0 6px 20px rgba(0,0,0,0.2) !important;
        animation: textEditorToast 3s ease !important;
        max-width: 300px !important;
        display: flex !important;
        align-items: center !important;
        gap: 10px !important;
        backdrop-filter: blur(10px) !important;
        border: 1px solid rgba(255,255,255,0.1) !important;
      }

      @keyframes textEditorToast {
        0% { transform: translateX(100%) translateY(-20px); opacity: 0; }
        15% { transform: translateX(0) translateY(0); opacity: 1; }
        85% { transform: translateX(0) translateY(0); opacity: 1; }
        100% { transform: translateX(100%) translateY(-20px); opacity: 0; }
      }
    `;

    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = css;
    document.head.appendChild(style);
  }

  loadSettings() {
    chrome.storage.sync.get(["showIndicators"], (result) => {
      this.settings.showIndicators = result.showIndicators !== false;
    });
  }

  async loadSavedEdits() {
    try {
      const result = await chrome.storage.local.get([this.currentPageKey]);
      const pageData = result[this.currentPageKey];

      if (!pageData) return;

      this.savedPageData = pageData;
      this.applyAllEdits();

      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", () => this.applyAllEdits());
      }

      if (document.readyState !== "complete") {
        window.addEventListener("load", () => this.applyAllEdits());
      }
    } catch (error) {
      console.log("Error loading edits:", error);
    }
  }

  applyAllEdits() {
    if (!this.savedPageData || this.isApplyingEdits) return; // THÊM KIỂM TRA
    this.isApplyingEdits = true; // BẮT ĐẦU APPLY
    Object.entries(this.savedPageData).forEach(([selector, content]) => {
      try {
        const element = document.querySelector(selector);
        if (element && !element.classList.contains("text-editor-edited")) {
          this.applyEdit(element, content.content || content);
        }
      } catch (error) {}
    });
    setTimeout(() => {
      this.isApplyingEdits = false;
    }, 100);
  }

  applyEdit(element, content) {
    if (!element || !content) return;
    const selector = this.generateSelector(element);
    if (!this.originalContents.has(selector)) {
      this.originalContents.set(selector, element.innerHTML);
    }
    if (!element.getAttribute("data-text-editor-original")) {
      element.setAttribute("data-text-editor-original", element.innerHTML);
    }
    element.innerHTML = content;
    element.classList.add("text-editor-edited");
  }

  enableEditing() {
    if (this.isEditing) return;

    this.isEditing = true;
    document.body.style.cursor = "text";
    document.body.classList.add("text-editor-active");
    this.addEventListeners();
    this.enableLinks();
    this.showToast("✎ Chế độ chỉnh sửa đã bật - Click vào text để sửa");
  }

  disableEditing() {
    if (!this.isEditing) return;

    this.isEditing = false;
    document.body.style.cursor = "default";
    document.body.classList.remove("text-editor-active");
    this.removeEventListeners();
    this.disableLinks();

    document.querySelectorAll('[contenteditable="true"]').forEach((el) => {
      el.contentEditable = false;
      el.classList.remove("text-editor-editing");
      el.classList.add("text-editor-edited");
    });

    this.showToast("⏸ Chế độ chỉnh sửa đã tắt");
  }

  addEventListeners() {
    this.handleClick = this.handleClick.bind(this);
    this.handleInput = this.handleInput.bind(this);
    this.handleBlur = this.handleBlur.bind(this);
    this.handleKeyDown = this.handleKeyDown.bind(this);
    this.handleLinkClick = this.handleLinkClick.bind(this);

    document.addEventListener("click", this.handleClick, true);
    document.addEventListener("input", this.handleInput, true);
    document.addEventListener("blur", this.handleBlur, true);
    document.addEventListener("keydown", this.handleKeyDown, true);
  }

  removeEventListeners() {
    document.removeEventListener("click", this.handleClick, true);
    document.removeEventListener("input", this.handleInput, true);
    document.removeEventListener("blur", this.handleBlur, true);
    document.removeEventListener("keydown", this.handleKeyDown, true);
  }

  enableLinks() {
    document.querySelectorAll("a").forEach((link) => {
      link.addEventListener("click", this.handleLinkClick, true);
    });
  }

  disableLinks() {
    document.querySelectorAll("a").forEach((link) => {
      link.removeEventListener("click", this.handleLinkClick, true);
    });
  }

  handleLinkClick(event) {
    if (this.isEditing) {
      event.preventDefault();
      event.stopPropagation();
      return false;
    }
  }

  handleClick(event) {
    if (!this.isEditing || event.target.isContentEditable) return;

    const element = event.target;
    const skipTags = ["INPUT", "TEXTAREA", "SELECT", "BUTTON", "A"];

    if (skipTags.includes(element.tagName)) return;

    const hasText = element.textContent && element.textContent.trim().length > 0;
    const isEditable = element.closest('[contenteditable="true"]');

    if (hasText && !isEditable) {
      event.preventDefault();
      event.stopPropagation();
      this.startEditing(element);
    }
  }

  startEditing(element) {
    const selector = this.generateSelector(element);
    if (!this.originalContents.has(selector)) {
      this.originalContents.set(selector, element.innerHTML);
    }
    if (!element.getAttribute("data-text-editor-original")) {
      element.setAttribute("data-text-editor-original", element.innerHTML);
    }
    element.contentEditable = true;
    element.spellcheck = true;
    element.lang = "vi";
    element.classList.add("text-editor-editing");
    element.focus();

    const range = document.createRange();
    const selection = window.getSelection();
    range.selectNodeContents(element);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  handleInput(event) {
    if (!this.isEditing) return;

    const target = event.target;
    if (target.isContentEditable) {
      clearTimeout(this.saveTimeout);
      this.saveTimeout = setTimeout(() => {
        this.saveEdit(target);
      }, 500);
    }
  }

  handleBlur(event) {
    if (!this.isEditing) return;

    const target = event.target;
    if (target.isContentEditable) {
      this.saveEdit(target);
      target.contentEditable = false;
      target.classList.remove("text-editor-editing");
      target.classList.add("text-editor-edited");
    }
  }

  handleKeyDown(event) {
    if (!this.isEditing) return;

    const target = event.target;
    if (target.isContentEditable) {
      if (event.key === "Escape") {
        target.blur();
      } else if (event.ctrlKey && event.key === "Enter") {
        target.blur();
        this.showToast("💾 Đã lưu thay đổi");
      }
    }
  }

  saveEdit(element) {
    const selector = this.generateSelector(element);
    const content = element.innerHTML;

    if (!chrome.runtime?.id) return;

    chrome.storage.local.get([this.currentPageKey], (result) => {
      const pageData = result[this.currentPageKey] || {};
      pageData[selector] = content;

      const data = {};
      data[this.currentPageKey] = pageData;

      chrome.storage.local.set(data, () => {
        if (chrome.runtime?.id) {
          chrome.runtime.sendMessage({ action: "updateStats" }).catch(() => {});
        }
      });
    });
  }

  resetPage() {
    this.originalContents.forEach((content, selector) => {
      const element = document.querySelector(selector);
      if (element) {
        element.innerHTML = content;
        element.classList.remove("text-editor-edited");
      }
    });

    if (!chrome.runtime?.id) return;

    chrome.storage.local.remove(this.currentPageKey, () => {
      this.originalContents.clear();
      this.editedElements.clear();
      this.showToast("🔄 Đã đặt lại trang này");
      if (chrome.runtime?.id) {
        chrome.runtime.sendMessage({ action: "updateStats" }).catch(() => {});
      }
    });
  }

  generateSelector(element) {
    if (!element || element.nodeType !== 1) return "";

    // If element has an ID, this is already unique and robust
    if (element.id) return "#" + CSS.escape(element.id);

    const root = document.body || document.documentElement;
    const path = [];
    const prefAttrs = [
      "data-testid",
      "data-test",
      "data-qa",
      "data-cy",
      "data-id",
      "aria-label",
      "name",
      "role",
      "type",
      "href",
      "title",
      "alt",
    ];

    const isUnique = (sel) => {
      try {
        return document.querySelectorAll(sel).length === 1;
      } catch (_) {
        return false;
      }
    };

    const buildNodeSelector = (el) => {
      const tag = el.tagName.toLowerCase();

      // Prefer stable attributes when available
      for (const attr of prefAttrs) {
        const val = el.getAttribute(attr);
        if (val && typeof val === "string" && val.trim().length > 0) {
          const safeVal = val.replace(/"/g, '\\"');
          return tag + "[" + attr + '="' + safeVal + '"]';
        }
      }

      // Fall back to class-based selector (limit few classes for brevity)
      let selector = tag;
      if (el.className && typeof el.className === "string") {
        const classes = el.className
          .trim()
          .split(/\s+/)
          .filter((cls) => cls && !cls.startsWith("text-editor"));
        if (classes.length > 0) {
          const subset = classes
            .slice(0, 3)
            .map((cls) => "." + CSS.escape(cls))
            .join("");
          selector += subset;
        }
      }

      // Add nth-child for disambiguation among siblings
      if (el.parentElement) {
        const index = Array.prototype.indexOf.call(el.parentElement.children, el) + 1;
        selector += ":nth-child(" + index + ")";
      }
      return selector;
    };

    // Ascend the DOM tree, stopping when selector becomes unique
    let current = element;
    while (current && current !== root && current.nodeType === 1) {
      if (current.id) {
        path.unshift("#" + CSS.escape(current.id));
        const sel = path.join(" > ");
        return sel;
      }

      const nodeSel = buildNodeSelector(current);
      path.unshift(nodeSel);
      const candidate = path.join(" > ");
      if (isUnique(candidate)) return candidate;

      current = current.parentElement;
    }

    // Final candidate (may be unique already)
    const finalCandidate = path.join(" > ");
    return finalCandidate;
  }

  showToast(message) {
    const toastId = "text-editor-toast";
    const existingToast = document.getElementById(toastId);
    if (existingToast) existingToast.remove();

    const toast = document.createElement("div");
    toast.id = toastId;
    toast.className = "text-editor-toast";
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => {
      if (toast.parentNode) {
        toast.remove();
      }
    }, 3000);
  }

  setupObservers() {
    this.observer = new MutationObserver((mutations) => {
      if (!this.savedPageData || this.isApplyingEdits || this.isHandlingUrlChange) return;

      let hasNewElements = false;
      mutations.forEach((mutation) => {
        if (mutation.addedNodes.length > 0) {
          hasNewElements = true;
        }
      });

      if (hasNewElements) {
        this.applyAllEdits();
      }
    });

    const startObserving = () => {
      if (document.body) {
        this.observer.observe(document.body, { childList: true, subtree: true });
      } else {
        setTimeout(startObserving, 10);
      }
    };

    startObserving();
  }

  // Theo dõi thay đổi URL (SPA) và reload để có DOM sạch
  setupUrlChangeListener() {
    // Tránh thiết lập nhiều lần
    if (window.__textEditorUrlListenerSetup) return;
    window.__textEditorUrlListenerSetup = true;

    let lastUrl = location.href;

    // Lắng nghe back/forward
    window.addEventListener("popstate", () => {
      this.handleUrlChange();
    });

    // Patch pushState/replaceState một lần
    if (!window.__textEditorHistoryPatched) {
      window.__textEditorHistoryPatched = true;
      const originalPushState = history.pushState;
      const originalReplaceState = history.replaceState;

      history.pushState = function (...args) {
        originalPushState.apply(this, args);
        window.dispatchEvent(new Event("pushstate"));
      };

      history.replaceState = function (...args) {
        originalReplaceState.apply(this, args);
        window.dispatchEvent(new Event("replacestate"));
      };
    }

    window.addEventListener("pushstate", () => {
      this.handleUrlChange();
    });
    window.addEventListener("replacestate", () => {
      this.handleUrlChange();
    });

    // Polling dự phòng cho SPA phức tạp
    if (this.urlCheckInterval) clearInterval(this.urlCheckInterval);
    this.urlCheckInterval = setInterval(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        this.handleUrlChange();
      }
    }, 1000);
  }

  // Debounce để tránh reload liên tiếp quá nhanh
  handleUrlChange() {
    clearTimeout(this.urlChangeTimeout);
    this.urlChangeTimeout = setTimeout(() => {
      this._doHandleUrlChange();
    }, 50);
  }

  // Reload trang khi URL thay đổi để lấy DOM sạch, tránh DOM bị trộn bởi React
  _doHandleUrlChange() {
    const oldKey = this.currentPageKey;
    this.generatePageKey();
    if (oldKey === this.currentPageKey) return;

    // Dọn dẹp mềm và re-apply dữ liệu cho URL mới
    this.cleanupForUrlChange();
    this.loadSavedEdits();
    this.setupObservers();
  }

  // Khôi phục chỉnh sửa về bản gốc và xoá dấu vết mà không reload
  cleanupForUrlChange() {
    if (this.observer) {
      try {
        this.observer.disconnect();
      } catch (_) {}
    }

    document.querySelectorAll(".text-editor-edited, .text-editor-editing").forEach((el) => {
      const attrOriginal = el.getAttribute("data-text-editor-original");
      if (attrOriginal != null) {
        el.innerHTML = attrOriginal;
        el.removeAttribute("data-text-editor-original");
      } else {
        // Fallback: khôi phục bằng selector nếu đã lưu
        try {
          const sel = this.generateSelector(el);
          if (this.originalContents.has(sel)) {
            el.innerHTML = this.originalContents.get(sel);
          }
        } catch (_) {}
      }
      el.classList.remove("text-editor-edited");
      el.classList.remove("text-editor-editing");
      el.contentEditable = false;
    });

    this.originalContents.clear();
    this.editedElements.clear();
    this.savedPageData = null;
  }

  handleMessage(message) {
    switch (message.action) {
      case "enableEditing":
        this.enableEditing();
        break;
      case "disableEditing":
        this.disableEditing();
        break;
      case "resetPage":
        this.resetPage();
        break;
      case "resetAll":
        this.resetPage();
        chrome.storage.local.clear();
        location.reload();
        break;
    }
  }
}

// Initialize TextEditor
try {
  if (!window.textEditor) {
    window.textEditor = new TextEditor();
  }
} catch (error) {
  console.log("Error initializing TextEditor:", error);
}

// Listen for messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  try {
    if (window.textEditor) {
      window.textEditor.handleMessage(message);
      sendResponse({ success: true });
    } else {
      sendResponse({ success: false, error: "TextEditor not initialized" });
    }
  } catch (error) {
    console.log("Error handling message:", error);
    sendResponse({ success: false, error: error.message });
  }
  return true;
});

// Auto-enable if setting is on
chrome.storage.sync.get(["autoEnable"], (result) => {
  if (result.autoEnable) {
    setTimeout(() => {
      if (window.textEditor) {
        window.textEditor.enableEditing();
      }
    }, 1500);
  }
});
