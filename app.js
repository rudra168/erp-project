const API_BASE = "https://erp-backend-5ya9.onrender.com";
let lotData = JSON.parse(localStorage.getItem("lotData")) || [];
let stockItems = JSON.parse(localStorage.getItem("stockItems")) || [];
let invoiceItems = JSON.parse(localStorage.getItem("invoiceItems")) || [];
let deletedStickerHistory = JSON.parse(localStorage.getItem("deletedStickerHistory")) || [];
let hiddenDeletedBarcodes = JSON.parse(localStorage.getItem("hiddenDeletedBarcodes")) || [];
let isSavingSticker = false;

let html5QrCode = null;
let scannerRunning = false;
let lastScannedCode = "";
let lastScanTime = 0;

// ================= COMMON HELPERS =================
function num(v) {
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
}

function calcPureWeight(weight, purity) {
  return (num(weight) * num(purity)) / 100;
}

function toggleSidebar() {
  const sidebar = document.getElementById("sidebar");
  if (sidebar) {
    sidebar.classList.toggle("collapsed");
  }
}

function saveInvoiceAndHistory() {
  localStorage.setItem("invoiceItems", JSON.stringify(invoiceItems));
  localStorage.setItem("deletedStickerHistory", JSON.stringify(deletedStickerHistory));
}

function generateUniqueBarcode() {
  return "BC" + Date.now() + Math.floor(Math.random() * 1000);
}

function generateInvoiceNumber() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");

  const savedDate = localStorage.getItem("invoiceCountDate");
  const todayKey = `${year}${month}${day}`;

  let lastInvoiceCount = Number(localStorage.getItem("lastInvoiceCount")) || 0;

  if (savedDate !== todayKey) {
    lastInvoiceCount = 0;
    localStorage.setItem("invoiceCountDate", todayKey);
  }

  const newCount = lastInvoiceCount + 1;
  localStorage.setItem("lastInvoiceCount", newCount);

  return `INV-${year}${month}${day}-${String(newCount).padStart(4, "0")}`;
}

function setNewInvoiceNumber(force = false) {
  const invoiceNumberInput = document.getElementById("invoiceNumber");
  if (!invoiceNumberInput) return;

  if (force || !invoiceNumberInput.value.trim()) {
    invoiceNumberInput.value = generateInvoiceNumber();
  }
}

function syncLotPreview() {
  const lotSelector = document.getElementById("lotSelector");
  const processTypeSelector = document.getElementById("processTypeSelector");
  const selectedLotPreview = document.getElementById("selectedLotPreview");
  const selectedProcessPreview = document.getElementById("selectedProcessPreview");
  const lotPreviewText = document.getElementById("lotPreviewText");
  const processPreviewText = document.getElementById("processPreviewText");

  const lotValue = lotSelector ? lotSelector.value.trim() : "";
  const processValue = processTypeSelector ? processTypeSelector.value : "";

  if (selectedLotPreview) selectedLotPreview.value = lotValue;
  if (selectedProcessPreview) selectedProcessPreview.value = processValue;
  if (lotPreviewText) lotPreviewText.textContent = lotValue || "--";
  if (processPreviewText) processPreviewText.textContent = processValue || "--";
}

function setQuickLot(lotNo) {
  const lotSelector = document.getElementById("lotSelector");
  if (lotSelector) {
    lotSelector.value = lotNo;
  }
  syncLotPreview();
}

// ================= STICKER =================
function getStickerFormData() {
  return {
    serial: document.getElementById("stickerSerial")?.value.trim() || "",
    productName: document.getElementById("stickerProductName")?.value.trim() || "",
    purity: document.getElementById("stickerPurity")?.value.trim() || "",
    sku: document.getElementById("stickerSku")?.value.trim() || "",
    mm: document.getElementById("stickerMM")?.value.trim() || "",
    size: document.getElementById("stickerSize")?.value.trim() || "",
    weight: document.getElementById("stickerWeight")?.value.trim() || "",
    lot: document.getElementById("lotSelector")?.value.trim() || "",
    metalType: document.getElementById("metalTypeSelector")?.value || "",
    processType: document.getElementById("processTypeSelector")?.value || "",
    barcode: document.getElementById("stickerBarcode")?.value.trim() || ""
  };
}

function loadFromServer() {
  fetch(`${API_BASE}/getStock`, {
    cache: "no-store"
  })
    .then((res) => res.json())
    .then((data) => {
      const rawItems = Array.isArray(data) ? data : [];

      const uniqueMap = new Map();
      rawItems.forEach((item) => {
        if (item && item.barcode) {
          uniqueMap.set(item.barcode, item);
        }
      });

      stockItems = Array.from(uniqueMap.values());

      if (document.getElementById("stickerListBody")) {
        renderStickerList();
        renderHistory();
      }

      if (document.getElementById("inventoryTableBody")) {
        renderInventoryTable();
      }

      if (document.getElementById("invoiceTableBody")) {
        renderInvoiceTable();
      }

      if (document.getElementById("totalStock")) {
        renderDashboardStats();
      }

      if (document.getElementById("stockSummaryBody")) {
        renderStockSummary();
      }

      if (document.getElementById("todaySales")) {
        renderSalesAnalytics();
      }
    })
    .catch((err) => {
      console.log("Load error:", err);
    });
}
window.addEventListener("load", function () {
  loadStockData();
  newStickerData();
});


function generateStickerBarcode() {
  if (isSavingSticker) return;

  const editBarcode = document.getElementById("editStickerBarcode")?.value.trim() || "";
  if (editBarcode) {
    updateStickerItem();
    return;
  }

  const data = getStickerFormData();

  if (!data.serial || !data.productName || !data.purity || !data.sku || !data.size || !data.weight || !data.lot) {
    alert("Please fill all required sticker fields");
    return;
  }

  if (!data.barcode) {
    data.barcode = generateUniqueBarcode();
    const barcodeInput = document.getElementById("stickerBarcode");
    if (barcodeInput) barcodeInput.value = data.barcode;
  }

  const exists = stockItems.find((item) => item.barcode === data.barcode);
  if (exists) {
    alert("Barcode already exists");
    return;
  }

  const item = {
    serial: data.serial,
    productName: data.productName,
    purity: data.purity,
    sku: data.sku,
    mm: data.mm,
    size: data.size,
    weight: data.weight,
    lot: data.lot,
    barcode: data.barcode,
    metalType: data.metalType,
    processType: data.processType
  };

  isSavingSticker = true;

  fetch(`${API_BASE}/addSticker`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(item)
  })
    .then((res) => res.json())
    .then((result) => {
      if (result.success) {
        clearStickerForm(false);
        syncLotPreview();

        setTimeout(() => {
          loadFromServer();
        }, 250);

        const serialInput = document.getElementById("stickerSerial");
        if (serialInput) serialInput.focus();
      } else {
        alert(result.message || "Database save failed");
      }
    })
    .catch((err) => {
      console.log("Save error:", err);
      alert("Server connection error");
    })
    .finally(() => {
      isSavingSticker = false;
    });
}

function fillStickerForm(item) {
  const fieldMap = {
    stickerSerial: item.serial,
    stickerProductName: item.productName,
    stickerPurity: item.purity,
    stickerSku: item.sku,
    stickerMM: item.mm,
    stickerSize: item.size,
    stickerWeight: item.weight,
    stickerBarcode: item.barcode,
    editStickerBarcode: item.barcode
  };

  Object.entries(fieldMap).forEach(([id, value]) => {
    const el = document.getElementById(id);
    if (el) el.value = value || "";
  });

  const lotSelector = document.getElementById("lotSelector");
  const metalTypeSelector = document.getElementById("metalTypeSelector");
  const processTypeSelector = document.getElementById("processTypeSelector");

  if (lotSelector) lotSelector.value = item.lot || "";
  if (metalTypeSelector) metalTypeSelector.value = item.metalType || "Silver";
  if (processTypeSelector) processTypeSelector.value = item.processType || "MixOrnaments";

  syncLotPreview();
}

function fillStickerFormByBarcode(barcode) {
  const item = stockItems.find((x) => x.barcode === barcode);
  if (!item) return;
  fillStickerForm(item);
}

