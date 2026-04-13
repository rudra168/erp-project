require("dotenv").config();

const express = require("express");
const cors = require("cors");
const mysql = require("mysql2/promise");

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

const pool = mysql.createPool({
  host: process.env.MYSQLHOST,
  user: process.env.MYSQLUSER,
  password: process.env.MYSQLPASSWORD,
  database: process.env.MYSQLDATABASE,
  port: Number(process.env.MYSQLPORT || 3306),
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

console.log("DB ENV CHECK:", {
  host: process.env.MYSQLHOST,
  user: process.env.MYSQLUSER,
  database: process.env.MYSQLDATABASE,
  port: process.env.MYSQLPORT
});

process.on("uncaughtException", (err) => {
  console.error("UNCAUGHT EXCEPTION:", err);
});

process.on("unhandledRejection", (reason) => {
  console.error("UNHANDLED REJECTION:", reason);
});

function format3(value) {
  const n = Number(value || 0);
  return isNaN(n) ? "0.000" : n.toFixed(3);
}

function num(value) {
  const n = Number(value || 0);
  return isNaN(n) ? 0 : n;
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeStatus(value, fallback = "") {
  return String(value || fallback).trim().toUpperCase();
}

function getRequestedCompanyId(req) {
  const raw =
    req.query.companyId ??
    req.body.companyId ??
    req.params.companyId ??
    null;

  if (raw === null || raw === undefined || raw === "") return null;

  const parsed = Number(raw);
  return Number.isNaN(parsed) ? null : parsed;
}

function isSuperAdminUser(user = {}) {
  const role = String(user.role || "").trim().toLowerCase();
  const email = normalizeEmail(user.email || "");
  return role === "superadmin" || email === "grudrapratap0@gmail.com";
}

async function testDbConnection() {
  const conn = await pool.getConnection();
  await conn.ping();
  conn.release();
}

async function findUserByEmailAndPassword(email, password) {
  const [rows] = await pool.query(
    `
    SELECT 
      u.*,
      c.company_name,
      c.owner_name AS company_owner_name,
      c.owner_email AS company_owner_email,
      c.status AS company_status
    FROM users u
    LEFT JOIN companies c ON c.id = u.company_id
    WHERE u.email = ? AND u.password = ?
    LIMIT 1
    `,
    [email, password]
  );

  return rows.length ? rows[0] : null;
}

async function ensureSuperAdminExists() {
  try {
    const superAdminEmail = "grudrapratap0@gmail.com";

    const [rows] = await pool.query(
      `SELECT id FROM users WHERE email = ? LIMIT 1`,
      [superAdminEmail]
    );

    if (rows.length > 0) return;

    await pool.query(
      `
      INSERT INTO users
      (name, mobile, email, password, role, status, company_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      [
        "Super Admin",
        "",
        superAdminEmail,
        "1234",
        "SuperAdmin",
        "approved",
        null
      ]
    );

    console.log("Default SuperAdmin created ✅");
  } catch (error) {
    console.error("SuperAdmin create error:", error);
  }
}

/* =========================
   BASIC ROUTES
========================= */
app.get("/", (req, res) => {
  return res.status(200).json({
    success: true,
    message: "ERP backend running"
  });
});

app.get("/api/test", (req, res) => {
  return res.status(200).send("API TEST OK");
});

app.get("/health", async (req, res) => {
  try {
    await testDbConnection();
    return res.status(200).json({
      success: true,
      app: "ok",
      db: "ok"
    });
  } catch (error) {
    console.error("Health check error:", error);
    return res.status(500).json({
      success: false,
      app: "ok",
      db: "failed",
      error: error.message
    });
  }
});

/* =========================
   DASHBOARD
========================= */
app.get("/api/dashboard", async (req, res) => {
  try {
    const companyId = getRequestedCompanyId(req);

    let stockWhere = "";
    let salesWhere = "";
    const stockParams = [];
    const salesParams = [];

    if (companyId !== null) {
      stockWhere = "WHERE company_id = ?";
      salesWhere = "WHERE company_id = ?";
      stockParams.push(companyId);
      salesParams.push(companyId);
    }

    const [stockSummary] = await pool.query(
      `
      SELECT 
        COUNT(*) AS total_items,
        COALESCE(SUM(weight), 0) AS total_weight
      FROM stock
      ${stockWhere}
      `,
      stockParams
    );

    const [soldSummary] = await pool.query(
      `
      SELECT COUNT(*) AS sold_items
      FROM stock
      ${companyId !== null ? "WHERE company_id = ? AND status = 'SOLD'" : "WHERE status = 'SOLD'"}
      `,
      companyId !== null ? [companyId] : []
    );

    const [inStockSummary] = await pool.query(
      `
      SELECT COUNT(*) AS in_stock_items
      FROM stock
      ${companyId !== null ? "WHERE company_id = ? AND status = 'IN_STOCK'" : "WHERE status = 'IN_STOCK'"}
      `,
      companyId !== null ? [companyId] : []
    );

    const [salesSummary] = await pool.query(
      `
      SELECT 
        COUNT(*) AS total_sales,
        COALESCE(SUM(total_amount), 0) AS total_sales_amount
      FROM sales_history
      ${salesWhere}
      `,
      salesParams
    );

    const [recentInvoices] = await pool.query(
      `
      SELECT invoice_number, customer_name, total_amount, invoice_date, created_at, company_id
      FROM sales_history
      ${salesWhere}
      ORDER BY id DESC
      LIMIT 8
      `,
      salesParams
    );

    return res.json({
      success: true,
      totalStock: Number(stockSummary[0]?.total_items || 0),
      totalWeight: Number(stockSummary[0]?.total_weight || 0),
      soldItems: Number(soldSummary[0]?.sold_items || 0),
      availableItems: Number(inStockSummary[0]?.in_stock_items || 0),
      totalSales: Number(salesSummary[0]?.total_sales || 0),
      totalSalesAmount: Number(salesSummary[0]?.total_sales_amount || 0),
      recentInvoices
    });
  } catch (error) {
    console.error("Dashboard error:", error);
    return res.status(500).json({ success: false, message: "Dashboard fetch failed" });
  }
});

/* =========================
   GET ALL STOCK
========================= */
app.get("/getStock", async (req, res) => {
  try {
    const companyId = getRequestedCompanyId(req);

    const whereClause = companyId !== null ? "WHERE company_id = ?" : "";
    const params = companyId !== null ? [companyId] : [];

    const [rows] = await pool.query(
      `
      SELECT *
      FROM stock
      ${whereClause}
      ORDER BY
        CAST(COALESCE(lot_number, '0') AS UNSIGNED) ASC,
        CAST(COALESCE(serial, '0') AS UNSIGNED) ASC,
        id ASC
      `,
      params
    );

    return res.json(rows);
  } catch (error) {
    console.error("Get stock error:", error);
    return res.status(500).json({ success: false, message: "Stock fetch failed" });
  }
});

/* =========================
   GET ITEM BY BARCODE
========================= */
app.get("/getSticker/:barcode", async (req, res) => {
  try {
    const barcode = String(req.params.barcode || "").trim();
    const companyId = getRequestedCompanyId(req);

    const [rows] = await pool.query(
      `
      SELECT *
      FROM stock
      WHERE barcode = ?
      ${companyId !== null ? "AND company_id = ?" : ""}
      LIMIT 1
      `,
      companyId !== null ? [barcode, companyId] : [barcode]
    );

    if (!rows.length) {
      return res.status(404).json({
        success: false,
        message: "Item not found"
      });
    }

    return res.json({
      success: true,
      item: rows[0]
    });
  } catch (error) {
    console.error("Get sticker error:", error);
    return res.status(500).json({ success: false, message: "Fetch failed" });
  }
});

/* =========================
   ADD STICKER
========================= */
app.post("/addSticker", async (req, res) => {
  try {
    const {
      serial,
      productName,
      purity,
      sku,
      mm,
      size,
      weight,
      lot,
      metalType,
      processType,
      barcode,
      companyId
    } = req.body;

    const finalCompanyId = companyId === null || companyId === undefined || companyId === ""
      ? null
      : Number(companyId);

    if (!serial || !productName || !purity || !sku || !size || !weight || !lot || !barcode) {
      return res.json({
        success: false,
        message: "Serial, Product, Purity, SKU, Size, Weight, Lot aur Barcode required hai"
      });
    }

    if (finalCompanyId === null || Number.isNaN(finalCompanyId)) {
      return res.json({
        success: false,
        message: "companyId required hai"
      });
    }

    const cleanLot = String(lot).trim();
    const cleanSerial = String(serial).trim();
    const cleanBarcode = String(barcode).trim();

    const [dupLotSerial] = await pool.query(
      `
      SELECT id FROM stock
      WHERE lot_number = ?
        AND serial = ?
        AND company_id = ?
        AND UPPER(COALESCE(status, 'IN_STOCK')) = 'IN_STOCK'
      LIMIT 1
      `,
      [cleanLot, cleanSerial, finalCompanyId]
    );

    if (dupLotSerial.length > 0) {
      return res.json({
        success: false,
        message: `Lot ${cleanLot} me serial ${cleanSerial} pehle se exist hai`
      });
    }

    const [dupBarcode] = await pool.query(
      `
      SELECT id FROM stock
      WHERE barcode = ?
        AND company_id = ?
        AND UPPER(COALESCE(status, 'IN_STOCK')) = 'IN_STOCK'
      LIMIT 1
      `,
      [cleanBarcode, finalCompanyId]
    );

    if (dupBarcode.length > 0) {
      return res.json({
        success: false,
        message: `Barcode ${cleanBarcode} pehle se exist hai`
      });
    }

    await pool.query(
      `
      INSERT INTO stock (
        serial,
        product_name,
        purity,
        sku,
        mm,
        size,
        weight,
        lot_number,
        barcode,
        metal_type,
        process_type,
        status,
        company_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        cleanSerial,
        String(productName).trim(),
        String(purity).trim(),
        String(sku).trim(),
        String(mm || "").trim(),
        String(size).trim(),
        Number(format3(weight)),
        cleanLot,
        cleanBarcode,
        String(metalType || "").trim(),
        String(processType || "").trim(),
        "IN_STOCK",
        finalCompanyId
      ]
    );

    return res.json({
      success: true,
      message: "Sticker added successfully"
    });
  } catch (err) {
    console.error("Add sticker error:", err);
    return res.status(500).json({ success: false, message: "Add sticker failed" });
  }
});

/* =========================
   UPDATE STICKER
========================= */
app.put("/updateSticker/:barcode", async (req, res) => {
  try {
    const oldBarcode = String(req.params.barcode || "").trim();

    const {
      serial = "",
      productName = "",
      purity = "",
      sku = "",
      mm = "",
      size = "",
      weight = 0,
      lot = "",
      barcode = oldBarcode,
      metalType = "",
      processType = "",
      qty = 1,
      status = "IN_STOCK",
      companyId = null
    } = req.body;

    const finalCompanyId =
      companyId === null || companyId === undefined || companyId === ""
        ? null
        : Number(companyId);

    if (!oldBarcode) {
      return res.json({ success: false, message: "Old barcode missing hai" });
    }

    if (!serial || !productName || !purity || !sku || !size || !weight || !lot) {
      return res.json({
        success: false,
        message: "Serial, Product, Purity, SKU, Size, Weight aur Lot required hai"
      });
    }

    if (finalCompanyId === null || Number.isNaN(finalCompanyId)) {
      return res.json({
        success: false,
        message: "companyId required hai"
      });
    }

    const cleanLot = String(lot).trim();
    const cleanSerial = String(serial).trim();
    const newBarcode = String(barcode || oldBarcode).trim();

    const [currentRows] = await pool.query(
      `
      SELECT id
      FROM stock
      WHERE barcode = ? AND company_id = ?
      LIMIT 1
      `,
      [oldBarcode, finalCompanyId]
    );

    if (currentRows.length === 0) {
      return res.json({ success: false, message: "Sticker item nahi mila" });
    }

    const currentId = currentRows[0].id;

    const [dupLotSerial] = await pool.query(
      `
      SELECT id FROM stock
      WHERE lot_number = ?
        AND serial = ?
        AND company_id = ?
        AND id <> ?
        AND UPPER(COALESCE(status, 'IN_STOCK')) = 'IN_STOCK'
      LIMIT 1
      `,
      [cleanLot, cleanSerial, finalCompanyId, currentId]
    );

    if (dupLotSerial.length > 0) {
      return res.json({
        success: false,
        message: `Lot ${cleanLot} me serial ${cleanSerial} pehle se exist hai`
      });
    }

    const [dupBarcode] = await pool.query(
      `
      SELECT id FROM stock
      WHERE barcode = ?
        AND company_id = ?
        AND id <> ?
        AND UPPER(COALESCE(status, 'IN_STOCK')) = 'IN_STOCK'
      LIMIT 1
      `,
      [newBarcode, finalCompanyId, currentId]
    );

    if (dupBarcode.length > 0) {
      return res.json({
        success: false,
        message: `Barcode ${newBarcode} pehle se exist hai`
      });
    }

    await pool.query(
      `
      UPDATE stock
      SET
        serial = ?,
        product_name = ?,
        purity = ?,
        sku = ?,
        mm = ?,
        size = ?,
        weight = ?,
        qty = ?,
        lot_number = ?,
        barcode = ?,
        metal_type = ?,
        process_type = ?,
        status = ?
      WHERE id = ?
      `,
      [
        cleanSerial,
        String(productName).trim(),
        String(purity).trim(),
        String(sku).trim(),
        String(mm || "").trim(),
        String(size).trim(),
        Number(format3(weight)),
        Number(qty || 1),
        cleanLot,
        newBarcode,
        String(metalType || "").trim(),
        String(processType || "").trim(),
        String(status || "IN_STOCK").trim(),
        currentId
      ]
    );

    return res.json({
      success: true,
      message: "Sticker updated successfully"
    });
  } catch (error) {
    console.error("Update sticker error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

/* =========================
   DELETE STICKER
========================= */
app.delete("/deleteSticker/:barcode", async (req, res) => {
  try {
    const barcode = String(req.params.barcode || "").trim();
    const companyId = getRequestedCompanyId(req);

    if (companyId === null) {
      return res.json({ success: false, message: "companyId required hai" });
    }

    await pool.query(
      `DELETE FROM stock WHERE barcode = ? AND company_id = ?`,
      [barcode, companyId]
    );

    return res.json({
      success: true,
      message: "Sticker deleted successfully"
    });
  } catch (error) {
    console.error("Delete sticker error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

/* =========================
   RESTORE STICKER
========================= */
app.put("/restoreSticker/:barcode", async (req, res) => {
  try {
    const barcode = String(req.params.barcode || "").trim();
    const companyId = getRequestedCompanyId(req);

    if (companyId === null) {
      return res.json({ success: false, message: "companyId required hai" });
    }

    await pool.query(
      `UPDATE stock SET status = 'IN_STOCK' WHERE barcode = ? AND company_id = ?`,
      [barcode, companyId]
    );

    return res.json({ success: true, message: "Sticker restored" });
  } catch (err) {
    console.error("Restore error:", err);
    return res.status(500).json({ success: false, message: "Restore failed" });
  }
});

/* =========================
   SAVE INVOICE
========================= */
app.post("/saveInvoice", async (req, res) => {
  let connection;

  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const {
      invoiceNumber = "",
      customerName = "",
      mobile = "",
      gstNumber = "",
      invoiceDate = "",
      paymentMode = "",
      paymentStatus = "",
      paidAmount = 0,
      dueAmount = 0,
      ratePerGram = 0,
      mcRate = 0,
      roundOff = 0,
      subtotal = 0,
      grandTotal = 0,
      items = [],
      companyId = null
    } = req.body;

    const finalCompanyId =
      companyId === null || companyId === undefined || companyId === ""
        ? null
        : Number(companyId);

    if (!invoiceNumber || !items.length) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        message: "Invoice data incomplete hai"
      });
    }

    if (finalCompanyId === null || Number.isNaN(finalCompanyId)) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        message: "companyId required hai"
      });
    }

    const [saleInsert] = await connection.query(
      `
      INSERT INTO sales_history
      (
        invoice_number, customer_name, mobile, gst_number, invoice_date,
        payment_mode, payment_status, paid_amount, due_amount,
        rate_per_gram, mc_rate, round_off, subtotal, total_amount, created_at, company_id
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?)
      `,
      [
        invoiceNumber,
        customerName,
        mobile,
        gstNumber,
        invoiceDate,
        paymentMode,
        paymentStatus,
        Number(paidAmount || 0),
        Number(dueAmount || 0),
        Number(ratePerGram || 0),
        Number(mcRate || 0),
        Number(roundOff || 0),
        Number(subtotal || 0),
        Number(grandTotal || 0),
        finalCompanyId
      ]
    );

    const saleId = saleInsert.insertId;

    for (const item of items) {
      const barcode = String(item.barcode || "").trim();

      await connection.query(
        `
        INSERT INTO sales_items
        (
          sale_id, invoice_number, barcode, product_name, sku, purity, size, weight, lot_number, customer_name, created_at, company_id
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?)
        `,
        [
          saleId,
          invoiceNumber,
          barcode,
          item.productName || item.product_name || "",
          item.sku || "",
          item.purity || "",
          item.size || "",
          Number(item.weight || 0),
          item.lot || item.lot_number || "",
          customerName,
          finalCompanyId
        ]
      );

      if (barcode) {
        await connection.query(
          `UPDATE stock SET status = 'SOLD' WHERE barcode = ? AND company_id = ?`,
          [barcode, finalCompanyId]
        );
      }
    }

    await connection.commit();

    return res.json({
      success: true,
      message: "Invoice saved successfully"
    });
  } catch (error) {
    if (connection) {
      try {
        await connection.rollback();
      } catch (_) {}
    }
    console.error("Save invoice error:", error);
    return res.status(500).json({ success: false, message: "Invoice save failed" });
  } finally {
    if (connection) connection.release();
  }
});

/* =========================
   SALES HISTORY
========================= */
app.get("/getSalesHistory", async (req, res) => {
  try {
    const companyId = getRequestedCompanyId(req);

    const [sales] = await pool.query(
      `
      SELECT 
        sh.*,
        (SELECT COUNT(*) FROM sales_items si WHERE si.sale_id = sh.id) AS total_items
      FROM sales_history sh
      ${companyId !== null ? "WHERE sh.company_id = ?" : ""}
      ORDER BY sh.id DESC
      `,
      companyId !== null ? [companyId] : []
    );

    return res.json({
      success: true,
      sales
    });
  } catch (error) {
    console.error("Sales history error:", error);
    return res.status(500).json({ success: false, message: "Sales history fetch failed" });
  }
});

app.get("/sales-history", async (req, res) => {
  try {
    const companyId = getRequestedCompanyId(req);

    const [sales] = await pool.query(
      `
      SELECT 
        sh.*,
        (SELECT COUNT(*) FROM sales_items si WHERE si.sale_id = sh.id) AS total_items
      FROM sales_history sh
      ${companyId !== null ? "WHERE sh.company_id = ?" : ""}
      ORDER BY sh.id DESC
      `,
      companyId !== null ? [companyId] : []
    );

    return res.json(sales);
  } catch (error) {
    console.error("Sales history error:", error);
    return res.status(500).json([]);
  }
});

/* =========================
   INVOICE ITEMS
========================= */
app.get("/getInvoiceItems/:invoiceNumber", async (req, res) => {
  try {
    const invoiceNumber = String(req.params.invoiceNumber || "").trim();
    const companyId = getRequestedCompanyId(req);

    const [items] = await pool.query(
      `
      SELECT *
      FROM sales_items
      WHERE invoice_number = ?
      ${companyId !== null ? "AND company_id = ?" : ""}
      ORDER BY id DESC
      `,
      companyId !== null ? [invoiceNumber, companyId] : [invoiceNumber]
    );

    return res.json({
      success: true,
      items
    });
  } catch (error) {
    console.error("Invoice items error:", error);
    return res.status(500).json({ success: false, message: "Invoice items fetch failed" });
  }
});

/* =========================
   RETURN ITEM
========================= */
app.put("/returnItem/:barcode", async (req, res) => {
  try {
    const barcode = String(req.params.barcode || "").trim();
    const companyId = getRequestedCompanyId(req);

    if (companyId === null) {
      return res.json({ success: false, message: "companyId required hai" });
    }

    await pool.query(
      `UPDATE stock SET status = 'IN_STOCK' WHERE barcode = ? AND company_id = ?`,
      [barcode, companyId]
    );

    return res.json({
      success: true,
      message: "Item returned successfully"
    });
  } catch (error) {
    console.error("Return item error:", error);
    return res.status(500).json({ success: false, message: "Return failed" });
  }
});

/* =========================
   COMPANY SIGNUP REQUEST
========================= */
app.post("/requestCompanySignup", async (req, res) => {
  try {
    const {
      companyName = "",
      ownerName = "",
      mobile = "",
      email = "",
      password = ""
    } = req.body;

    const cleanCompanyName = String(companyName).trim();
    const cleanOwnerName = String(ownerName).trim();
    const cleanMobile = String(mobile).trim();
    const cleanEmail = normalizeEmail(email);
    const cleanPassword = String(password).trim();

    if (!cleanCompanyName || !cleanOwnerName || !cleanEmail || !cleanPassword) {
      return res.json({
        success: false,
        message: "Company name, owner name, email aur password required hai"
      });
    }

    const [existingRequest] = await pool.query(
      `
      SELECT id
      FROM company_signup_requests
      WHERE owner_email = ?
        AND status = 'pending'
      LIMIT 1
      `,
      [cleanEmail]
    );

    if (existingRequest.length > 0) {
      return res.json({
        success: false,
        message: "Ye signup request already pending hai"
      });
    }

    const [existingUser] = await pool.query(
      `SELECT id FROM users WHERE email = ? LIMIT 1`,
      [cleanEmail]
    );

    if (existingUser.length > 0) {
      return res.json({
        success: false,
        message: "Ye email pehle se system me exist hai"
      });
    }

    await pool.query(
      `
      INSERT INTO company_signup_requests
      (company_name, owner_name, mobile, owner_email, password, status)
      VALUES (?, ?, ?, ?, ?, ?)
      `,
      [cleanCompanyName, cleanOwnerName, cleanMobile, cleanEmail, cleanPassword, "pending"]
    );

    return res.json({
      success: true,
      message: "Signup request admin approval ke liye chali gayi"
    });
  } catch (error) {
    console.error("Company signup request error:", error);
    return res.status(500).json({
      success: false,
      message: "Company signup request failed"
    });
  }
});

/* =========================
   GET PENDING COMPANY REQUESTS
========================= */
app.get("/pendingCompanyRequests", async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT *
      FROM company_signup_requests
      WHERE status = 'pending'
      ORDER BY id DESC
    `);

    return res.json({
      success: true,
      requests: rows
    });
  } catch (error) {
    console.error("Pending company requests error:", error);
    return res.status(500).json({
      success: false,
      message: "Pending company requests fetch failed"
    });
  }
});

/* =========================
   APPROVE COMPANY REQUEST
========================= */
app.put("/approveCompanyRequest/:id", async (req, res) => {
  let connection;

  try {
    const requestId = Number(req.params.id);

    if (!requestId) {
      return res.json({
        success: false,
        message: "Request id required hai"
      });
    }

    connection = await pool.getConnection();
    await connection.beginTransaction();

    const [requestRows] = await connection.query(
      `
      SELECT *
      FROM company_signup_requests
      WHERE id = ? AND status = 'pending'
      LIMIT 1
      `,
      [requestId]
    );

    if (!requestRows.length) {
      await connection.rollback();
      return res.json({
        success: false,
        message: "Pending request nahi mila"
      });
    }

    const requestData = requestRows[0];

    const [existingCompany] = await connection.query(
      `SELECT id FROM companies WHERE owner_email = ? LIMIT 1`,
      [requestData.owner_email]
    );

    if (existingCompany.length > 0) {
      await connection.rollback();
      return res.json({
        success: false,
        message: "Is email ke liye company already exist hai"
      });
    }

    const [existingUser] = await connection.query(
      `SELECT id FROM users WHERE email = ? LIMIT 1`,
      [requestData.owner_email]
    );

    if (existingUser.length > 0) {
      await connection.rollback();
      return res.json({
        success: false,
        message: "Is email ka user already exist hai"
      });
    }

    const [companyInsert] = await connection.query(
      `
      INSERT INTO companies (company_name, owner_name, owner_email, status, created_at)
      VALUES (?, ?, ?, ?, NOW())
      `,
      [
        requestData.company_name,
        requestData.owner_name,
        requestData.owner_email,
        "active"
      ]
    );

    const companyId = companyInsert.insertId;

    await connection.query(
      `
      INSERT INTO users (name, mobile, email, password, role, status, company_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, NOW())
      `,
      [
        requestData.owner_name,
        requestData.mobile || "",
        requestData.owner_email,
        requestData.password,
        "Admin",
        "approved",
        companyId
      ]
    );

    await connection.query(
      `
      UPDATE company_signup_requests
      SET status = 'approved', approved_at = NOW(), company_id = ?
      WHERE id = ?
      `,
      [companyId, requestId]
    );

    await connection.commit();

    return res.json({
      success: true,
      message: "Company aur admin user successfully create ho gaya",
      companyId
    });
  } catch (error) {
    if (connection) {
      try {
        await connection.rollback();
      } catch (_) {}
    }

    console.error("Approve company request error:", error);
    return res.status(500).json({
      success: false,
      message: "Approve company request failed"
    });
  } finally {
    if (connection) connection.release();
  }
});

/* =========================
   REJECT COMPANY REQUEST
========================= */
app.put("/rejectCompanyRequest/:id", async (req, res) => {
  try {
    const requestId = Number(req.params.id);

    if (!requestId) {
      return res.json({
        success: false,
        message: "Request id required hai"
      });
    }

    const [requestRows] = await pool.query(
      `
      SELECT id
      FROM company_signup_requests
      WHERE id = ? AND status = 'pending'
      LIMIT 1
      `,
      [requestId]
    );

    if (!requestRows.length) {
      return res.json({
        success: false,
        message: "Pending request nahi mila"
      });
    }

    await pool.query(
      `
      UPDATE company_signup_requests
      SET status = 'rejected', rejected_at = NOW()
      WHERE id = ?
      `,
      [requestId]
    );

    return res.json({
      success: true,
      message: "Company request rejected successfully"
    });
  } catch (error) {
    console.error("Reject company request error:", error);
    return res.status(500).json({
      success: false,
      message: "Reject company request failed"
    });
  }
});

/* =========================
   GET APPROVED COMPANIES
========================= */
app.get("/approvedCompanies", async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT *
      FROM companies
      ORDER BY id DESC
    `);

    return res.json({
      success: true,
      companies: rows
    });
  } catch (error) {
    console.error("Approved companies error:", error);
    return res.status(500).json({
      success: false,
      message: "Approved companies fetch failed"
    });
  }
});

