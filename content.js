/*
  MÔ TẢ TỔNG QUAN (Tiếng Việt)
  ---------------------------------
  Đây là content script cho Extension "Text Editor - Sửa Văn Bản".
  Nhiệm vụ chính:
  - Cho phép click vào text trên trang web để sửa nội dung (contentEditable)
  - Lưu các chỉnh sửa theo từng trang (key theo URL) vào chrome.storage.local
  - Tự động khôi phục các chỉnh sửa khi tải lại trang hoặc khi DOM thay đổi
  - Theo dõi thay đổi URL kiểu SPA (React/History API) để áp dụng dữ liệu tương ứng

  Luồng khởi động:
  1) constructor -> init() -> initializeEditor()
  2) generatePageKey() tạo khoá lưu theo URL hiện tại
  3) injectStyles() tiêm CSS cần thiết cho chế độ chỉnh sửa + toast
  4) loadSettings() tải tuỳ chọn người dùng (hiển thị indicator, auto-enable...)
  5) loadSavedEdits() tải dữ liệu đã lưu và thử áp vào DOM
  6) setupObservers() theo dõi DOM thay đổi để re-apply khi cần
  7) setupUrlChangeListener() theo dõi URL thay đổi kiểu SPA
*/
class TextEditor {
  constructor() {
    // Trạng thái đang bật chế độ chỉnh sửa hay không
    this.isEditing = false;
    // Lưu bản gốc (innerHTML) của các phần tử đã sửa để có thể reset nhanh
    this.originalContents = new Map();
    // Tập hợp các indicator/đánh dấu (nếu dùng)
    this.indicators = new Set();
    // Khoá trang hiện tại (page_<host><path><query> hoặc biến thể tuỳ site)
    this.currentPageKey = null;
    // Cài đặt mở rộng, có thể đồng bộ qua chrome.storage.sync
    this.settings = {
      showIndicators: true,
    };
    // Interval check URL kiểu polling (dự phòng cho một số SPA)
    this.urlCheckInterval = null;
    // Hẹn giờ chống dồn (debounce) khi apply nhiều lần liên tiếp
    this.applyDebounceTimer = null;
    // Khởi tạo ngay khi content script được nạp
    this.init();
  }