function updateStickerItem() {
  const editBarcode = document.getElementById("editStickerBarcode")?.value.trim() || "";
  if (!editBarcode) return;

  const data = getStickerFormData();

  const updatedItem = {
    serial: data.serial,
    productName: data.productName,
    purity: data.purity,
    sku: data.sku,
    mm: data.mm,
    size: data.size,
    weight: data.weight,
    lot: data.lot,
    barcode: data.barcode || editBarcode,
    metalType: data.metalType,
    processType: data.processType
  };

  fetch(`${API_BASE}/updateSticker/${editBarcode}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(updatedItem)
  })
    .then((res) => res.json())
    .then((result) => {
      if (result.success) {
        loadFromServer();
        clearStickerForm(false);
        syncLotPreview();

        const editField = document.getElementById("editStickerBarcode");
        if (editField) editField.value = "";

        const serialInput = document.getElementById("stickerSerial");
        if (serialInput) serialInput.focus();
      } else {
        alert(result.message || "Update failed");
      }
    })
    .catch((err) => {
      console.log("Update error:", err);
      alert("Server update error");
    });
}

function clearStickerForm(removeLastFromList = false) {
  if (removeLastFromList && stockItems.length > 0) {
    const removed = stockItems[stockItems.length - 1];

    deletedStickerHistory.push({
      ...removed,
      deletedAt: new Date().toLocaleString(),
      deletedTs: Date.now(),
      restored: false
    });

    saveInvoiceAndHistory();
  }

  const ids = [
    "stickerSerial",
    "stickerProductName",
    "stickerPurity",
    "stickerSku",
    "stickerMM",
    "stickerSize",
    "stickerWeight",
    "stickerBarcode",
    "editStickerBarcode"
  ];

  ids.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
}

function deleteStickerItem(barcode) {
  barcode = String(barcode || "").trim();
  if (!barcode) {
    alert("Barcode missing hai");
    return;
  }

  const found = stockItems.find(
    (item) => String(item.barcode || "").trim() === barcode
  );

  // stock list se hata
  stockItems = stockItems.filter(
    (item) => String(item.barcode || "").trim() !== barcode
  );

  // selected item clear
  if (
    window.selectedSticker &&
    String(window.selectedSticker.barcode || "").trim() === barcode
  ) {
    window.selectedSticker = null;
  }

  // deleted history
  if (found) {
    deletedStickerHistory.push({
      ...found,
      deletedAt: new Date().toLocaleString(),
      deletedTs: Date.now(),
      restored: false
    });
  }

  // hidden list
  if (!hiddenDeletedBarcodes.includes(barcode)) {
    hiddenDeletedBarcodes.push(barcode);
  }

  localStorage.setItem("stockItems", JSON.stringify(stockItems));
  localStorage.setItem("hiddenDeletedBarcodes", JSON.stringify(hiddenDeletedBarcodes));
  localStorage.setItem("deletedStickerHistory", JSON.stringify(deletedStickerHistory));

  renderStickerList();
  if (typeof renderHistory === "function") renderHistory();
  if (typeof renderInventoryTable === "function") renderInventoryTable();
  if (typeof renderStockSummary === "function") renderStockSummary();
}
function restoreLastDeletedSticker() {
  const target = [...deletedStickerHistory].reverse().find(
    (item) => !item.restored
  );

  if (!target) {
    alert("Koi item restore ke liye nahi hai");
    return;
  }

  const exists = stockItems.find((item) => item.barcode === target.barcode);
  if (exists && (exists.status || "IN_STOCK") !== "DELETED") {
    alert("Item already stock me hai");
    return;
  }

  fetch(`${API_BASE}/restoreSticker/${target.barcode}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json"
    }
  })
    .then((res) => res.json())
    .then((result) => {
      if (result.success) {
        target.restored = true;
        target.restoredAt = new Date().toLocaleString();
        saveInvoiceAndHistory();
        loadFromServer();
        alert("Last item restored");
      } else {
        alert(result.message || "Restore failed");
      }
    })
    .catch((err) => {
      console.log("Restore error:", err);
      alert("Server error");
    });
}
function restoreByBarcode(barcode) {
  const target = [...deletedStickerHistory].reverse().find(
    (item) => item.barcode === barcode && !item.restored
  );
  if (!target) return;

  const exists = stockItems.find((item) => item.barcode === target.barcode);
  if (exists && (exists.status || "IN_STOCK") !== "DELETED") return;

  fetch(`${API_BASE}/restoreSticker/${barcode}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json"
    }
  })
    .then((res) => res.json())
    .then((result) => {
      if (result.success) {
        target.restored = true;
        target.restoredAt = new Date().toLocaleString();
        saveInvoiceAndHistory();
        loadFromServer();
      } else {
        alert(result.message || "Restore failed");
      }
    })
    .catch((err) => {
      console.log("Restore error:", err);
      alert("Server restore error");
    });
}

function renderStickerList() {
  const tbody = document.getElementById("stickerListBody");
  const totalWeightEl = document.getElementById("totalStickerWeight");

  if (!tbody) return;

  tbody.innerHTML = "";
  let totalWeight = 0;

  const visibleItems = stockItems.filter((item) => {
    const statusOk = (item.status || "IN_STOCK") === "IN_STOCK";
    const notHidden = !hiddenDeletedBarcodes.includes(String(item.barcode || "").trim());
    return statusOk && notHidden;
  });

  visibleItems.forEach((item, index) => {
    totalWeight += Number(item.weight || 0);

    const originalIndex = stockItems.findIndex(
      (x) => String(x.barcode || "").trim() === String(item.barcode || "").trim()
    );

    tbody.innerHTML += `
      <tr>
        <td>${item.serial || index + 1}</td>
        <td>${item.product_name || item.productName || item.party || ""}</td>
        <td>${item.purity || ""}</td>
        <td>${item.sku || ""}</td>
        <td>${item.mm || ""}</td>
        <td>${item.size || ""}</td>
        <td>${Number(item.weight || 0).toFixed(3)}</td>
        <td style="display:flex; gap:6px;">
          <button type="button" class="mini-btn edit-btn" onclick="editStickerByIndex(${originalIndex})">Edit</button>
          <button type="button" class="mini-btn clear-btn" onclick="deleteStickerByIndex(${index})">Delete</button>
        </td>
      </tr>
    `;
  });

  totalWeightEl.innerHTML =
    "Sticker List Total Weight: <span style='color:#2563eb; font-weight:700;'>" +
    totalWeight.toFixed(3) +
    "</span>";
}
function applyStickerFilters() {
  const tbody = document.getElementById("stickerListBody");
  const totalStickerWeight = document.getElementById("totalStickerWeight");
  if (!tbody) return;

  const lotFilter = document.getElementById("filterLot")?.value.trim().toLowerCase() || "";
  const sizeFilter = document.getElementById("filterSize")?.value.trim().toLowerCase() || "";
  const weightFilter = document.getElementById("filterWeight")?.value.trim().toLowerCase() || "";

  tbody.innerHTML = "";
  let totalWeight = 0;

  const uniqueMap = new Map();
  stockItems.forEach((item) => {
    if (item && item.barcode) {
      uniqueMap.set(item.barcode, item);
    }
  });

  const finalItems = Array.from(uniqueMap.values()).filter((item) => {
    const lot = String(item.lot || "").toLowerCase();
    const size = String(item.size || "").toLowerCase();
    const weight = String(item.weight || "").toLowerCase();

    return (
      lot.includes(lotFilter) &&
      size.includes(sizeFilter) &&
      weight.includes(weightFilter)
    );
  });

  if (finalItems.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" style="text-align:center;">No matching items found</td>
      </tr>
    `;
    if (totalStickerWeight) {
      totalStickerWeight.textContent = "Total Weight: 0.000";
    }
    return;
  }

  finalItems.forEach((item) => {
    totalWeight += Number(item.weight || 0);

    tbody.innerHTML += `
      <tr>
        <td>${item.serial || ""}</td>
        <td>${item.productName || ""}</td>
        <td>${item.purity || ""}</td>
        <td>${item.sku || ""}</td>
        <td>${item.size || ""}</td>
        <td>${item.weight || ""}</td>
        <td>
          <div class="action-btn-row">
            <button class="action-btn-small action-edit" type="button" onclick="fillStickerFormByBarcode('${item.barcode}')">Edit</button>
            <button class="action-btn-small action-delete" type="button" onclick="deleteStickerItem('${item.barcode}')">🗑</button>
          </div>
        </td>
      </tr>
    `;
  });

  if (totalStickerWeight) {
    totalStickerWeight.textContent = "Total Weight: " + totalWeight.toFixed(3);
  }
}