/* =========================
   COMPANY USERS
========================= */
app.get("/companyUsers", async (req, res) => {
  try {
    const companyId = getRequestedCompanyId(req);

    if (companyId === null) {
      return res.json({
        success: false,
        message: "companyId required hai"
      });
    }

    const [rows] = await pool.query(
      `
      SELECT id, name, mobile, email, role, status, company_id, created_at
      FROM users
      WHERE company_id = ?
      ORDER BY id DESC
      `,
      [companyId]
    );

    return res.json({
      success: true,
      users: rows
    });
  } catch (error) {
    console.error("Company users error:", error);
    return res.status(500).json({
      success: false,
      message: "Company users fetch failed"
    });
  }
});

/* =========================
   REGISTER USER (company staff)
========================= */
app.post("/registerUser", async (req, res) => {
  try {
    const {
      name = "",
      mobile = "",
      email = "",
      password = "",
      companyId = null
    } = req.body;

    const cleanName = String(name).trim();
    const cleanMobile = String(mobile).trim();
    const cleanEmail = normalizeEmail(email);
    const cleanPassword = String(password).trim();
    const finalCompanyId =
      companyId === null || companyId === undefined || companyId === ""
        ? null
        : Number(companyId);

    if (!cleanName || !cleanEmail || !cleanPassword) {
      return res.json({
        success: false,
        message: "Name, email aur password required hai"
      });
    }

    if (finalCompanyId === null || Number.isNaN(finalCompanyId)) {
      return res.json({
        success: false,
        message: "companyId required hai"
      });
    }

    const [existingUsers] = await pool.query(
      `SELECT id FROM users WHERE email = ? LIMIT 1`,
      [cleanEmail]
    );

    if (existingUsers.length > 0) {
      return res.json({
        success: false,
        message: "Ye email pehle se registered hai"
      });
    }

    await pool.query(
      `
      INSERT INTO users (name, mobile, email, password, role, status, company_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, NOW())
      `,
      [cleanName, cleanMobile, cleanEmail, cleanPassword, "", "pending", finalCompanyId]
    );

    return res.json({
      success: true,
      message: "Request admin approval ke liye chali gayi"
    });
  } catch (error) {
    console.error("Register user error:", error);
    return res.status(500).json({
      success: false,
      message: "Register failed"
    });
  }
});

