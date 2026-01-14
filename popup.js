// Popup UI logic: điều khiển bật/tắt sửa, reset dữ liệu và hiển thị thống kê
document.addEventListener("DOMContentLoaded", function () {
  fetch("https://nguyentinhquoc.github.io/api-extention/api.json")
    .then((response) => {
      if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`);
      }
      return response.json();
    })
    .then((data) => {
      console.log("Dữ liệu từ API:", data);

      // Giả sử data là mảng, lấy phần tử đầu tiên
      // Nếu chỉ có 1 object, có thể dùng data.exp trực tiếp
      const expDateStr = data[0]?.exp || data.exp;

      if (!expDateStr) {
        console.warn("Không tìm thấy trường 'exp' trong JSON");
        return;
      }
      const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
      console.log("Hôm nay:", today, "| Hết hạn:", expDateStr);
      if (today > expDateStr) {
        alert("Phiên bản này đã hết hạn sử dụng.\nVui lòng liên hệ tác giả: 0862201004 để được hỗ trợ.");
        document.body.innerHTML = `
<div style="
    display: flex; 
    justify-content: center; 
    align-items: center; 
    height: 100vh; 
    margin: 0; 
    background-color: #f8f9fa; 
    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
">
    <div style="
        background: white; 
        padding: 40px; 
        border-radius: 12px; 
        box-shadow: 0 10px 25px rgba(0,0,0,0.1); 
        text-align: center; 
        border-top: 5px solid #ff4757;
        max-width: 400px;
    ">
        <h2 style="color: #2f3542; margin-bottom: 10px;">⚠️ Phiên bản hết hạn!</h2>
        <p style="color: #57606f; font-size: 16px; margin-bottom: 20px;">
            Vui lòng gia hạn bản quyền để tiếp tục sử dụng dịch vụ.
        </p>
        <div style="
            background: #f1f2f6; 
            padding: 15px; 
            border-radius: 8px; 
            font-weight: bold; 
            color: #ff4757;
        ">
            Liên hệ: Nguyễn Tình (wavebear) <br> 
            <span style="font-size: 20px;">Zalo: 0866201004</span>
        </div>
    </div>
</div>
`;
      } else {
        console.log("Phiên bản còn hạn đến:", expDateStr);
      }
    })
    .catch((error) => {
      window.close();
      console.error("Lỗi khi kiểm tra hạn sử dụng:", error);
      alert("Không thể kiểm tra hạn sử dụng. Vui lòng kiểm tra kết nối mạng.");
    });

  const enableBtn = document.getElementById("enableEdit");
  const disableBtn = document.getElementById("disableEdit");
  const resetPageBtn = document.getElementById("resetPage");
  const resetAllBtn = document.getElementById("resetAll");
  const autoEnableCheckbox = document.getElementById("autoEnable");
  const pageCountElem = document.getElementById("pageCount");
  const editCountElem = document.getElementById("editCount");

  // Load settings: nạp tùy chọn tự động bật chỉnh sửa
  chrome.storage.sync.get(["autoEnable"], function (data) {
    autoEnableCheckbox.checked = data.autoEnable || false;
  });

  // Load stats: lấy thống kê ban đầu khi mở popup
  updateStats();

  // Enable editing: gửi message bật chế độ chỉnh sửa tới tab đang mở
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

  // Disable editing: gửi message tắt chế độ chỉnh sửa
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

  // Reset current page: xóa dữ liệu chỉnh sửa của URL hiện tại
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

  // Reset all pages: xóa toàn bộ dữ liệu lưu trên mọi trang
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

  // Auto-enable toggle: bật/tắt tự động kích hoạt chỉnh sửa khi trang tải
  autoEnableCheckbox.addEventListener("change", function () {
    chrome.storage.sync.set({ autoEnable: this.checked });
    showNotification(this.checked ? "Đã bật tự động kích hoạt" : "Đã tắt tự động kích hoạt");
  });

  // Update statistics: đếm số trang đã lưu và tổng số chỉnh sửa
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

  // Show notification: hiển thị thông báo nhỏ trong popup
  function showNotification(message) {
    const notification = document.createElement("div");
    notification.className = "notification";
    notification.textContent = message;
    document.body.appendChild(notification);

    setTimeout(() => {
      notification.remove();
    }, 3000);
  }

  // Lắng nghe cập nhật stats từ content script để refresh UI
  chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
    if (request.action === "updateStats") {
      updateStats();
    }
  });

  // Cập nhật stats mỗi 2s khi popup đang mở (auto-refresh)
  setInterval(updateStats, 2000);
});