function renderInventoryTable() {
  const tbody = document.getElementById("inventoryTableBody");
  if (!tbody) return;

  tbody.innerHTML = "";

  const availableItems = stockItems.filter(
    (item) => (item.status || "IN_STOCK") === "IN_STOCK"
  );

  if (availableItems.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" style="text-align:center;">No inventory items found</td>
      </tr>
    `;
    return;
  }

  availableItems.forEach((item) => {
    tbody.innerHTML += `
      <tr>
        <td>${item.barcode || ""}</td>
        <td>${item.productName || ""}</td>
        <td>${item.sku || ""}</td>
        <td>${item.weight || ""}</td>
        <td>${item.size || ""}</td>
        <td>${item.lot || ""}</td>
        <td>${item.status || "IN_STOCK"}</td>
      </tr>
    `;
  });
}

function renderHistory() {
  const historyList = document.getElementById("historyList");
  if (!historyList) return;

  historyList.innerHTML = "";

  const historyType = document.getElementById("historyType")?.value || "Block History";

  const activeHistory = stockItems
    .filter((item) => (item.status || "IN_STOCK") !== "DELETED")
    .map((item) => ({
      type: "ACTIVE",
      lot: item.lot || "",
      metalType: item.metalType || "",
      time: item.createdAt || "",
      ts: item.createdTs || 0,
      barcode: item.barcode,
      stickerCount: 1
    }));

  const deletedHistory = deletedStickerHistory.map((item) => ({
    type: item.restored ? "RESTORED" : "DELETED",
    lot: item.lot || "",
    metalType: item.metalType || "",
    time: item.restored ? item.restoredAt : item.deletedAt,
    ts: item.restored ? (item.deletedTs || 0) + 1 : item.deletedTs || 0,
    barcode: item.barcode,
    stickerCount: 1
  }));

  let merged = [];

  if (historyType === "Block History") {
    const grouped = {};

    activeHistory.forEach((item) => {
      const key = `${item.lot}__${item.metalType}__${item.time}`;
      if (!grouped[key]) {
        grouped[key] = {
          type: "ACTIVE",
          lot: item.lot,
          metalType: item.metalType,
          time: item.time,
          ts: item.ts,
          barcode: item.barcode,
          stickerCount: 0
        };
      }
      grouped[key].stickerCount += 1;
    });

    deletedHistory.forEach((item) => {
      const key = `${item.lot}__${item.metalType}__${item.time}__${item.type}`;
      if (!grouped[key]) {
        grouped[key] = {
          type: item.type,
          lot: item.lot,
          metalType: item.metalType,
          time: item.time,
          ts: item.ts,
          barcode: item.barcode,
          stickerCount: 0
        };
      }
      grouped[key].stickerCount += 1;
    });

    merged = Object.values(grouped).sort((a, b) => b.ts - a.ts).slice(0, 8);
  } else {
    merged = [...activeHistory, ...deletedHistory]
      .sort((a, b) => b.ts - a.ts)
      .slice(0, 8);
  }

  if (merged.length === 0) {
    historyList.innerHTML = `<div class="history-card"><p>No history found</p></div>`;
    return;
  }

  merged.forEach((item) => {
    const leftButton =
      item.type === "ACTIVE"
        ? `<button type="button" onclick="fillStickerFormByBarcode('${item.barcode}')">▶</button>`
        : `<button type="button" onclick="restoreByBarcode('${item.barcode}')">↺</button>`;

    const rightButton =
      item.type === "ACTIVE"
        ? `<button type="button" title="Delete" onclick="deleteStickerItem('${item.barcode}')">🗑</button>`
        : `<button type="button" title="Restore" onclick="restoreByBarcode('${item.barcode}')">↺</button>`;

    historyList.innerHTML += `
      <div class="history-card">
        <div class="history-actions">
          ${leftButton}
          ${rightButton}
        </div>
        <p>
          <strong>Lot Number:</strong> ${item.lot || "-"}<br>
          <strong>Metal Type:</strong> ${item.metalType || "-"}<br>
          <strong>Stickers Count:</strong> ${item.stickerCount || 1}<br>
          <strong>Time:</strong> ${item.time || "-"}
        </p>
      </div>
    `;
  });
}

// ================= STICKER PRINT =================
function printStickerSheet() {
  const startFrom = Number(document.getElementById("startFrom")?.value || 1);

  if (startFrom < 1 || startFrom > 108) {
    alert("Print Start From 1 se 108 ke beech hona chahiye");
    return;
  }

  // 1) form se item lo
  let currentItem = {
    serial: document.getElementById("stickerSerial")?.value?.trim() || "",
    productName: document.getElementById("stickerProductName")?.value?.trim() || "",
    purity: document.getElementById("stickerPurity")?.value?.trim() || "",
    sku: document.getElementById("stickerSku")?.value?.trim() || "",
    mm: document.getElementById("stickerMM")?.value?.trim() || "",
    size: document.getElementById("stickerSize")?.value?.trim() || "",
    weight: document.getElementById("stickerWeight")?.value?.trim() || "",
    lot: document.getElementById("lotSelector")?.value?.trim() || "",
    barcode: document.getElementById("stickerBarcode")?.value?.trim() || ""
  };

  // 2) agar form empty hai to selectedSticker use karo
  if (!currentItem.barcode && window.selectedSticker) {
    currentItem = {
      serial: String(window.selectedSticker.serial || "").trim(),
      productName: String(window.selectedSticker.productName || "").trim(),
      purity: String(window.selectedSticker.purity || "").trim(),
      sku: String(window.selectedSticker.sku || "").trim(),
      mm: String(window.selectedSticker.mm || "").trim(),
      size: String(window.selectedSticker.size || "").trim(),
      weight: String(window.selectedSticker.weight || "").trim(),
      lot: String(window.selectedSticker.lot || "").trim(),
      barcode: String(window.selectedSticker.barcode || "").trim()
    };
  }

  // 3) agar abhi bhi empty hai to table ki first row se match karke stockItems se item lo
  if (!currentItem.barcode) {
    const firstRow = document.querySelector("#stickerListBody tr");

    if (firstRow) {
      const cells = firstRow.querySelectorAll("td");

      const rowData = {
        serial: cells[0]?.innerText?.trim() || "",
        productName: cells[1]?.innerText?.trim() || "",
        purity: cells[2]?.innerText?.trim() || "",
        sku: cells[3]?.innerText?.trim() || "",
        size: cells[4]?.innerText?.trim() || "",
        weight: cells[5]?.innerText?.trim() || "",
        lot: document.getElementById("lotSelector")?.value?.trim() || ""
      };

      const matchedItem = stockItems.find((item) => {
        return (
          String(item.serial || "").trim() === rowData.serial &&
          String(item.productName || "").trim() === rowData.productName &&
          String(item.purity || "").trim() === rowData.purity &&
          String(item.sku || "").trim() === rowData.sku &&
          String(item.size || "").trim() === rowData.size &&
          String(item.weight || "").trim() === rowData.weight &&
          String(item.lot || "").trim() === rowData.lot
        );
      });

      if (matchedItem) {
        currentItem = {
          serial: String(matchedItem.serial || "").trim(),
          productName: String(matchedItem.productName || "").trim(),
          purity: String(matchedItem.purity || "").trim(),
          sku: String(matchedItem.sku || "").trim(),
          mm: String(matchedItem.mm || "").trim(),
          size: String(matchedItem.size || "").trim(),
          weight: String(matchedItem.weight || "").trim(),
          lot: String(matchedItem.lot || "").trim(),
          barcode: String(matchedItem.barcode || "").trim()
        };
      }
    }
  }

  if (!currentItem.barcode) {
    alert("Barcode nahi mila. Pehle Edit karo ya barcode generate karo.");
    return;
  }

  const printableItems = [currentItem];

  const rows = 18;
  const cols = 6;
  const totalLabels = rows * cols;

  const pageWidth = 19.5;
  const pageHeight = 30.3;

  const leftGap = 1.5;
  const rightGap = 1.5;
  const topGap = 0.2;
  const bottomGap = 1.5;

  const labelWidth = 2.5;
  const labelHeight = 1.2;

  const horizontalGap = 0.3;
  const verticalGap = 0.4;

  let labelsHtml = "";
  const barcodeList = [];

  for (let i = 0; i < totalLabels; i++) {
    const actualIndex = i - (startFrom - 1);
    const item = printableItems[actualIndex];

    if (i < startFrom - 1 || !item) {
      labelsHtml += `<div class="label empty"></div>`;
    } else {
      const barcodeValue = String(item.barcode || "").trim();

      labelsHtml += `
        <div class="label">
          <div class="label-top">${item.weight || ""}g / ${item.size || ""}</div>
          <svg id="barcode${i}"></svg>
          <div class="label-bottom">Lot: ${item.lot || ""} | No: ${item.serial || ""}</div>
        </div>
      `;

      barcodeList.push({
        selector: `#barcode${i}`,
        value: barcodeValue
      });
    }
  }

  const barcodeItemsJson = JSON.stringify(barcodeList);

  const printWindow = window.open("", "_blank", "width=1200,height=900");
  if (!printWindow) {
    alert("Popup block ho gaya");
    return;
  }

  printWindow.document.open();
  printWindow.document.write(`
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Sticker Print</title>
  <style>
    @page {
      size: ${pageWidth}cm ${pageHeight}cm;
      margin: 0;
    }

    html, body {
      width: ${pageWidth}cm;
      height: ${pageHeight}cm;
      margin: 0;
      padding: 0;
      font-family: Arial, sans-serif;
      background: white;
    }

    .sheet {
      box-sizing: border-box;
      width: ${pageWidth}cm;
      height: ${pageHeight}cm;
      padding: ${topGap}cm ${rightGap}cm ${bottomGap}cm ${leftGap}cm;
      display: grid;
      grid-template-columns: repeat(${cols}, ${labelWidth}cm);
      grid-auto-rows: ${labelHeight}cm;
      column-gap: ${horizontalGap}cm;
      row-gap: ${verticalGap}cm;
      justify-content: start;
      align-content: start;
    }

    .label {
      width: ${labelWidth}cm;
      height: ${labelHeight}cm;
      box-sizing: border-box;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      text-align: center;
      line-height: 1;
      padding: 0;
    }

    .label-top {
      font-size: 7px;
      font-weight: 600;
      margin: 0 0 1px 0;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      width: 100%;
    }

    .label-bottom {
      font-size: 6px;
      font-weight: 400;
      margin: 1px 0 0 0;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      width: 100%;
    }

    .label svg {
      width: 90%;
      max-width: 90%;
      height: 20px;
      overflow: hidden;
      display: block;
      image-rendering: crisp-edges;
      shape-rendering: crispEdges;
    }

    .empty {
      visibility: hidden;
    }
  </style>
</head>
<body>
  <div class="sheet">${labelsHtml}</div>

  <script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js"><\/script>
  <script>
    const barcodeItems = ${barcodeItemsJson};

    function buildBarcodesAndPrint() {
      if (typeof JsBarcode === "undefined") {
        setTimeout(buildBarcodesAndPrint, 500);
        return;
      }

      barcodeItems.forEach((item) => {
        try {
          JsBarcode(item.selector, item.value, {
            format: "CODE128",
            width: 1.2,
            height: 20,
            displayValue: false,
            margin: 2,
            lineColor: "#000"
          });
        } catch (e) {
          console.log("Barcode error:", e);
        }
      });

      setTimeout(() => {
        window.print();
      }, 700);
    }

    window.onload = function () {
      setTimeout(buildBarcodesAndPrint, 500);
    };
  <\/script>
</body>
</html>
  `);

  printWindow.document.close();
}

    
// ================= INVOICE =================
function loadInvoiceItem() {
  loadFromServer();
  const barcode = document.getElementById("invoiceBarcodeInput").value.trim();
  const customerName = document.getElementById("invoiceCustomerName").value.trim();

  if (!barcode) return;

  const item = stockItems.find(
    (x) => x.barcode === barcode && (x.status || "IN_STOCK") === "IN_STOCK"
  );

  if (!item) {
    alert("Item not found in stock");
    return;
  }

  const exists = invoiceItems.find((x) => x.barcode === barcode);
  if (exists) {
    alert("Already added");
    return;
  }

  invoiceItems.push({
    barcode: item.barcode,
    productName: item.productName,
    sku: item.sku,
    weight: num(item.weight),
    purity: num(item.purity),
    size: item.size,
    lot: item.lot,
    customerName: customerName
  });

  renderInvoiceTable();
  calculateInvoiceTotal();

  document.getElementById("invoiceBarcodeInput").value = "";
}
function renderInvoiceTable() {
  const tbody = document.getElementById("invoiceTableBody");
  const totalCount = document.getElementById("totalCount");

  if (!tbody) return;

  tbody.innerHTML = "";

  invoiceItems.forEach((item) => {
    tbody.innerHTML += `
      <tr>
        <td>${item.barcode || ""}</td>
        <td>${item.productName || ""}</td>
        <td>${item.sku || ""}</td>
        <td>${item.weight || 0}</td>
        <td>${item.purity || 0}</td>
        <td>${item.size || ""}</td>
        <td>${item.lot || ""}</td>
        <td>${item.customerName || ""}</td>
      </tr>
    `;
  });

  if (totalCount) {
    totalCount.textContent = invoiceItems.length;
  }
}