/* =========================
   GET PENDING USERS
========================= */
app.get("/pendingUsers", async (req, res) => {
  try {
    const companyId = getRequestedCompanyId(req);

    const [rows] = await pool.query(
      `
      SELECT id, name, mobile, email, role, status, created_at, company_id
      FROM users
      WHERE status = 'pending'
      ${companyId !== null ? "AND company_id = ?" : ""}
      ORDER BY id DESC
      `,
      companyId !== null ? [companyId] : []
    );

    return res.json({
      success: true,
      users: rows
    });
  } catch (error) {
    console.error("Pending users error:", error);
    return res.status(500).json({
      success: false,
      message: "Pending users fetch failed"
    });
  }
});

/* =========================
   GET APPROVED USERS
========================= */
app.get("/approvedUsers", async (req, res) => {
  try {
    const companyId = getRequestedCompanyId(req);

    const [rows] = await pool.query(
      `
      SELECT id, name, mobile, email, role, status, created_at, company_id
      FROM users
      WHERE status = 'approved'
      ${companyId !== null ? "AND company_id = ?" : ""}
      ORDER BY id DESC
      `,
      companyId !== null ? [companyId] : []
    );

    return res.json({
      success: true,
      users: rows
    });
  } catch (error) {
    console.error("Approved users error:", error);
    return res.status(500).json({
      success: false,
      message: "Approved users fetch failed"
    });
  }
});

