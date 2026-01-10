document.addEventListener("DOMContentLoaded", function () {
  // Version check (optional - you can remove this if not needed)
  const versionCheckUrl = "https://695ff8f77f037703a815576c.mockapi.io/check";

  // UI Elements
  const enableEditBtn = document.getElementById("enableEdit");
  const disableEditBtn = document.getElementById("disableEdit");
  const resetPageBtn = document.getElementById("resetPage");
  const resetAllBtn = document.getElementById("resetAll");
  const autoEnableCheckbox = document.getElementById("autoEnable");
  const showIndicatorsCheckbox = document.getElementById("showIndicators");
  const pageCountEl = document.getElementById("pageCount");
  const editCountEl = document.getElementById("editCount");
  const statusText = document.getElementById("statusText");
  const statusIndicator = document.getElementById("statusIndicator");

  // Load saved settings
  chrome.storage.sync.get(["autoEnable", "showIndicators"], function (result) {
    if (autoEnableCheckbox) {
      autoEnableCheckbox.checked = result.autoEnable || false;
    }
    if (showIndicatorsCheckbox) {
      showIndicatorsCheckbox.checked = result.showIndicators !== false;
    }
  });

  // Update statistics
  updateStats();

  // Enable editing button
  enableEditBtn.addEventListener("click", function () {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (tabs[0]) {
        chrome.tabs
          .sendMessage(tabs[0].id, { action: "enableEditing" })
          .then(() => {
            showNotification("Đã bật chế độ sửa văn bản!");
          })
          .catch(() => {
            showNotification("⚠️ Vui lòng reload trang web");
          });
      }
    });
  });

  // Disable editing button
  disableEditBtn.addEventListener("click", function () {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (tabs[0]) {
        chrome.tabs
          .sendMessage(tabs[0].id, { action: "disableEditing" })
          .then(() => {
            showNotification("Đã tắt chế độ sửa văn bản.");
          })
          .catch(() => {});
      }
    });
  });

  // Reset current page button
  resetPageBtn.addEventListener("click", function () {
    if (confirm("Đặt lại tất cả thay đổi trên trang này?")) {
      chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
        if (tabs[0]) {
          chrome.tabs.sendMessage(tabs[0].id, { action: "resetPage" }).catch(() => {});
        }
      });
      showNotification("Đã đặt lại trang.");
      setTimeout(updateStats, 500);
    }
  });

  // Reset all button
  resetAllBtn.addEventListener("click", function () {
    if (confirm("Xóa TẤT CẢ thay đổi trên MỌI trang?")) {
      chrome.storage.local.clear(function () {
        chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
          if (tabs[0]) {
            chrome.tabs.sendMessage(tabs[0].id, { action: "resetAll" }).catch(() => {});
          }
        });
        showNotification("Đã xóa tất cả dữ liệu.");
        updateStats();
      });
    }
  });

  // Auto-enable setting
  autoEnableCheckbox.addEventListener("change", function () {
    chrome.storage.sync.set({ autoEnable: this.checked });
    showNotification(this.checked ? "Đã bật tự động kích hoạt" : "Đã tắt tự động kích hoạt");
  });

  // Show indicators setting
  showIndicatorsCheckbox.addEventListener("change", function () {
    chrome.storage.sync.set({ showIndicators: this.checked });
  });

  // Function to update statistics
  function updateStats() {
    chrome.storage.local.get(null, function (data) {
      let pageCount = 0;
      let editCount = 0;

      Object.keys(data).forEach((key) => {
        if (key.startsWith("page_")) {
          pageCount++;
          const pageData = data[key];
          editCount += Object.keys(pageData).length;
        }
      });

      pageCountEl.textContent = pageCount;
      editCountEl.textContent = editCount;
    });
  }

  // Function to show notification
  function showNotification(message) {
    const notification = document.createElement("div");
    notification.className = "notification";
    notification.textContent = message;
    document.body.appendChild(notification);

    setTimeout(() => {
      notification.remove();
    }, 3000);
  }

  // Listen for stats updates
  chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
    if (message.action === "updateStats") {
      updateStats();
    }
  });

  // Update stats every 2 seconds
  setInterval(updateStats, 2000);
});