function calculateInvoiceTotal() {
  const billType = document.getElementById("invoiceBillType")?.value || "GST";
  const taxType = document.getElementById("invoiceTaxType")?.value || "CGST_SGST";
  const rate = num(document.getElementById("invoiceRatePerGram")?.value || 0);
  const mcRate = num(document.getElementById("invoiceMcRate")?.value || 0);
  const roundOff = num(document.getElementById("invoiceRoundOff")?.value || 0);

  let subtotal = 0;

  invoiceItems.forEach((item) => {
    const weight = num(item.weight);
    const purity = num(item.purity);

    const pureWeight = (weight * purity) / 100;
    const metal = pureWeight * rate;
    const mc = pureWeight * mcRate;
    const total = metal + mc;

    item.pure_weight = pureWeight;
    item.total_price = total;

    subtotal += total;
  });

  let cgst = 0, sgst = 0, igst = 0;

  if (billType === "GST") {
    if (taxType === "CGST_SGST") {
      cgst = subtotal * 0.015;
      sgst = subtotal * 0.015;
    } else {
      igst = subtotal * 0.03;
    }
  }

  const grandTotal = subtotal + cgst + sgst + igst + roundOff;

  document.getElementById("invoiceSubtotal").value = subtotal.toFixed(2);
  document.getElementById("invoiceGrandTotal").value = grandTotal.toFixed(2);
  document.getElementById("invoiceCgstAmount").value = cgst.toFixed(2);
  document.getElementById("invoiceSgstAmount").value = sgst.toFixed(2);
  document.getElementById("invoiceIgstAmount").value = igst.toFixed(2);
}
function sellInvoiceItem() {
  const customerName = document.getElementById("invoiceCustomerName")?.value.trim() || "";
  const mobile = document.getElementById("invoiceMobile")?.value.trim() || "";
  const gst = document.getElementById("invoiceGst")?.value.trim() || "";
  const invoiceDate = document.getElementById("invoiceDate")?.value || "";
  const paymentMode = document.getElementById("invoicePaymentMode")?.value || "";
  const paymentStatus = document.getElementById("invoicePaymentStatus")?.value || "";
  const paidAmount = num(document.getElementById("invoicePaidAmount")?.value || 0);
  const dueAmount = num(document.getElementById("invoiceDueAmount")?.value || 0);

  if (!customerName) {
    alert("Customer name fill karo");
    return;
  }

  if (!invoiceItems || invoiceItems.length === 0) {
    alert("Pehle item scan karke invoice me add karo");
    return;
  }

  // 🔥 IMPORTANT → calculation force
  calculateInvoiceTotal();

  // 🔥 ensure items me latest values ho
  const finalItems = invoiceItems.map(item => ({
    ...item,
    pure_weight: num(item.pure_weight),
    rate_per_gram: num(item.rate_per_gram),
    mc_rate: num(item.mc_rate),
    mc_amount: num(item.mc_amount),
    total_price: num(item.total_price)
  }));

  fetch(`${API_BASE}/saveSale`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      invoice_number: document.getElementById("invoiceNumber")?.value || "",
      bill_type: document.getElementById("invoiceBillType")?.value || "GST",
      tax_type: document.getElementById("invoiceTaxType")?.value || "CGST_SGST",
      subtotal: num(document.getElementById("invoiceSubtotal")?.value || 0),
      cgst_amount: num(document.getElementById("invoiceCgstAmount")?.value || 0),
      sgst_amount: num(document.getElementById("invoiceSgstAmount")?.value || 0),
      igst_amount: num(document.getElementById("invoiceIgstAmount")?.value || 0),
      round_off: num(document.getElementById("invoiceRoundOff")?.value || 0),
      grand_total: num(document.getElementById("invoiceGrandTotal")?.value || 0),

      customer_name: customerName,
      mobile: mobile,
      gst: gst,
      invoice_date: invoiceDate,
      payment_mode: paymentMode,
      payment_status: paymentStatus,
      paid_amount: paidAmount,
      due_amount: dueAmount,

      items: finalItems
    })
  })
    .then((res) => res.json())
    .then((result) => {
      if (result.success) {
        alert("✅ Invoice saved successfully");

        // 🔥 reset everything
        invoiceItems = [];
        saveInvoiceAndHistory();
        renderInvoiceTable();
        clearInvoiceForm();
        setNewInvoiceNumber(true);

        setTimeout(() => {
          loadFromServer();
        }, 200);
      } else {
        alert(result.message || "Invoice save failed");
      }
    })
    .catch((err) => {
      console.log("Sale save error:", err);
      alert("Server sale save error");
    });
}

function clearInvoiceList() {
  invoiceItems = [];
  saveInvoiceAndHistory();
  renderInvoiceTable();
  calculateInvoiceTotal();

  const ids = [
    "invoiceProductName",
    "invoiceSku",
    "invoiceWeight",
    "invoiceSize",
    "invoiceLot",
    "invoicePurity",
    "invoiceCategory",
    "invoiceQuantity",
    "invoicePureWeight",
    "invoiceRatePerGramAuto",
    "invoiceRatePerPairAuto",
    "invoiceMcAuto",
    "invoiceCoatingAuto",
    "invoiceOtherPriceAuto"
  ];

  ids.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
}

function focusInvoiceScanner() {
  const barcodeInput = document.getElementById("invoiceBarcodeInput");
  if (barcodeInput) {
    barcodeInput.focus();
  }
}

function clearInvoiceForm() {
  const ids = [
    "invoiceBarcodeInput",
    "invoiceProductName",
    "invoiceSku",
    "invoiceWeight",
    "invoiceSize",
    "invoiceLot",
    "invoicePurity",
    "invoiceCategory",
    "invoiceQuantity",
    "invoicePureWeight",
    "invoiceRatePerGramAuto",
    "invoiceRatePerPairAuto",
    "invoiceMcAuto",
    "invoiceCoatingAuto",
    "invoiceOtherPriceAuto",
    "invoiceCustomerName",
    "invoiceMobile",
    "invoiceGst",
    "invoiceDate",
    "invoicePaymentMode",
    "invoicePaymentStatus",
    "invoicePaidAmount",
    "invoiceDueAmount",
    "invoiceRatePerGram",
    "invoiceMakingCharge",
    "invoiceGstPercent",
    "invoiceDiscount",
    "invoiceSubtotal",
    "invoiceGstAmount",
    "invoiceCgstAmount",
    "invoiceSgstAmount",
    "invoiceIgstAmount",
    "invoiceRoundOff",
    "invoiceGrandTotal"
  ];

  ids.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });

  invoiceItems = [];
  saveInvoiceAndHistory();
  renderInvoiceTable();
  focusInvoiceScanner();
}

