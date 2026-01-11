class TextEditor {
  constructor() {
    this.isEditing = false;
    this.originalContents = new Map();
    this.editedElements = new Set();
    this.currentPageKey = null;
    this.lastUrl = null;
    this.urlPollInterval = null;
    this.savedPageData = null;
    this.settings = {
      showIndicators: true,
    };
    this.saveTimeout = null;
    this.observer = null;
    this.handleClick = this.handleClick.bind(this);
    this.handleInput = this.handleInput.bind(this);
    this.handleBlur = this.handleBlur.bind(this);
    this.handleKeyDown = this.handleKeyDown.bind(this);
    this.handleLinkClick = this.handleLinkClick.bind(this);
    this.init();
  }

  init() {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => {
        this.initializeEditor();
      });
    } else {
      this.initializeEditor();
    }
  }

  initializeEditor() {
    this.ensureCssEscape();
    this.generatePageKey();
    this.injectStyles();
    this.loadSettings();
    this.loadSavedEdits();
    this.setupObservers();
    this.setupUrlChangeReload();
    console.log("✅ Text Editor đã khởi động");
  }

  generatePageKey() {
    try {
      const url = new URL(window.location.href);
      if (url.hostname === "adsmanager.facebook.com") {
        this.currentPageKey = "page_" + url.hostname + url.pathname;
      } else {
        this.currentPageKey = "page_" + url.hostname + url.pathname + url.search;
      }
    } catch (e) {
      this.currentPageKey = "page_" + window.location.hostname + window.location.pathname;
    }
  }

  injectStyles() {
    const styleId = "text-editor-styles";
    if (document.getElementById(styleId)) return;

    const styles = `
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
                0% {
                    transform: translateX(100%) translateY(-20px);
                    opacity: 0;
                }
                15% {
                    transform: translateX(0) translateY(0);
                    opacity: 1;
                }
                85% {
                    transform: translateX(0) translateY(0);
                    opacity: 1;
                }
                100% {
                    transform: translateX(100%) translateY(-20px);
                    opacity: 0;
                }
            }
        `;

    const styleEl = document.createElement("style");
    styleEl.id = styleId;
    styleEl.textContent = styles;
    document.head.appendChild(styleEl);
  }

  loadSettings() {
    chrome.storage.sync.get(["showIndicators"], (result) => {
      this.settings.showIndicators = result.showIndicators !== false;
    });
  }

  async loadSavedEdits() {
    try {
      const data = await chrome.storage.local.get([this.currentPageKey]);
      const savedData = data[this.currentPageKey];
      if (!savedData) return;

      this.savedPageData = savedData;
      this.applyAllEdits();

      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", () => {
          this.applyAllEdits();
        });
      }

      if (document.readyState !== "complete") {
        window.addEventListener("load", () => {
          this.applyAllEdits();
        });
      }
    } catch (error) {
      console.error("Error loading edits:", error);
    }
  }

  applyAllEdits() {
    if (!this.savedPageData) return;

    Object.entries(this.savedPageData).forEach(([selector, contentData]) => {
      try {
        const element = document.querySelector(selector);
        if (element && !element.classList.contains("text-editor-edited")) {
          this.applyEdit(element, contentData.content || contentData);
        }
      } catch (e) {
        // Ignore errors
      }
    });
  }

  applyEdit(element, content) {
    if (!element || !content) return;

    const selector = this.generateSelector(element);
    if (!this.originalContents.has(selector)) {
      this.originalContents.set(selector, element.innerHTML);
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
    const ignoreTags = ["INPUT", "TEXTAREA", "SELECT", "BUTTON", "A"];
    if (ignoreTags.includes(element.tagName)) return;

    const hasText = element.textContent && element.textContent.trim().length > 0;
    const isAlreadyEditable = element.getAttribute("contenteditable");

    if (hasText && !isAlreadyEditable) {
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
    if (target.contentEditable) {
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
    if (target.contentEditable) {
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

      const saveData = {};
      saveData[this.currentPageKey] = pageData;
      chrome.storage.local.set(saveData, () => {
        try {
          if (chrome.runtime?.id) {
            chrome.runtime.sendMessage({ action: "updateStats" });
          }
        } catch (_) {
          // ignore messaging errors
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
      try {
        if (chrome.runtime?.id) {
          chrome.runtime.sendMessage({ action: "updateStats" });
        }
      } catch (_) {
        // ignore messaging errors
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
    const existingToast = document.getElementById("text-editor-toast");
    if (existingToast) existingToast.remove();

    const toast = document.createElement("div");
    toast.id = "text-editor-toast";
    toast.className = "text-editor-toast";
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => {
      if (toast.parentNode) {
        toast.remove();
      }
    }, 3000);
  }

  // Detect URL changes (including SPA) and reload the page
  setupUrlChangeReload() {
    try {
      this.lastUrl = window.location.href;
      const reloadIfUrlChanged = () => {
        const current = window.location.href;
        if (current !== this.lastUrl) {
          this.lastUrl = current;
          // Force full reload to ensure content script reinitializes
          window.location.reload();
        }
      };

      // Listen to standard navigation-related events
      window.addEventListener("popstate", reloadIfUrlChanged, true);
      window.addEventListener("hashchange", reloadIfUrlChanged, true);

      // Fallback polling in case no event fires
      this.urlPollInterval = setInterval(reloadIfUrlChanged, 800);

      window.addEventListener("beforeunload", () => {
        if (this.urlPollInterval) {
          clearInterval(this.urlPollInterval);
          this.urlPollInterval = null;
        }
      });
    } catch (e) {
      // As a fallback, simple polling
      try {
        if (!this.urlPollInterval) {
          this.urlPollInterval = setInterval(() => {
            if (window.location.href !== this.lastUrl) {
              this.lastUrl = window.location.href;
              window.location.reload();
            }
          }, 1000);
        }
      } catch (_) {}
    }
  }

  ensureCssEscape() {
    try {
      if (!window.CSS) {
        window.CSS = {};
      }
      if (typeof window.CSS.escape !== "function") {
        window.CSS.escape = function (value) {
          return String(value).replace(/[^a-zA-Z0-9_\-]/g, function (s) {
            return "\\" + s;
          });
        };
      }
    } catch (_) {}
  }

  setupObservers() {
    this.observer = new MutationObserver((mutations) => {
      if (!this.savedPageData) return;

      let hasNewNodes = false;
      mutations.forEach((mutation) => {
        if (mutation.addedNodes.length > 0) {
          hasNewNodes = true;
        }
      });

      if (hasNewNodes) {
        this.applyAllEdits();
      }
    });

    const observeBody = () => {
      if (document.body) {
        this.observer.observe(document.body, { childList: true, subtree: true });
      } else {
        setTimeout(observeBody, 10);
      }
    };

    observeBody();

    // Cleanup observer on page unload
    window.addEventListener("beforeunload", () => {
      try {
        if (this.observer) this.observer.disconnect();
      } catch (_) {}
    });
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

// Khởi tạo TextEditor
try {
  if (!window.textEditor) {
    window.textEditor = new TextEditor();
  }
} catch (error) {
  console.error("Error initializing TextEditor:", error);
}

// Lắng nghe messages từ extension
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  try {
    if (window.textEditor) {
      window.textEditor.handleMessage(message);
      sendResponse({ success: true });
    } else {
      sendResponse({ success: false, error: "TextEditor not initialized" });
    }
  } catch (error) {
    console.error("Error handling message:", error);
    sendResponse({ success: false, error: error.message });
  }
  return true;
});

// Tự động bật chế độ chỉnh sửa nếu được cấu hình
chrome.storage.sync.get(["autoEnable"], (result) => {
  if (result.autoEnable) {
    setTimeout(() => {
      if (window.textEditor) {
        window.textEditor.enableEditing();
      }
    }, 1500);
  }
});