/* =========================
   APPROVE USER
========================= */
app.put("/approveUser/:id", async (req, res) => {
  try {
    const userId = Number(req.params.id);
    const role = String(req.body.role || "").trim();

    if (!userId || !role) {
      return res.json({
        success: false,
        message: "User id aur role required hai"
      });
    }

    const [checkUser] = await pool.query(
      `SELECT id FROM users WHERE id = ? LIMIT 1`,
      [userId]
    );

    if (!checkUser.length) {
      return res.json({
        success: false,
        message: "User nahi mila"
      });
    }

    await pool.query(
      `
      UPDATE users
      SET role = ?, status = 'approved'
      WHERE id = ?
      `,
      [role, userId]
    );

    return res.json({
      success: true,
      message: "User approved successfully"
    });
  } catch (error) {
    console.error("Approve user error:", error);
    return res.status(500).json({
      success: false,
      message: "Approve failed"
    });
  }
});

/* =========================
   REJECT USER
========================= */
app.put("/rejectUser/:id", async (req, res) => {
  try {
    const userId = Number(req.params.id);

    if (!userId) {
      return res.json({
        success: false,
        message: "User id required hai"
      });
    }

    const [checkUser] = await pool.query(
      `SELECT id FROM users WHERE id = ? LIMIT 1`,
      [userId]
    );

    if (!checkUser.length) {
      return res.json({
        success: false,
        message: "User nahi mila"
      });
    }

    await pool.query(
      `
      UPDATE users
      SET status = 'rejected'
      WHERE id = ?
      `,
      [userId]
    );

    return res.json({
      success: true,
      message: "User rejected successfully"
    });
  } catch (error) {
    console.error("Reject user error:", error);
    return res.status(500).json({
      success: false,
      message: "Reject failed"
    });
  }
});