function printGSTInvoice() {
  const invoiceNumber = document.getElementById("invoiceNumber")?.value || "";

  if (!invoiceItems.length) {
    alert("Invoice me items nahi hain");
    return;
  }

  calculateInvoiceTotal();

  const businessName = "RAJPATI ENTERPRISE";
  const businessAddress = "baulakud 42mauza cuttack-754112, Odisha";
  const businessGstin = "21DAWPG9914G1ZF";

  const customerName = document.getElementById("invoiceCustomerName")?.value || "";
  const mobile = document.getElementById("invoiceMobile")?.value || "";
  const gstNo = document.getElementById("invoiceGst")?.value || "";
  const invoiceDate = document.getElementById("invoiceDate")?.value || "";
  const paymentMode = document.getElementById("invoicePaymentMode")?.value || "";
  const paymentStatus = document.getElementById("invoicePaymentStatus")?.value || "";
  const paidAmount = document.getElementById("invoicePaidAmount")?.value || "0";
  const dueAmount = document.getElementById("invoiceDueAmount")?.value || "0";

  const billType = document.getElementById("invoiceBillType")?.value || "GST";
  const taxType = document.getElementById("invoiceTaxType")?.value || "CGST_SGST";

  const subtotal = document.getElementById("invoiceSubtotal")?.value || "0.00";
  const cgstAmount = document.getElementById("invoiceCgstAmount")?.value || "0.00";
  const sgstAmount = document.getElementById("invoiceSgstAmount")?.value || "0.00";
  const igstAmount = document.getElementById("invoiceIgstAmount")?.value || "0.00";
  const roundOff = document.getElementById("invoiceRoundOff")?.value || "0.00";
  const grandTotal = document.getElementById("invoiceGrandTotal")?.value || "0.00";

  let rows = "";
  invoiceItems.forEach((item, index) => {
    rows += `
      <tr>
        <td>${index + 1}</td>
        <td>${item.productName || ""}</td>
        <td>${item.sku || ""}</td>
        <td>${num(item.weight).toFixed(3)}</td>
        <td>${item.size || ""}</td>
        <td>${item.lot || ""}</td>
        <td>${num(item.purity).toFixed(2)}</td>
        <td>${num(item.rate_per_gram).toFixed(2)}</td>
        <td>${num(item.mc_amount).toFixed(2)}</td>
        <td>${num(item.total_price).toFixed(2)}</td>
      </tr>
    `;
  });

  const taxRows = billType === "GST"
    ? (
        taxType === "CGST_SGST"
          ? `
            <tr>
              <td><strong>CGST @ 1.5%</strong></td>
              <td>₹ ${cgstAmount}</td>
            </tr>
            <tr>
              <td><strong>SGST @ 1.5%</strong></td>
              <td>₹ ${sgstAmount}</td>
            </tr>
          `
          : `
            <tr>
              <td><strong>IGST @ 3%</strong></td>
              <td>₹ ${igstAmount}</td>
            </tr>
          `
      )
    : `
      <tr>
        <td><strong>GST</strong></td>
        <td>₹ 0.00</td>
      </tr>
    `;

  const totalWeight = invoiceItems.reduce((a, b) => a + num(b.weight), 0).toFixed(3);

  const printWindow = window.open("", "_blank", "width=1400,height=900");
  if (!printWindow) {
    alert("Popup block ho gaya. Browser me popup allow karo.");
    return;
  }

  printWindow.document.write(`
<!DOCTYPE html>
<html>
<head>
  <title>Invoice Print</title>
  <style>
    body {
      font-family: Arial, sans-serif;
      padding: 18px;
      color: #111;
    }
    .invoice-box {
      max-width: 1250px;
      margin: auto;
      border: 2px solid #111;
      padding: 12px;
    }
    .title-main {
      text-align: center;
      font-size: 28px;
      font-weight: 700;
      margin-bottom: 16px;
    }
    .topline {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      text-align: center;
      font-size: 14px;
      margin-bottom: 8px;
    }
    .header-box {
      border: 1px solid #111;
      display: grid;
      grid-template-columns: 1fr 2fr 1fr;
      align-items: center;
      min-height: 90px;
      margin-bottom: 10px;
    }
    .header-box > div {
      padding: 10px;
      font-size: 14px;
    }
    .header-center {
      text-align: center;
      font-weight: bold;
    }
    .deal-box {
      display: inline-block;
      background: #111;
      color: #fff;
      padding: 8px 14px;
      margin-top: 8px;
      font-size: 13px;
    }
    .party-box {
      border: 1px solid #111;
      padding: 12px;
      margin-bottom: 10px;
      min-height: 130px;
      line-height: 1.9;
      font-size: 14px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
    }
    th, td {
      border: 1px solid #111;
      padding: 8px;
      font-size: 13px;
      text-align: center;
    }
    th {
      background: #111;
      color: white;
    }
    .summary-grid {
      display: grid;
      grid-template-columns: 1.3fr 1fr;
      margin-top: 10px;
      gap: 0;
    }
    .left-summary, .right-summary {
      border: 1px solid #111;
      min-height: 170px;
    }
    .left-summary {
      padding: 10px;
      font-size: 14px;
      line-height: 2;
      border-right: none;
    }
    .right-summary table {
      width: 100%;
      height: 100%;
    }
    .right-summary td {
      font-size: 14px;
      font-weight: 600;
      text-align: left;
    }
    .bottom-box {
      display: grid;
      grid-template-columns: 2fr 0.6fr;
      margin-top: 10px;
    }
    .declaration, .sign-box {
      border: 1px solid #111;
      min-height: 90px;
      padding: 12px;
      font-size: 14px;
      display: flex;
      align-items: end;
      box-sizing: border-box;
    }
    .sign-box {
      justify-content: center;
      text-align: center;
      font-weight: 700;
    }
    @media print {
      body {
        padding: 0;
      }
    }
  </style>
</head>
<body>
  <div class="invoice-box">
    <div class="title-main">${businessName}</div>

    <div class="topline">
      <div><strong>GSTIN :</strong> ${businessGstin}</div>
      <div><strong>TAX INVOICE</strong></div>
      <div><strong>Sln/Ivn :</strong> ${invoiceNumber}</div>
    </div>

    <div class="header-box">
      <div><strong>A/c No:</strong> 25050400005430</div>
      <div class="header-center">
        RAJPATI ENTERPRISE<br>
        JHINKIRIA ,42 MOUJA,CUTTACK-112<br>
        <span class="deal-box">Deals In: All types of Gold & silver Sankha Trading.</span>
      </div>
      <div><strong>IFSC CODE :</strong> BARB0CUTMAN</div>
    </div>

    <div class="party-box">
      <div><strong>Name:</strong> ${customerName}</div>
      <div><strong>Address:</strong> ${customerName ? "Customer Address" : ""}</div>
      <div><strong>Regd Name:</strong> ${customerName}</div>
      <div><strong>Party's GSTIN/Unique ID:</strong> ${gstNo}</div>
      <div><strong>Mob:</strong> ${mobile}</div>
    </div>

    <table>
      <thead>
        <tr>
          <th>SL. No.</th>
          <th>Item Name</th>
          <th>SKU</th>
          <th>Weight (gms)</th>
          <th>Size</th>
          <th>Lot</th>
          <th>Purity</th>
          <th>₹ / Gram</th>
          <th>MC</th>
          <th>Total Price</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
        <tr>
          <td colspan="3"><strong>Total</strong></td>
          <td><strong>${totalWeight}</strong></td>
          <td colspan="5">--</td>
          <td><strong>${subtotal}</strong></td>
        </tr>
      </tbody>
    </table>

    <div style="margin-top:8px; font-size:14px; display:flex; justify-content:space-between;">
      <div><strong>Payment (${paymentStatus || "-"})</strong></div>
      <div><strong>Payment Mode:</strong> ${paymentMode || "-"}</div>
      <div><strong>Bill Type:</strong> ${billType}</div>
    </div>

    <div class="summary-grid">
      <div class="left-summary">
        <div><strong>RUPPEES IN WORDS ONLY</strong></div>
        <div><strong>DATE:</strong> ${invoiceDate}</div>
        <div><strong>Paid Amount:</strong> ₹ ${paidAmount}</div>
        <div><strong>Due Amount:</strong> ₹ ${dueAmount}</div>
        <div><strong>Address:</strong> ${businessAddress}</div>
      </div>

      <div class="right-summary">
        <table>
          <tr>
            <td><strong>SUBTOTAL</strong></td>
            <td>₹ ${subtotal}</td>
          </tr>
          ${taxRows}
          <tr>
            <td><strong>ROUND OFF / ADJUSTMENT</strong></td>
            <td>₹ ${roundOff}</td>
          </tr>
          <tr>
            <td><strong>GRAND TOTAL</strong></td>
            <td><strong>₹ ${grandTotal}</strong></td>
          </tr>
        </table>
      </div>
    </div>

    <div class="bottom-box">
      <div class="declaration">
        Declaration : The Registration certificate is valid on the date of issue of invoice.
        Subject to JHINKIRIA ,42 MOUJA,CUTTACK-112 Jurisdiction only.
      </div>
      <div class="sign-box">
        for RAJPATI<br>ENTERPRISE
      </div>
    </div>
  </div>

  <script>
    window.onload = function () {
      setTimeout(function () {
        window.print();
      }, 400);
    };
  <\/script>
</body>
</html>
  `);

  printWindow.document.close();
}
// ================= PAGE HELPERS =================
function setupStickerKeyboardFlow() {
  const sizeInput = document.getElementById("stickerSize");
  const weightInput = document.getElementById("stickerWeight");

  if (sizeInput && !sizeInput.dataset.bound) {
    sizeInput.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        if (weightInput) weightInput.focus();
      }
    });
    sizeInput.dataset.bound = "true";
  }

  if (weightInput && !weightInput.dataset.bound) {
    weightInput.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        generateStickerBarcode();
      }
    });
    weightInput.dataset.bound = "true";
  }
}

function setupInvoiceScannerFlow() {
  const barcodeInput = document.getElementById("invoiceBarcodeInput");
  if (!barcodeInput || barcodeInput.dataset.bound === "true") return;

  barcodeInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter") {
      e.preventDefault();
      loadInvoiceItem();
    }
  });

  barcodeInput.dataset.bound = "true";
}

function blockAllFormSubmit() {
  const forms = document.querySelectorAll("form");

  forms.forEach((form) => {
    if (form.dataset.bound === "true") return;

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      e.stopPropagation();
      return false;
    });

    form.dataset.bound = "true";
  });
}

