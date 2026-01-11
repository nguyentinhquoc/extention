document.addEventListener("DOMContentLoaded", function () {
  // fetch("https://695ff8f77f037703a815576c.mockapi.io/check")
  //   .then((response) => response.json())
  //   .then((data) => {
  //     if (data[0].check === false) {
  //       alert("Phiên bản này đã bị vô hiệu hóa. Vui lòng liên hệ tác giả 0862201004 để được hỗ trợ.");
  //       window.close();
  //     }
  //   });

  const enableBtn = document.getElementById("enableEdit");
  const disableBtn = document.getElementById("disableEdit");
  const resetPageBtn = document.getElementById("resetPage");
  const resetAllBtn = document.getElementById("resetAll");
  const autoEnableCheckbox = document.getElementById("autoEnable");
  const pageCountElem = document.getElementById("pageCount");
  const editCountElem = document.getElementById("editCount");

  // Load settings
  chrome.storage.sync.get(["autoEnable"], function (data) {
    autoEnableCheckbox.checked = data.autoEnable || false;
  });

  // Load stats
  updateStats();

  // Enable editing
  enableBtn.addEventListener("click", function () {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (tabs[0]) {
        chrome.tabs
          .sendMessage(tabs[0].id, { action: "enableEditing" })
          .then(() => {
            showNotification("Đã bật chế độ sửa văn bản!");
          })
          .catch(() => {
            // Silent fail - don't show error in console
            showNotification("⚠️ Vui lòng reload trang web");
          });
      }
    });
  });

  // Disable editing
  disableBtn.addEventListener("click", function () {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (tabs[0]) {
        chrome.tabs
          .sendMessage(tabs[0].id, { action: "disableEditing" })
          .then(() => {
            showNotification("Đã tắt chế độ sửa văn bản.");
          })
          .catch(() => {
            // Silent fail
          });
      }
    });
  });

  // Reset current page
  resetPageBtn.addEventListener("click", function () {
    if (confirm("Đặt lại tất cả thay đổi trên trang này?")) {
      chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
        if (tabs[0]) {
          chrome.tabs.sendMessage(tabs[0].id, { action: "resetPage" }).catch(() => {
            // Silent fail
          });
        }
      });
      showNotification("Đã đặt lại trang.");
      setTimeout(updateStats, 500);
    }
  });

  // Reset all pages
  resetAllBtn.addEventListener("click", function () {
    if (confirm("Xóa TẤT CẢ thay đổi trên MỌI trang?")) {
      chrome.storage.local.clear(function () {
        chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
          if (tabs[0]) {
            chrome.tabs.sendMessage(tabs[0].id, { action: "resetAll" }).catch(() => {
              // Silent fail
            });
          }
        });
        showNotification("Đã xóa tất cả dữ liệu.");
        updateStats();
      });
    }
  });

  // Auto-enable toggle
  autoEnableCheckbox.addEventListener("change", function () {
    chrome.storage.sync.set({ autoEnable: this.checked });
    showNotification(this.checked ? "Đã bật tự động kích hoạt" : "Đã tắt tự động kích hoạt");
  });

  // Update statistics
  function updateStats() {
    chrome.storage.local.get(null, function (data) {
      let pageCount = 0;
      let editCount = 0;

      Object.keys(data).forEach((key) => {
        if (key.startsWith("page_")) {
          pageCount++;
          const edits = data[key];
          editCount += Object.keys(edits).length;
        }
      });

      pageCountElem.textContent = pageCount;
      editCountElem.textContent = editCount;
    });
  }

  // Show notification
  function showNotification(message) {
    const notification = document.createElement("div");
    notification.className = "notification";
    notification.textContent = message;
    document.body.appendChild(notification);

    setTimeout(() => {
      notification.remove();
    }, 3000);
  }

  // Lắng nghe cập nhật stats
  chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
    if (request.action === "updateStats") {
      updateStats();
    }
  });

  // Update stats every 2 seconds while popup is open
  setInterval(updateStats, 2000);
});