/* =========================
   LOGIN
========================= */
app.post("/login", async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    const password = String(req.body.password || "").trim();

    const user = await findUserByEmailAndPassword(email, password);

    if (!user) {
      return res.json({ success: false, message: "Invalid login" });
    }

    if (String(user.status || "").toLowerCase() !== "approved") {
      return res.json({ success: false, message: "Pending approval" });
    }

    return res.json({
      success: true,
      user: {
        id: user.id,
        name: user.name,
        mobile: user.mobile,
        email: user.email,
        role: user.role,
        status: user.status,
        company_id: user.company_id,
        companyId: user.company_id,
        company_name: user.company_name || "",
        companyName: user.company_name || "",
        company_status: user.company_status || ""
      }
    });
  } catch (error) {
    console.error("Login error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

/* =========================
   GET USER BY EMAIL
========================= */
app.get("/userByEmail", async (req, res) => {
  try {
    const email = normalizeEmail(req.query.email);

    if (!email) {
      return res.json({ success: false, message: "email required hai" });
    }

    const [rows] = await pool.query(
      `
      SELECT 
        u.id, u.name, u.mobile, u.email, u.role, u.status, u.company_id, u.created_at,
        c.company_name
      FROM users u
      LEFT JOIN companies c ON c.id = u.company_id
      WHERE u.email = ?
      LIMIT 1
      `,
      [email]
    );

    if (!rows.length) {
      return res.json({ success: false, message: "User nahi mila" });
    }

    return res.json({ success: true, user: rows[0] });
  } catch (error) {
    console.error("User by email error:", error);
    return res.status(500).json({ success: false, message: "Fetch failed" });
  }
});

/* =========================
   404
========================= */
app.use((req, res) => {
  return res.status(404).json({
    success: false,
    message: "Route not found"
  });
});

/* =========================
   GLOBAL ERROR HANDLER
========================= */
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  return res.status(500).json({
    success: false,
    message: "Internal server error",
    error: err.message
  });
});

/* =========================
   START SERVER
========================= */
app.listen(PORT, "0.0.0.0", async () => {
  console.log(`Server running on port ${PORT}`);

  try {
    await testDbConnection();
    console.log("MySQL Connected ✅");
    await ensureSuperAdminExists();
  } catch (error) {
    console.error("MySQL connection failed:", error);
  }
});