// ================= SALES HISTORY =================
function loadSalesHistory() {
  const tbody = document.getElementById("salesHistoryBody");
  if (!tbody) return;

  fetch(`${API_BASE}/getSales`)
    .then((res) => res.json())
    .then((data) => {
      tbody.innerHTML = "";

      if (!Array.isArray(data) || data.length === 0) {
        tbody.innerHTML = `
          <tr>
            <td colspan="11" style="text-align:center;">No sales history found</td>
          </tr>
        `;
        return;
      }

      data.forEach((sale) => {
        tbody.innerHTML += `
          <tr>
            <td>${sale.id || ""}</td>
            <td>${sale.customer_name || ""}</td>
            <td>${sale.mobile || ""}</td>
            <td>${sale.gst || ""}</td>
            <td>${sale.invoice_date || ""}</td>
            <td>${sale.payment_mode || ""}</td>
            <td>${sale.payment_status || ""}</td>
            <td>${sale.paid_amount || 0}</td>
            <td>${sale.due_amount || 0}</td>
            <td>${sale.total_items || 0}</td>
            <td>
              <button type="button" onclick="viewSaleItems(${sale.id})">View</button>
            </td>
          </tr>
        `;
      });
    })
    .catch((err) => {
      console.log("Sales history load error:", err);
    });
}

function viewSaleItems(saleId) {
  const modal = document.getElementById("saleItemsModal");
  const tbody = document.getElementById("saleItemsModalBody");

  if (!modal || !tbody) return;

  fetch(`${API_BASE}/getSaleItems/${saleId}`)
    .then((res) => res.json())
    .then((items) => {
      tbody.innerHTML = "";

      if (!items || items.length === 0) {
        tbody.innerHTML = `
          <tr>
            <td colspan="6" style="text-align:center;">No items found</td>
          </tr>
        `;
      } else {
        items.forEach((item, index) => {
          tbody.innerHTML += `
            <tr>
              <td>${index + 1}</td>
              <td>${item.product_name || ""}</td>
              <td>${item.sku || ""}</td>
              <td>${item.weight || ""} g</td>
              <td>${item.size || ""}</td>
              <td>${item.barcode || ""}</td>
            </tr>
          `;
        });
      }

      modal.classList.add("show");
    })
    .catch((err) => {
      console.log("View items error:", err);
    });
}

function closeSaleItemsModal() {
  const modal = document.getElementById("saleItemsModal");
  if (modal) modal.classList.remove("show");
}

window.addEventListener("click", function (e) {
  const modal = document.getElementById("saleItemsModal");
  if (modal && e.target === modal) {
    modal.classList.remove("show");
  }
});

// ================= DASHBOARD =================
function renderDashboardStats() {
  const totalStockEl = document.getElementById("totalStock");
  const totalWeightEl = document.getElementById("totalWeight");
  const soldItemsEl = document.getElementById("soldItems");
  const availableItemsEl = document.getElementById("availableItems");
  const currentStockEl = document.getElementById("currentStock");
  const lowStockItemsEl = document.getElementById("lowStockItems");

  let totalWeight = 0;
  let soldCount = 0;
  let availableCount = 0;

  stockItems.forEach((item) => {
    totalWeight += Number(item.weight || 0);

    if ((item.status || "IN_STOCK") === "SOLD") {
      soldCount++;
    } else {
      availableCount++;
    }
  });

  if (totalStockEl) totalStockEl.textContent = stockItems.length;
  if (totalWeightEl) totalWeightEl.textContent = totalWeight.toFixed(3) + " g";
  if (soldItemsEl) soldItemsEl.textContent = soldCount;
  if (availableItemsEl) availableItemsEl.textContent = availableCount;
  if (currentStockEl) currentStockEl.textContent = availableCount;

  const lowStockCount = availableCount <= 5 ? availableCount : 0;
  if (lowStockItemsEl) lowStockItemsEl.textContent = lowStockCount;
}