  init() {
    // Chờ DOM cơ bản sẵn sàng trước khi khởi tạo chính
    // Wait for basic document structure
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => {
        this.initializeEditor();
      });
    } else {
      this.initializeEditor();
    }
  }

  initializeEditor() {
    // 1) Tạo khoá trang theo URL hiện tại
    this.generatePageKey();
    // 2) Tiêm CSS phục vụ chế độ chỉnh sửa / toast
    this.injectStyles();
    // 3) Tải tuỳ chọn người dùng (từ storage.sync)
    this.loadSettings();
    // 4) Tải dữ liệu đã lưu và cố gắng áp vào DOM
    this.loadSavedEdits();
    // 5) Quan sát DOM thay đổi để re-apply khi có nội dung mới
    this.setupObservers();
    // 6) Theo dõi thay đổi URL (SPA) để nạp dữ liệu trang mới
    this.setupUrlChangeListener();

    console.log("✅ Text Editor đã khởi động");
  }

  generatePageKey() {
    // Tạo khoá lưu dữ liệu theo URL. Với một số trang đặc biệt (FB Ads Manager)
    // chỉ dùng hostname + pathname để tránh key bị thay đổi liên tục bởi query.
    try {
      const url = new URL(window.location.href);

      // Với Facebook Ads Manager, chỉ dùng hostname + pathname (bỏ query)
      if (url.href.startsWith("https://adsmanager.facebook.com")) {
        this.currentPageKey = `page_${url.hostname}${url.pathname}`;
      } else {
        // Các trang khác giữ nguyên query parameters
        this.currentPageKey = `page_${url.hostname}${url.pathname}${url.search}`;
      }
    } catch (e) {
      // Fallback if URL parsing fails
      this.currentPageKey = `page_${window.location.hostname}${window.location.pathname}`;
    }
  }

  injectStyles() {
    // Tiêm style một lần; nếu đã có thì bỏ qua để tránh trùng lặp
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

      /* Hide element until JS applies saved value */
      .text-editor-pending {
        visibility: hidden !important; /* keeps layout stable */
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

    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = css;
    document.head.appendChild(style);
  }

  loadSettings() {
    // Đọc cài đặt hiển thị indicator từ storage.sync (mặc định true)
    chrome.storage.sync.get(["showIndicators"], (data) => {
      this.settings.showIndicators = data.showIndicators !== false;
    });
  }

  async loadSavedEdits() {
    // Tải dữ liệu đã lưu cho trang hiện tại và cố gắng áp ngay
    try {
      const result = await chrome.storage.local.get([this.currentPageKey]);
      const pageData = result[this.currentPageKey];

      if (!pageData) return;

      // Store pageData for later use
      this.savedPageData = pageData;

      // Immediately mark targets as pending (hide) when possible
      this.markPendingTargets();

      // Try to apply immediately
      this.applyAllEdits();

      // Nếu DOM chưa sẵn sàng, chờ DOMContentLoaded
      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", () => {
          this.markPendingTargets();
          this.applyAllEdits();
        });
      }

      // Nếu trang đã load xong, nhưng có thể có script thêm nội dung sau đó
      if (document.readyState !== "complete") {
        window.addEventListener("load", () => {
          this.markPendingTargets();
          this.applyAllEdits();
        });
      }
    } catch (error) {
      console.error("Error loading edits:", error);
    }
  }

  // Mark elements that will be updated as pending (hidden) until JS sets content
  markPendingTargets() {
    if (!this.savedPageData) return;

    try {
      const currentUrl = window.location.href;
      Object.entries(this.savedPageData).forEach(([selector, data]) => {
        let savedUrl = null;
        if (typeof data !== "string") {
          savedUrl = data.url;
        }
        if (savedUrl && savedUrl !== currentUrl) return;

        try {
          const elements = document.querySelectorAll(selector);
          if (elements.length === 1) {
            const el = elements[0];
            if (!el.classList.contains("text-editor-edited")) {
              el.classList.add("text-editor-pending");
            }
          }
        } catch (_) {
          // ignore invalid selectors here
        }
      });
    } catch (_) {
      // noop
    }
  }

  // Chống dồn: chỉ thực thi _doApplyAllEdits sau 100ms kể từ lần gọi cuối
  applyAllEdits() {
    // Debounce to prevent excessive calls
    clearTimeout(this.applyDebounceTimer);
    this.applyDebounceTimer = setTimeout(() => {
      this._doApplyAllEdits();
    }, 100);
  }

  _doApplyAllEdits() {
    // Duyệt qua dữ liệu đã lưu và cố gắng map selector -> element duy nhất
    if (!this.savedPageData) return;

    const currentUrl = window.location.href;

    Object.entries(this.savedPageData).forEach(([selector, data]) => {
      // Hỗ trợ cả format cũ (data = string) và format mới (data = {content, url})
      let content, savedUrl;
      if (typeof data === "string") {
        content = data; // Format cũ: chỉ có content
        savedUrl = null;
      } else {
        content = data.content;
        savedUrl = data.url;
      }

      // ⚠️ VALIDATION: Chỉ áp dụng edit nếu URL khớp chính xác
      // (hoặc không có URL được lưu - backward compatibility)
      if (savedUrl && savedUrl !== currentUrl) {
        console.warn(
          `⚠️ Skipping edit for "${selector}": URL mismatch\n   Saved: ${savedUrl}\n   Current: ${currentUrl}`
        );
        return; // Skip edit này
      }

      try {
        const elements = document.querySelectorAll(selector);

        // CRITICAL: Only apply if selector matches exactly 1 element
        // Chỉ áp dụng khi selector trỏ tới đúng 1 phần tử (tránh ghi đè sai)
        if (elements.length === 1) {
          const element = elements[0];
          if (!element.classList.contains("text-editor-edited")) {
            console.log(`✅ Applying edit to unique element: ${selector}`);
            this.applyEdit(element, content);
          }
        } else if (elements.length > 1) {
          // Nhiều hơn 1 phần tử -> selector chưa đủ đặc trưng
          console.warn(`⚠️ Selector matches ${elements.length} elements, skipping: ${selector}`);
          // TODO: Could regenerate selector for better specificity
        } else {
          // Không tìm thấy phần tử tương ứng selector
          console.warn(`⚠️ No elements found for selector: ${selector}`);
        }
      } catch (e) {
        console.error(`❌ Invalid selector: ${selector}`, e);
      }
    });
  }

  applyEdit(element, content) {
    // Áp nội dung đã chỉnh sửa vào phần tử và đánh dấu đã sửa
    if (!element || !content) return;

    // Save original content
    const selector = this.generateSelector(element);
    if (!this.originalContents.has(selector)) {
      this.originalContents.set(selector, element.innerHTML);
    }

    // Apply new content
    element.innerHTML = content;
    // Unhide after content has been applied
    element.classList.remove("text-editor-pending");
    element.classList.add("text-editor-edited");
  }

  // Bật chế độ sửa: đổi con trỏ, thêm class vào body, gắn listeners
  enableEditing() {
    if (this.isEditing) return;

    this.isEditing = true;
    document.body.style.cursor = "text";
    document.body.classList.add("text-editor-active");

    // Add event listeners
    this.addEventListeners();

    // Disable all links
    this.disableLinks();

    this.showToast("✎ Chế độ chỉnh sửa đã bật - Click vào text để sửa");
  }

  // Tắt chế độ sửa: bỏ listeners, khôi phục trạng thái con trỏ/link
  disableEditing() {
    if (!this.isEditing) return;

    this.isEditing = false;
    document.body.style.cursor = "default";
    document.body.classList.remove("text-editor-active");

    // Remove event listeners
    this.removeEventListeners();

    // Enable all links
    this.enableLinks();

    // Exit all editing elements
    document.querySelectorAll('[contenteditable="true"]').forEach((el) => {
      el.contentEditable = false;
      el.classList.remove("text-editor-editing");
    });

    this.showToast("⏸ Chế độ chỉnh sửa đã tắt");
  }

  // Ràng buộc ngữ cảnh this và đăng ký các sự kiện cần thiết khi chỉnh sửa
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

  // Gỡ các listeners khi tắt chế độ chỉnh sửa
  removeEventListeners() {
    document.removeEventListener("click", this.handleClick, true);
    document.removeEventListener("input", this.handleInput, true);
    document.removeEventListener("blur", this.handleBlur, true);
    document.removeEventListener("keydown", this.handleKeyDown, true);
  }

  // Chặn click vào thẻ <a> khi đang ở chế độ chỉnh sửa
  disableLinks() {
    // Add event listener to prevent link clicks
    document.querySelectorAll("a").forEach((link) => {
      link.addEventListener("click", this.handleLinkClick, true);
    });
  }

  // Khôi phục hành vi mặc định của link khi tắt chỉnh sửa
  enableLinks() {
    // Remove event listener from links
    document.querySelectorAll("a").forEach((link) => {
      link.removeEventListener("click", this.handleLinkClick, true);
    });
  }

  handleLinkClick(e) {
    // Khi đang chỉnh sửa thì chặn điều hướng link
    if (this.isEditing) {
      e.preventDefault();
      e.stopPropagation();
      return false;
    }
  }

  // Khi click vào phần tử văn bản (không phải input/button/anchor), bật contentEditable
  handleClick(e) {
    if (!this.isEditing || e.target.isContentEditable) return;

    const element = e.target;
    const ignoreTags = ["INPUT", "TEXTAREA", "SELECT", "BUTTON", "A"];

    if (ignoreTags.includes(element.tagName)) return;

    const hasText = element.textContent && element.textContent.trim().length > 0;
    const hasEditableChild = element.querySelector('input, textarea, [contenteditable="true"]');

    if (hasText && !hasEditableChild) {
      e.preventDefault();
      e.stopPropagation();

      this.startEditing(element);
    }
  }

  // Bắt đầu chế độ chỉnh sửa cho 1 phần tử
  startEditing(element) {
    const selector = this.generateSelector(element);

    // Save original
    if (!this.originalContents.has(selector)) {
      this.originalContents.set(selector, element.innerHTML);
    }

    // Enable editing
    element.contentEditable = true;
    element.spellcheck = true;
    element.lang = "vi";
    element.classList.add("text-editor-editing");

    // Focus and select
    element.focus();

    // Move cursor to end
    const range = document.createRange();
    const sel = window.getSelection();
    range.selectNodeContents(element);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  handleInput(e) {
    // Lưu tự động sau 500ms kể từ lần nhập gần nhất (debounce)
    if (!this.isEditing) return;

    const element = e.target;
    if (element.isContentEditable) {
      clearTimeout(this.saveTimeout);
      this.saveTimeout = setTimeout(() => {
        this.saveEdit(element);
      }, 500);
    }
  }

  // Khi blur, lưu ngay và kết thúc chế độ chỉnh sửa cho phần tử đó
  handleBlur(e) {
    if (!this.isEditing) return;

    const element = e.target;
    if (element.isContentEditable) {
      this.saveEdit(element);
      element.contentEditable = false;
      element.classList.remove("text-editor-editing");
      element.classList.add("text-editor-edited");
    }
  }

  handleKeyDown(e) {
    // Phím tắt: ESC để huỷ, Ctrl+Enter để lưu nhanh
    if (!this.isEditing) return;

    const element = e.target;
    if (element.isContentEditable) {
      if (e.key === "Escape") {
        element.blur();
      } else if (e.ctrlKey && e.key === "Enter") {
        element.blur();
        this.showToast("💾 Đã lưu thay đổi");
      }
    }
  }

  // Ghi nội dung đã sửa vào storage.local dưới khoá trang hiện tại
  saveEdit(element) {
    const selector = this.generateSelector(element);
    const content = element.innerHTML;

    // Check if extension context is still valid
    if (!chrome.runtime?.id) return;

    chrome.storage.local.get([this.currentPageKey], (result) => {
      const pageData = result[this.currentPageKey] || {};
      // Lưu cả URL và content để validate sau này
      pageData[selector] = {
        content: content,
        url: window.location.href,
        savedAt: Date.now(),
      };

      const update = {};
      update[this.currentPageKey] = pageData;

      chrome.storage.local.set(update, () => {
        // Notify popup - ignore errors if popup is closed
        if (chrome.runtime?.id) {
          chrome.runtime.sendMessage({ action: "updateStats" }).catch(() => {});
        }
      });
    });
  }

  // Khôi phục toàn bộ phần tử đã sửa về bản gốc và xoá dữ liệu đã lưu của trang
  resetPage() {
    // Restore all original content
    this.originalContents.forEach((content, selector) => {
      const element = document.querySelector(selector);
      if (element) {
        element.innerHTML = content;
        element.classList.remove("text-editor-edited");
        element.classList.remove("text-editor-pending");
      }
    });

    // Clear storage for this page
    if (!chrome.runtime?.id) return;

    chrome.storage.local.remove(this.currentPageKey, () => {
      this.originalContents.clear();
      this.indicators.clear();

      this.showToast("🔄 Đã đặt lại trang này");
      if (chrome.runtime?.id) {
        chrome.runtime.sendMessage({ action: "updateStats" }).catch(() => {});
      }
    });
  }

  generateSelector(element) {
    // Sinh selector đủ đặc trưng để map đúng 1 phần tử. Thử cách đơn giản,
    // nếu trùng/lỗi sẽ fallback sang phương pháp sâu hơn (deep path selector).
    // Try to get a unique selector with better specificity
    if (element.id) {
      return `#${CSS.escape(element.id)}`;
    }

    // Use simpler, more reliable approach
    const selector = this.buildSimplePathSelector(element);

    // Validate the selector works
    try {
      const matches = document.querySelectorAll(selector);
      if (matches.length === 1 && matches[0] === element) {
        console.log(`✅ Generated unique selector: ${selector}`);
        return selector;
      } else {
        console.warn(`⚠️ Generated selector matches ${matches.length} elements: ${selector}`);
        // Try to make it more specific by adding more parent context
        return this.buildDeepPathSelector(element);
      }
    } catch (e) {
      console.error(`❌ Invalid selector generated: ${selector}`, e);
      return this.buildDeepPathSelector(element);
    }
  }

  buildPathSelector(element) {
    // Xây dựng selector chi tiết theo đường đi DOM (độ sâu lớn hơn)
    const path = [];
    let currentElement = element;
    let depth = 0;
    const maxDepth = 15; // Increase significantly for complex nested tables

    while (currentElement && currentElement !== document.body && depth < maxDepth) {
      let selector = currentElement.tagName.toLowerCase();

      // Add ID if exists
      if (currentElement.id) {
        selector = `#${CSS.escape(currentElement.id)}`;
        path.unshift(selector);
        break;
      }

      // Add ALL meaningful classes (not just first 2)
      if (currentElement.className && typeof currentElement.className === "string") {
        const classes = currentElement.className
          .trim()
          .split(/\s+/)
          .filter((c) => c && !c.startsWith("text-editor") && c.length > 1);

        if (classes.length > 0) {
          selector += "." + classes.map((c) => CSS.escape(c)).join(".");
        }
      }

      // Add meaningful attributes for extra specificity
      selector = this.addMeaningfulAttributes(currentElement, selector);

      // CRITICAL: Skip virtual attributes, rely on CSS selectors only
      // Row identification will be handled by position and classes

      // Enhanced positioning for table elements
      if (currentElement.tagName === "TD" || currentElement.tagName === "TH") {
        const row = currentElement.parentElement;
        if (row && row.tagName === "TR") {
          const cells = Array.from(row.children);
          const cellIndex = cells.indexOf(currentElement);
          if (cellIndex !== -1) {
            selector += `:nth-child(${cellIndex + 1})`;
          }
        }
      } else if (currentElement.tagName === "TR" || currentElement.classList?.contains("row-item")) {
        // For table rows and row-items, get more specific positioning
        const parent = currentElement.parentElement;
        if (parent) {
          const rows = Array.from(parent.children).filter(
            (el) => el.tagName === "TR" || el.classList?.contains("row-item")
          );
          if (rows.length > 1) {
            const rowIndex = rows.indexOf(currentElement);
            if (rowIndex !== -1) {
              selector += `:nth-of-type(${rowIndex + 1})`;
            }
          }
        }
      }
      // Always add position for maximum specificity
      else if (currentElement.parentNode) {
        const siblings = Array.from(currentElement.parentNode.children);
        if (siblings.length > 1) {
          const index = siblings.indexOf(currentElement) + 1;
          selector += `:nth-child(${index})`;
        }
      }

      path.unshift(selector);
      currentElement = currentElement.parentNode;
      depth++;
    }

    return path.join(" > ");
  }

  getRowUniqueContent(rowElement) {
    // Cố gắng tìm "nội dung đặc trưng" của một hàng (bảng) để phân biệt
    // Get actual unique content that exists in the row

    // Look for ID numbers in spans
    const spans = rowElement.querySelectorAll('span.main-status, span[class*="status"]');
    for (const span of spans) {
      const text = span.textContent?.trim();
      if (text && text.match(/^\d{10,}$/)) {
        return text;
      }
    }

    // Look for unique names
    const nameElements = rowElement.querySelectorAll(".item-content, .name-content, .ad-name span");
    for (const el of nameElements) {
      const text = el.textContent?.trim();
      if (text && text.length > 5 && text.length < 50) {
        return text;
      }
    }

    return null;
  }

  findUniqueRowIdentifier(rowElement) {
    // Tìm định danh duy nhất cho 1 hàng (qua data-testid, rowindex, số dài, tên...)
    // Try to find unique identifiers in the row

    // Look for data-testid with ID numbers
    const testIdElements = rowElement.querySelectorAll('[data-testid*="-"]');
    for (const el of testIdElements) {
      const testId = el.getAttribute("data-testid");
      if (testId && testId.match(/\d{10,}/)) {
        // Look for long IDs
        return testId.match(/\d{10,}/)[0];
      }
    }

    // Look for rowindex attribute
    const rowIndexEl = rowElement.querySelector("[rowindex]");
    if (rowIndexEl) {
      return "row-" + rowIndexEl.getAttribute("rowindex");
    }

    // Look for unique ID-like text content (like 1837112075201586)
    const spans = rowElement.querySelectorAll("span");
    for (const span of spans) {
      const text = span.textContent?.trim();
      if (text && text.match(/^\d{10,}$/)) {
        // Long number IDs
        return "id-" + text;
      }
    }

    // Look for unique text in name columns
    const nameElements = rowElement.querySelectorAll(".item-content, .name-content, .ad-name");
    for (const el of nameElements) {
      const text = el.textContent?.trim();
      if (text && text.length > 5 && text.length < 100) {
        return "name-" + text.substring(0, 20).replace(/[^a-zA-Z0-9]/g, "-");
      }
    }

    return null;
  }

  addMeaningfulAttributes(element, selector) {
    // Bổ sung các thuộc tính có ý nghĩa (data-*, role, aria-*, title, alt)
    let result = selector;

    // Add data attributes
    Array.from(element.attributes).forEach((attr) => {
      if (attr.name.startsWith("data-") && attr.value && attr.value.length < 50) {
        result += `[${CSS.escape(attr.name)}="${CSS.escape(attr.value)}"]`;
      }
    });

    // Add role, aria attributes
    ["role", "aria-label", "title", "alt"].forEach((attrName) => {
      const value = element.getAttribute(attrName);
      if (value && value.length < 50) {
        result += `[${attrName}="${CSS.escape(value)}"]`;
      }
    });

    return result;
  }

  buildContentSelector(element) {
    // Bỏ qua selector dựa trên nội dung vì :contains() không hợp lệ trong CSS
    // Skip content-based selector since :contains() is not valid CSS
    // We'll rely on attribute and path selectors instead
    return null;
  }

  // Tạo selector dựa trên thuộc tính nếu thuộc tính đó là duy nhất trong DOM
  buildAttributeSelector(element) {
    // Build selector based on unique attributes
    const selectors = [];

    ["name", "value", "placeholder", "href", "src"].forEach((attr) => {
      const value = element.getAttribute(attr);
      if (value && value.length < 100) {
        try {
          const elementsWithSameAttr = document.querySelectorAll(`[${attr}="${CSS.escape(value)}"]`);
          if (elementsWithSameAttr?.length === 1) {
            selectors.push(`[${attr}="${CSS.escape(value)}"]`);
          }
        } catch (e) {
          // Skip invalid attribute values
        }
      }
    });

    return selectors.length > 0 ? element.tagName.toLowerCase() + selectors.join("") : null;
  }

  // Chọn selector ứng viên nào match đúng 1 phần tử (unique) thì dùng
  selectMostUniqueSelector(candidates, element) {
    // Test each candidate and return the one that matches exactly 1 element
    for (const candidate of candidates) {
      try {
        const matches = document.querySelectorAll(candidate);
        if (matches.length === 1 && matches[0] === element) {
          console.log(`✅ Found unique selector: ${candidate}`);
          return candidate;
        } else if (matches.length > 1) {
          console.warn(`⚠️ Selector matches ${matches.length} elements: ${candidate}`);
        }
      } catch (e) {
        console.error(`❌ Invalid selector: ${candidate}`, e);
        continue;
      }
    }

    // Fallback: Use simpler path-based selector without virtual attributes
    const fallbackSelector = this.buildSimplePathSelector(element);
    console.log(`🔄 Using fallback selector: ${fallbackSelector}`);
    return fallbackSelector;
  }

  // Tạo selector đường đi đơn giản, ưu tiên ID / một vài class tiêu biểu + vị trí
  buildSimplePathSelector(element) {
    // Build a simpler, more reliable selector
    const path = [];
    let currentElement = element;
    let depth = 0;
    const maxDepth = 8;

    while (currentElement && currentElement !== document.body && depth < maxDepth) {
      let selector = currentElement.tagName.toLowerCase();

      // Add ID if exists
      if (currentElement.id) {
        return `#${CSS.escape(currentElement.id)}`;
      }

      // Add key classes only
      if (currentElement.className) {
        const classes = currentElement.className
          .trim()
          .split(/\s+/)
          .filter((c) => c && !c.startsWith("text-editor") && c.length > 2)
          .slice(0, 3); // Limit to 3 most important classes

        if (classes.length > 0) {
          selector += "." + classes.map((c) => CSS.escape(c)).join(".");
        }
      }

      // Add position only when necessary
      if (currentElement.parentNode) {
        const siblings = Array.from(currentElement.parentNode.children);
        if (siblings.length > 1) {
          const sameClassSiblings = siblings.filter(
            (el) => el.className === currentElement.className && el.tagName === currentElement.tagName
          );
          if (sameClassSiblings.length > 1) {
            const index = siblings.indexOf(currentElement) + 1;
            selector += `:nth-child(${index})`;
          }
        }
      }

      path.unshift(selector);
      currentElement = currentElement.parentNode;
      depth++;
    }

    return path.join(" > ");
  }

  // Fallback: Tạo selector đường đi sâu và chi tiết hơn để tăng tính đặc trưng
  buildDeepPathSelector(element) {
    // Build deeper, more specific selector
    const path = [];
    let currentElement = element;
    let depth = 0;
    const maxDepth = 12;

    while (currentElement && currentElement !== document.body && depth < maxDepth) {
      let selector = currentElement.tagName.toLowerCase();

      if (currentElement.id) {
        return `#${CSS.escape(currentElement.id)}`;
      }

      if (currentElement.className) {
        const classes = currentElement.className
          .trim()
          .split(/\s+/)
          .filter((c) => c && !c.startsWith("text-editor"));

        if (classes.length > 0) {
          selector += "." + classes.map((c) => CSS.escape(c)).join(".");
        }
      }

      // Always add position for uniqueness
      if (currentElement.parentNode) {
        const siblings = Array.from(currentElement.parentNode.children);
        if (siblings.length > 1) {
          const index = siblings.indexOf(currentElement) + 1;
          selector += `:nth-child(${index})`;
        }
      }

      path.unshift(selector);
      currentElement = currentElement.parentNode;
      depth++;
    }

    return path.join(" > ");
  }

  // Hiển thị thông báo nổi ngắn gọn ở góc phải trên màn hình
  showToast(message) {
    // Remove existing toast
    const oldToast = document.getElementById("text-editor-toast");
    if (oldToast) oldToast.remove();

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

  // Theo dõi thay đổi DOM (nội dung thêm mới) để tự động re-apply các chỉnh sửa
  setupObservers() {
    // Observe DOM changes to apply edits to dynamically added elements
    let throttleTimer = null;
    this.observer = new MutationObserver((mutations) => {
      if (!this.savedPageData || this.isEditing) return;

      // Throttle: only process if 500ms passed since last trigger
      if (throttleTimer) return;

      let hasRelevantChanges = false;
      for (const mutation of mutations) {
        // Only check for added nodes, ignore attributes/text changes
        if (mutation.addedNodes.length > 0) {
          hasRelevantChanges = true;
          break;
        }
      }

      if (hasRelevantChanges) {
        // Immediately mark potential targets as pending to avoid flash
        this.markPendingTargets();
        throttleTimer = setTimeout(() => {
          throttleTimer = null;
          this.applyAllEdits();
        }, 500);
      }
    });

    // Wait for body to exist before observing
    // Chờ body xuất hiện (một số trang nạp chậm) rồi mới bắt đầu observe
    const startObserving = () => {
      if (document.body) {
        this.observer.observe(document.body, {
          childList: true,
          subtree: true,
        });
      } else {
        setTimeout(startObserving, 10);
      }
    };
    startObserving();
  }

  setupUrlChangeListener() {
    // Theo dõi thay đổi URL theo nhiều cách: popstate, pushState, replaceState, polling
    // Prevent multiple setups
    if (window.__textEditorUrlListenerSetup) return;
    window.__textEditorUrlListenerSetup = true;

    // Detect URL changes in SPAs (like Facebook Ads Manager)
    let lastUrl = location.href;

    // Listen to popstate (back/forward button)
    window.addEventListener("popstate", () => {
      this.handleUrlChange();
    });

    // Listen to pushState/replaceState (React Router) - only override once
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

    // Polling fallback - check more frequently for better responsiveness
    if (this.urlCheckInterval) {
      clearInterval(this.urlCheckInterval);
    }
    this.urlCheckInterval = setInterval(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        this.handleUrlChange();
      }
    }, 1000); // Giảm từ 2000ms xuống 1000ms
  }

  // Debounce khi URL thay đổi liên tiếp nhanh
  handleUrlChange() {
    // Debounce URL changes to prevent multiple rapid calls
    clearTimeout(this.urlChangeTimeout);
    this.urlChangeTimeout = setTimeout(() => {
      this._doHandleUrlChange();
    }, 30);
  }

  // Nếu khoá trang thay đổi thật sự -> reload để trạng thái sạch sẽ
  _doHandleUrlChange() {
    const oldKey = this.currentPageKey;
    this.generatePageKey();

    // Only reload if the key actually changed
    if (oldKey !== this.currentPageKey) {
      console.log(`🔄 URL changed from "${oldKey}" to "${this.currentPageKey}" - Reloading to get clean DOM...`);

      // Reload trang để React vẽ lại DOM sạch, sau đó edits sẽ được apply từ loadSavedEdits()
      location.reload();
    }
  }

  // Message handler
  handleMessage(request) {
    // Nhận và xử lý thông điệp từ popup (bật/tắt/đặt lại...)
    switch (request.action) {
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

// Initialize with error handling
try {
  // Khởi tạo singleton TextEditor một lần cho mỗi tab
  if (!window.textEditor) {
    window.textEditor = new TextEditor();
  }
} catch (error) {
  console.error("Error initializing TextEditor:", error);
}

// Message listener - MUST return true for async response
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  try {
    // Ủy quyền xử lý message cho instance TextEditor nếu sẵn sàng
    if (window.textEditor) {
      window.textEditor.handleMessage(request);
      sendResponse({ success: true });
    } else {
      sendResponse({ success: false, error: "TextEditor not initialized" });
    }
  } catch (error) {
    console.error("Error handling message:", error);
    sendResponse({ success: false, error: error.message });
  }
  return true; // CRITICAL: Keep the message channel open for async response
});

// Auto-enable on page load
chrome.storage.sync.get(["autoEnable"], (data) => {
  if (data.autoEnable) {
    // Tuỳ chọn: tự bật chế độ chỉnh sửa sau khi trang tải ~1.5s
    setTimeout(() => {
      if (window.textEditor) {
        window.textEditor.enableEditing();
      }
    }, 1500);
  }
});