function renderStockSummary() {
  const tbody = document.getElementById("stockSummaryBody");
  if (!tbody) return;

  const searchAll = document.getElementById("stockSearchInput")?.value.trim().toLowerCase() || "";
  const skuFilter = document.getElementById("stockSkuFilter")?.value.trim().toLowerCase() || "";
  const sizeFilter = document.getElementById("stockSizeFilter")?.value.trim().toLowerCase() || "";
  const lotFilter = document.getElementById("stockLotFilter")?.value.trim().toLowerCase() || "";

  const totalSkuEl = document.getElementById("stockTotalSku");
  const totalQtyEl = document.getElementById("stockTotalQty");
  const totalWeightEl = document.getElementById("stockTotalWeight");
  const currentStockEl = document.getElementById("stockCurrentCount");

  tbody.innerHTML = "";

  const summaryMap = new Map();

  stockItems.forEach((item) => {
    const sku = String(item.sku || "").trim();
    const productName = String(item.productName || "").trim();
    const size = String(item.size || "").trim();
    const lot = String(item.lot || "").trim();
    const weight = Number(item.weight || 0);
    const status = String(item.status || "IN_STOCK").trim();

    const key = `${sku}__${productName}__${size}__${lot}`;

    if (!summaryMap.has(key)) {
      summaryMap.set(key, {
        sku,
        productName,
        size,
        lot,
        totalQty: 0,
        inStockQty: 0,
        soldQty: 0,
        totalWeight: 0
      });
    }

    const row = summaryMap.get(key);
    row.totalQty += 1;
    row.totalWeight += weight;

    if (status === "SOLD") {
      row.soldQty += 1;
    } else if (status === "IN_STOCK") {
      row.inStockQty += 1;
    }
  });

  const allRows = Array.from(summaryMap.values());

  const rows = allRows.filter((row) => {
    const combinedText = `${row.sku} ${row.productName} ${row.size} ${row.lot}`.toLowerCase();

    return (
      combinedText.includes(searchAll) &&
      row.sku.toLowerCase().includes(skuFilter) &&
      row.size.toLowerCase().includes(sizeFilter) &&
      row.lot.toLowerCase().includes(lotFilter)
    );
  });

  let totalQty = 0;
  let totalWeight = 0;
  let currentStock = 0;

  rows.forEach((row) => {
    totalQty += row.totalQty;
    totalWeight += row.totalWeight;
    currentStock += row.inStockQty;
  });

  if (totalSkuEl) totalSkuEl.textContent = rows.length;
  if (totalQtyEl) totalQtyEl.textContent = totalQty;
  if (totalWeightEl) totalWeightEl.textContent = totalWeight.toFixed(3) + " g";
  if (currentStockEl) currentStockEl.textContent = currentStock;

  if (rows.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" style="text-align:center;">No stock found</td>
      </tr>
    `;
    return;
  }

  rows.forEach((row) => {
    tbody.innerHTML += `
      <tr>
        <td>${row.sku}</td>
        <td>${row.productName}</td>
        <td>${row.lot}</td>
        <td>${row.size}</td>
        <td>${row.totalQty}</td>
        <td>${row.inStockQty}</td>
        <td>${row.soldQty}</td>
      </tr>
    `;
  });
}

function renderSalesAnalytics() {
  const todaySalesEl = document.getElementById("todaySales");
  const totalSalesAmountEl = document.getElementById("totalSalesAmount");
  const lowStockItemsEl = document.getElementById("lowStockItems");

  fetch(`${API_BASE}/getSales`)
    .then((res) => res.json())
    .then((data) => {
      const sales = Array.isArray(data) ? data : [];
      const today = new Date().toISOString().split("T")[0];

      let todaySales = 0;
      let totalSalesAmount = 0;

      sales.forEach((sale) => {
        const saleDate = String(sale.invoice_date || "").split("T")[0];
        const paid = Number(sale.paid_amount || 0);

        totalSalesAmount += paid;

        if (saleDate === today) {
          todaySales += paid;
        }
      });

      const inStockCount = stockItems.filter(
        (item) => (item.status || "IN_STOCK") === "IN_STOCK"
      ).length;

      const lowStockCount = inStockCount <= 5 ? inStockCount : 0;

      if (todaySalesEl) todaySalesEl.textContent = "₹ " + todaySales.toFixed(2);
      if (totalSalesAmountEl) totalSalesAmountEl.textContent = "₹ " + totalSalesAmount.toFixed(2);
      if (lowStockItemsEl) lowStockItemsEl.textContent = lowStockCount;
    })
    .catch((err) => {
      console.log("Sales analytics error:", err);
    });
}

// ================= SCANNER =================
function playScanBeep() {
  const beep = document.getElementById("scanBeep");
  if (!beep) return;

  beep.currentTime = 0;
  beep.play().catch(() => {});
}

function openBarcodeCamera() {
  const scannerBox = document.getElementById("scannerBox");
  const barcodeInput = document.getElementById("invoiceBarcodeInput");

  if (!scannerBox || scannerRunning) return;
  if (typeof Html5Qrcode === "undefined") {
    alert("Html5Qrcode library load nahi hui");
    return;
  }

  scannerBox.style.display = "block";
  html5QrCode = new Html5Qrcode("reader");

  Html5Qrcode.getCameras()
    .then((devices) => {
      if (!devices || devices.length === 0) {
        alert("Camera device nahi mila");
        return;
      }

      let cameraId = devices[0].id;

      const backCamera = devices.find((device) => {
        const label = (device.label || "").toLowerCase();
        return (
          label.includes("back") ||
          label.includes("rear") ||
          label.includes("environment")
        );
      });

      if (backCamera) {
        cameraId = backCamera.id;
      }

      html5QrCode.start(
        cameraId,
        {
          fps: 12,
          qrbox: { width: 280, height: 140 },
          aspectRatio: 1.777,
          disableFlip: false,
          videoConstraints: {
            facingMode: "environment"
          }
        },
        (decodedText) => {
          const now = Date.now();

          if (decodedText === lastScannedCode && now - lastScanTime < 2000) {
            return;
          }

          lastScannedCode = decodedText;
          lastScanTime = now;

          if (barcodeInput) {
            barcodeInput.value = decodedText;
            loadInvoiceItem();
          }

          playScanBeep();
        },
        () => {}
      )
        .then(() => {
          scannerRunning = true;
        })
        .catch((err) => {
          console.log("Scanner start error:", err);
          alert("Camera scanner start nahi hua");
        });
    })
    .catch((err) => {
      console.log("Camera access error:", err);
      alert("Camera access nahi mila");
    });
}

function closeBarcodeCamera() {
  const scannerBox = document.getElementById("scannerBox");

  if (html5QrCode && scannerRunning) {
    html5QrCode.stop()
      .then(() => {
        html5QrCode.clear();
        html5QrCode = null;
        scannerRunning = false;
        if (scannerBox) scannerBox.style.display = "none";
      })
      .catch((err) => {
        console.log("Scanner stop error:", err);
        html5QrCode = null;
        scannerRunning = false;
        if (scannerBox) scannerBox.style.display = "none";
      });
  } else {
    if (scannerBox) scannerBox.style.display = "none";
  }
}

// ================= INIT =================
document.addEventListener("DOMContentLoaded", function () {
  blockAllFormSubmit();
  loadFromServer();

  if (document.getElementById("salesHistoryBody")) {
    loadSalesHistory();
  }

  if (document.getElementById("lotSelector")) {
    syncLotPreview();
  }

  if (document.getElementById("stickerSize") && document.getElementById("stickerWeight")) {
    setupStickerKeyboardFlow();
  }

  if (document.getElementById("invoiceTableBody")) {
    renderInvoiceTable();
  }

  if (document.getElementById("invoiceBarcodeInput")) {
    setupInvoiceScannerFlow();
  }

  if (document.getElementById("invoiceNumber")) {
    setNewInvoiceNumber();
  }

  const billTypeEl = document.getElementById("invoiceBillType");
  const taxTypeEl = document.getElementById("invoiceTaxType");
  const gstPercentEl = document.getElementById("invoiceGstPercent");
  const discountEl = document.getElementById("invoiceDiscount");

  if (billTypeEl) billTypeEl.addEventListener("change", calculateInvoiceTotal);
  if (taxTypeEl) taxTypeEl.addEventListener("change", calculateInvoiceTotal);
  if (gstPercentEl) gstPercentEl.addEventListener("input", calculateInvoiceTotal);
  if (discountEl) discountEl.addEventListener("input", calculateInvoiceTotal);
});
function applyStockSearch() {
  const tbody = document.getElementById("inventoryTableBody");
  if (!tbody) return;

  const searchValue = document.getElementById("stockSearchInput")?.value.trim().toLowerCase() || "";

  tbody.innerHTML = "";

  const filteredItems = stockItems.filter((item) => {
    if ((item.status || "IN_STOCK") !== "IN_STOCK") return false;

    return (
      String(item.barcode || "").toLowerCase().includes(searchValue) ||
      String(item.productName || "").toLowerCase().includes(searchValue) ||
      String(item.sku || "").toLowerCase().includes(searchValue) ||
      String(item.size || "").toLowerCase().includes(searchValue) ||
      String(item.lot || "").toLowerCase().includes(searchValue)
    );
  });

  if (filteredItems.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" style="text-align:center;">No matching stock found</td>
      </tr>
    `;
    return;
  }

  filteredItems.forEach((item) => {
    tbody.innerHTML += `
      <tr>
        <td>${item.barcode || ""}</td>
        <td>${item.productName || ""}</td>
        <td>${item.sku || ""}</td>
        <td>${item.weight || ""}</td>
        <td>${item.size || ""}</td>
        <td>${item.lot || ""}</td>
        <td>${item.status || "IN_STOCK"}</td>
      </tr>
    `;
  });
}
function loadCustomerDateReport() {
  const customerName = document.getElementById("stockCustomerName")?.value.trim().toLowerCase() || "";
  const reportDate = document.getElementById("stockReportDate")?.value || "";

  const tbody = document.getElementById("customerDateReportBody");
  const totalBillsEl = document.getElementById("reportTotalBills");
  const totalItemsEl = document.getElementById("reportTotalItems");
  const totalWeightEl = document.getElementById("reportTotalWeight");

  if (!tbody) return;

  fetch(`${API_BASE}/getSales`)
    .then((res) => res.json())
    .then((data) => {
      const sales = Array.isArray(data) ? data : [];

      const filtered = sales.filter((sale) => {
        const saleName = String(sale.customer_name || "").toLowerCase();
        const saleDate = String(sale.invoice_date || "").split("T")[0];

        const nameMatch = !customerName || saleName.includes(customerName);
        const dateMatch = !reportDate || saleDate === reportDate;

        return nameMatch && dateMatch;
      });

      tbody.innerHTML = "";

      let totalBills = filtered.length;
      let totalItems = 0;
      let totalWeight = 0;

      if (filtered.length === 0) {
        tbody.innerHTML = `
          <tr>
            <td colspan="7" style="text-align:center;">No report data found</td>
          </tr>
        `;
        if (totalBillsEl) totalBillsEl.textContent = "0";
        if (totalItemsEl) totalItemsEl.textContent = "0";
        if (totalWeightEl) totalWeightEl.textContent = "0 g";
        return;
      }

      const salePromises = filtered.map((sale) =>
        fetch(`${API_BASE}/getSaleItems/${sale.id}`)
          .then((res) => res.json())
          .then((items) => {
            const itemList = Array.isArray(items) ? items : [];
            const billWeight = itemList.reduce((sum, item) => sum + Number(item.weight || 0), 0);

            totalItems += Number(sale.total_items || 0);
            totalWeight += billWeight;

            tbody.innerHTML += `
              <tr>
                <td>${sale.invoice_number || sale.id || ""}</td>
                <td>${sale.customer_name || ""}</td>
                <td>${String(sale.invoice_date || "").split("T")[0]}</td>
                <td>${sale.mobile || ""}</td>
                <td>${sale.total_items || 0}</td>
                <td>${sale.paid_amount || 0}</td>
                <td>${sale.due_amount || 0}</td>
              </tr>
            `;
          })
      );

      Promise.all(salePromises).then(() => {
        if (totalBillsEl) totalBillsEl.textContent = totalBills;
        if (totalItemsEl) totalItemsEl.textContent = totalItems;
        if (totalWeightEl) totalWeightEl.textContent = totalWeight.toFixed(3) + " g";
      });
    })
    .catch((err) => {
      console.log("Customer report error:", err);
      tbody.innerHTML = `
        <tr>
          <td colspan="7" style="text-align:center;">Report load error</td>
        </tr>
      `;
    });
}
function renderSoldDetails() {
  const tbody = document.getElementById("soldDetailsBody");
  if (!tbody) return;

  tbody.innerHTML = "";

  fetch(`${API_BASE}/getSales`)
    .then(res => res.json())
    .then(sales => {
      const saleList = Array.isArray(sales) ? sales : [];

      saleList.forEach(sale => {
        fetch(`${API_BASE}/getSaleItems/${sale.id}`)
          .then(res => res.json())
          .then(items => {
            (items || []).forEach(item => {
              tbody.innerHTML += `
                <tr>
                  <td>${item.barcode || ""}</td>
                  <td>${item.sku || ""}</td>
                  <td>${item.lot || ""}</td>
                  <td>${item.size || ""}</td>
                  <td>${Number(item.weight || 0).toFixed(3)}</td>
                  <td>${sale.customer_name || ""}</td>
                  <td>${sale.invoice_number || sale.id}</td>
                  <td>${(sale.invoice_date || "").split("T")[0]}</td>
                </tr>
              `;
            });
          });
      });
    })
    .catch(err => {
      console.log("Sold data error:", err);
    });
}`  `
function generateUniqueBarcode() {
  const timePart = Date.now().toString().slice(-5);
  const randPart = Math.floor(Math.random() * 90 + 10);
  return "S" + timePart + randPart;
}
// last me
function generateUniqueBarcode() {
  return Math.floor(10000000 + Math.random() * 90000000).toString();
}
function editStickerByIndex(index) {
  const item = stockItems[index];
  if (!item) return;

  document.getElementById("stickerSerial").value = item.serial || "";
  document.getElementById("stickerProductName").value = item.product_name || item.productName || item.party || "";
  document.getElementById("stickerPurity").value = item.purity || "";
  document.getElementById("stickerSku").value = item.sku || "";
  document.getElementById("stickerMM").value = item.mm || "";
  document.getElementById("stickerSize").value = item.size || "";
  document.getElementById("stickerWeight").value = item.weight || "";

  document.getElementById("lotSelector").value = item.lot_number || item.lot || "";
  document.getElementById("metalTypeSelector").value = item.metal_type || item.metalType || "Silver";
  document.getElementById("processTypeSelector").value = item.process_type || item.processType || "MixOrnaments";

  document.getElementById("editStickerBarcode").value = item.barcode || "";
  document.getElementById("stickerBarcode").value = item.barcode || "";

  syncLotPreview();
}
function editStickerByIndex(index) {
  const item = stockItems[index];
  if (!item) return;
  editSticker(item);
}
function deleteStickerByIndex(index) {
  const visibleItems = stockItems.filter((item) => {
    const statusOk = (item.status || "IN_STOCK") === "IN_STOCK";
    const notHidden = !hiddenDeletedBarcodes.includes(String(item.barcode || "").trim());
    return statusOk && notHidden;
  });

  const item = visibleItems[index];
  if (!item) return;

  const barcode = String(item.barcode || "").trim();
  if (!barcode) {
    alert("Barcode missing hai");
    return;
  }

  // stock list se hata
  stockItems = stockItems.filter(
    (x) => String(x.barcode || "").trim() !== barcode
  );

  // selected item clear
  if (
    window.selectedSticker &&
    String(window.selectedSticker.barcode || "").trim() === barcode
  ) {
    window.selectedSticker = null;
  }

  // deleted history me save
  deletedStickerHistory.push({
    ...item,
    deletedAt: new Date().toLocaleString(),
    deletedTs: Date.now(),
    restored: false
  });

  // hidden list me bhi daal
  if (!hiddenDeletedBarcodes.includes(barcode)) {
    hiddenDeletedBarcodes.push(barcode);
  }

  localStorage.setItem("stockItems", JSON.stringify(stockItems));
  localStorage.setItem("hiddenDeletedBarcodes", JSON.stringify(hiddenDeletedBarcodes));
  localStorage.setItem("deletedStickerHistory", JSON.stringify(deletedStickerHistory));

  renderStickerList();
  if (typeof renderHistory === "function") renderHistory();
  if (typeof renderInventoryTable === "function") renderInventoryTable();
  if (typeof renderStockSummary === "function") renderStockSummary();
}
function clearAllStickerForm() {
  const ids = [
    "stickerSerial",
    "stickerProductName",
    "stickerPurity",
    "stickerSku",
    "stickerMM",
    "stickerSize",
    "stickerWeight",
    "stickerBarcode",
    "editStickerBarcode"
  ];

  ids.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });

  const lotEl = document.getElementById("lotSelector");
  const metalTypeEl = document.getElementById("metalTypeSelector");
  const processTypeEl = document.getElementById("processTypeSelector");

  if (lotEl) lotEl.value = "";
  if (metalTypeEl) metalTypeEl.value = "Silver";
  if (processTypeEl) processTypeEl.value = "MixOrnaments";

  window.selectedSticker = null;

  const lotPreview = document.getElementById("lotPreviewText");
  const processPreview = document.getElementById("processPreviewText");

  if (lotPreview) lotPreview.textContent = "--";
  if (processPreview) processPreview.textContent = "MixOrnaments";
}

function newStickerData() {
  clearAllStickerForm();
}
function addStickerItem() {
  const data = {
    serial: document.getElementById("stickerSerial")?.value?.trim() || "",
    productName: document.getElementById("stickerProductName")?.value?.trim() || "",
    purity: document.getElementById("stickerPurity")?.value?.trim() || "",
    sku: document.getElementById("stickerSku")?.value?.trim() || "",
    mm: document.getElementById("stickerMM")?.value?.trim() || "",
    size: document.getElementById("stickerSize")?.value?.trim() || "",
    weight: document.getElementById("stickerWeight")?.value?.trim() || "",
    lot: document.getElementById("lotSelector")?.value?.trim() || "",
    barcode: document.getElementById("stickerBarcode")?.value?.trim() || "",
    status: "IN_STOCK"
  };

  if (!data.serial || !data.productName || !data.size || !data.weight) {
    alert("Required fields fill karo");
    return;
  }

  if (!data.barcode) {
    alert("Pehle barcode generate karo");
    return;
  }

  const barcode = String(data.barcode || "").trim();

  hiddenDeletedBarcodes = hiddenDeletedBarcodes.filter((b) => b !== barcode);
  localStorage.setItem("hiddenDeletedBarcodes", JSON.stringify(hiddenDeletedBarcodes));
const lotData = JSON.parse(localStorage.getItem("lotData")) || [];
const selectedLot = lotData.find(l => String(l.lotNo) === String(data.lot));

if (selectedLot) {
  const currentUsed = stockItems
    .filter(item => String(item.lot) === String(data.lot))
    .reduce((sum, item) => sum + Number(item.weight || 0), 0);

  const newUsed = currentUsed + Number(data.weight || 0);
  const finalWeight = Number(selectedLot.finalWeight || 0);

  if (newUsed > finalWeight) {
    alert("Over weight! Is lot ka balance khatam ho gaya.");
    return;
  }
}
  const alreadyExists = stockItems.some(
    (item) => String(item.barcode || "").trim() === barcode
  );

  if (alreadyExists) {
    alert("Ye barcode already sticker list me hai");
    return;
  }

  stockItems.push(data);
  localStorage.setItem("stockItems", JSON.stringify(stockItems));

  renderStickerList();
  clearAllStickerForm();
}
function addLot() {
  const lotNo = document.getElementById("lotSelector")?.value?.trim();
  const rawWeight = Number(document.getElementById("lotRawWeight")?.value || 0);
  const lossWeight = Number(document.getElementById("lotLossWeight")?.value || 0);

  if (!lotNo) {
    alert("Lot number daalo");
    return;
  }

  const finalWeight = rawWeight - lossWeight;

  const lot = {
    lotNo,
    rawWeight,
    lossWeight,
    finalWeight,
    createdAt: new Date().toISOString()
  };

  lotData.push(lot);
  localStorage.setItem("lotData", JSON.stringify(lotData));

  alert("Lot saved");
}function getLotSummary(lotNo) {
  const lot = lotData.find(l => l.lotNo === lotNo);

  const usedWeight = stockItems
    .filter(item => item.lot === lotNo)
    .reduce((sum, item) => sum + Number(item.weight || 0), 0);

  return {
    raw: lot?.rawWeight || 0,
    loss: lot?.lossWeight || 0,
    final: lot?.finalWeight || 0,
    used: usedWeight,
    remaining: (lot?.finalWeight || 0) - usedWeight
  };
}


function saveLot() {
  const lotNo = document.getElementById("lotNo").value.trim();
  const raw = Number(document.getElementById("lotRaw").value || 0);
  const loss = Number(document.getElementById("lotLoss").value || 0);

  if (!lotNo) {
    alert("Lot number daalo");
    return;
  }

  const final = raw - loss;

  const lot = {
    lotNo,
    raw,
    loss,
    final
  };

  lotData.push(lot);
  localStorage.setItem("lotData", JSON.stringify(lotData));

  updateLotSummary();
}
async function addStickerItem() {
  try {
    const serial = document.getElementById("stickerSerial").value.trim();
    const productName = document.getElementById("stickerProductName").value.trim();
    const purity = document.getElementById("stickerPurity").value.trim();
    const sku = document.getElementById("stickerSku").value.trim();
    const mm = document.getElementById("stickerMM").value.trim();
    const size = document.getElementById("stickerSize").value.trim();
    const weight = document.getElementById("stickerWeight").value.trim();
    const lot = document.getElementById("lotSelector").value.trim();
    const metalType = document.getElementById("metalTypeSelector").value;
    const processType = document.getElementById("processTypeSelector").value;

    let barcode = document.getElementById("stickerBarcode").value.trim();
    const editBarcode = document.getElementById("editStickerBarcode").value.trim();

    if (!productName || !weight) {
      alert("Party aur Weight daalo");
      return;
    }

    if (!barcode || !editBarcode) {
      barcode = generateBarcode();
      document.getElementById("stickerBarcode").value = barcode;
    }

    const payload = {
      serial,
      productName,
      purity,
      sku,
      mm,
      size,
      weight,
      lot,
      barcode,
      metalType,
      processType
    };

    const url = editBarcode
      ? `${API_BASE}/updateSticker/${editBarcode}`
      : `${API_BASE}/addSticker`;

    const method = editBarcode ? "PUT" : "POST";

    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const result = await res.json();

    if (!result.success) {
      alert(result.message || "Save failed");
      return;
    }

    await loadStockData();
    renderStickerList();
    newStickerData();

    alert(editBarcode ? "Sticker updated successfully" : "Sticker added successfully");
  } catch (error) {
    console.log("Add/Update sticker error:", error);
    alert("Server error");
  }
}
function updateLotSummary() {
  const lotNo = document.getElementById("lotNo").value;

  const lot = lotData.find(l => l.lotNo === lotNo);

  const used = stockItems
    .filter(i => i.lot === lotNo)
    .reduce((sum, i) => sum + Number(i.weight || 0), 0);

  const summary = document.getElementById("lotSummary");

  if (!lot) return;

  const balance = lot.final - used;

  summary.innerHTML =
    "Raw: " + lot.raw +
    " | Loss: " + lot.loss +
    " | Final: " + lot.final +
    " | Used: " + used.toFixed(3) +
    " | Balance: " + balance.toFixed(3);
}function loadLotDropdown() {
  const lotSelect = document.getElementById("lotNo");
  if (!lotSelect) return;

  const lotData = JSON.parse(localStorage.getItem("lotData")) || [];
  lotSelect.innerHTML = '<option value="">Select Lot</option>';

  lotData.forEach((lot) => {
    lotSelect.innerHTML += `<option value="${lot.lotNo}">${lot.lotNo}</option>`;
  });
}
function generateBarcode() {
  return "BC" + Date.now() + Math.floor(Math.random() * 1000);
}

function newStickerData() {
  document.getElementById("stickerSerial").value = "";
  document.getElementById("stickerProductName").value = "";
  document.getElementById("stickerPurity").value = "";
  document.getElementById("stickerSku").value = "";
  document.getElementById("stickerMM").value = "";
  document.getElementById("stickerSize").value = "";
  document.getElementById("stickerWeight").value = "";

  document.getElementById("editStickerBarcode").value = "";
  document.getElementById("stickerBarcode").value = generateBarcode();
}