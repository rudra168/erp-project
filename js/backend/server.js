const express = require("express");
const cors = require("cors");
const mysql = require("mysql2/promise");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 5000;

const allowedOrigins = [
  "http://localhost:5000",
  "http://127.0.0.1:5000",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "https://erp-project-eight.vercel.app"
];

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error("CORS not allowed for this origin"));
  }
}));

app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "..")));

// =========================
// DATABASE POOL
// =========================
const dbConfig = process.env.DATABASE_URL
  ? { uri: process.env.DATABASE_URL }
  : {
      host: process.env.MYSQLHOST,
      user: process.env.MYSQLUSER,
      password: process.env.MYSQLPASSWORD,
      database: process.env.MYSQLDATABASE,
      port: Number(process.env.MYSQLPORT || 3306),
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0
    };
const db = mysql.createPool(dbConfig);
const pool = dbConfig.uri
  ? mysql.createPool(dbConfig.uri)
  : mysql.createPool(dbConfig);

function format3(value) {
  const n = Number(value || 0);
  return isNaN(n) ? "0.000" : n.toFixed(3);
}

/* =========================
   TEST
========================= */
app.get("/api/test", (req, res) => {
  res.json({ success: true, message: "Server working" });
});

/* =========================
   DASHBOARD
========================= */
app.get("/api/dashboard", async (req, res) => {
  try {
    const [stockSummary] = await pool.query(`
      SELECT 
        COUNT(*) AS total_items,
        COALESCE(SUM(weight), 0) AS total_weight
      FROM stock
    `);

    const [soldSummary] = await pool.query(`
      SELECT COUNT(*) AS sold_items
      FROM stock
      WHERE status = 'SOLD'
    `);

    const [inStockSummary] = await pool.query(`
      SELECT COUNT(*) AS in_stock_items
      FROM stock
      WHERE status = 'IN_STOCK'
    `);

    const [salesSummary] = await pool.query(`
      SELECT 
        COUNT(*) AS total_sales,
        COALESCE(SUM(total_amount), 0) AS total_sales_amount
      FROM sales_history
    `);

    const [recentInvoices] = await pool.query(`
      SELECT invoice_number, customer_name, total_amount, created_at
      FROM sales_history
      ORDER BY id DESC
      LIMIT 5
    `);

    res.json({
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
    res.status(500).json({ success: false, message: "Dashboard fetch failed" });
  }
});

/* =========================
   GET ALL STOCK
========================= */
app.get("/getStock", async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT *
      FROM stock
      ORDER BY
        CAST(COALESCE(lot_number, '0') AS UNSIGNED) ASC,
        CAST(COALESCE(serial, '0') AS UNSIGNED) ASC,
        id ASC
    `);

    res.json(rows);
  } catch (error) {
    console.error("Get stock error:", error);
    res.status(500).json({ success: false, message: "Stock fetch failed" });
  }
});

/* =========================
   GET ITEM BY BARCODE
========================= */
app.get("/getSticker/:barcode", async (req, res) => {
  try {
    const barcode = String(req.params.barcode || "").trim();

    const [rows] = await pool.query(
      `SELECT * FROM stock WHERE barcode = ? LIMIT 1`,
      [barcode]
    );

    if (!rows.length) {
      return res.status(404).json({
        success: false,
        message: "Item not found"
      });
    }

    res.json({
      success: true,
      item: rows[0]
    });
  } catch (error) {
    console.error("Get sticker error:", error);
    res.status(500).json({ success: false, message: "Fetch failed" });
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
      barcode
    } = req.body;

    if (!serial || !productName || !purity || !sku || !size || !weight || !lot || !barcode) {
      return res.json({
        success: false,
        message: "Serial, Product, Purity, SKU, Size, Weight, Lot aur Barcode required hai"
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
        AND UPPER(COALESCE(status, 'IN_STOCK')) = 'IN_STOCK'
      LIMIT 1
      `,
      [cleanLot, cleanSerial]
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
        AND UPPER(COALESCE(status, 'IN_STOCK')) = 'IN_STOCK'
      LIMIT 1
      `,
      [cleanBarcode]
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
        status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        "IN_STOCK"
      ]
    );

    res.json({
      success: true,
      message: "Sticker added successfully"
    });
  } catch (err) {
    console.error("Add sticker error:", err);
    res.status(500).json({ success: false, message: "Add sticker failed" });
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
      status = "IN_STOCK"
    } = req.body;

    if (!oldBarcode) {
      return res.json({ success: false, message: "Old barcode missing hai" });
    }

    if (!serial || !productName || !purity || !sku || !size || !weight || !lot) {
      return res.json({
        success: false,
        message: "Serial, Product, Purity, SKU, Size, Weight aur Lot required hai"
      });
    }

    const cleanLot = String(lot).trim();
    const cleanSerial = String(serial).trim();
    const newBarcode = String(barcode || oldBarcode).trim();

    const [currentRows] = await pool.query(
      `SELECT id FROM stock WHERE barcode = ? LIMIT 1`,
      [oldBarcode]
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
        AND id <> ?
        AND UPPER(COALESCE(status, 'IN_STOCK')) = 'IN_STOCK'
      LIMIT 1
      `,
      [cleanLot, cleanSerial, currentId]
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
        AND id <> ?
        AND UPPER(COALESCE(status, 'IN_STOCK')) = 'IN_STOCK'
      LIMIT 1
      `,
      [newBarcode, currentId]
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

    res.json({
      success: true,
      message: "Sticker updated successfully"
    });
  } catch (error) {
    console.error("Update sticker error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

/* =========================
   DELETE STICKER
========================= */
app.delete("/deleteSticker/:barcode", async (req, res) => {
  try {
    const barcode = String(req.params.barcode || "").trim();

    await pool.query(`DELETE FROM stock WHERE barcode = ?`, [barcode]);

    res.json({
      success: true,
      message: "Sticker deleted successfully"
    });
  } catch (error) {
    console.error("Delete sticker error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

/* =========================
   RESTORE STICKER
========================= */
app.put("/restoreSticker/:barcode", async (req, res) => {
  try {
    const barcode = String(req.params.barcode || "").trim();

    await pool.query(
      `UPDATE stock SET status = 'IN_STOCK' WHERE barcode = ?`,
      [barcode]
    );

    res.json({ success: true, message: "Sticker restored" });
  } catch (err) {
    console.error("Restore error:", err);
    res.status(500).json({ success: false, message: "Restore failed" });
  }
});

/* =========================
   SAVE INVOICE
========================= */
app.post("/saveInvoice", async (req, res) => {
  const connection = await pool.getConnection();

  try {
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
      items = []
    } = req.body;

    if (!invoiceNumber || !items.length) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        message: "Invoice data incomplete hai"
      });
    }

    const [saleInsert] = await connection.query(
      `
      INSERT INTO sales_history
      (
        invoice_number, customer_name, mobile, gst_number, invoice_date,
        payment_mode, payment_status, paid_amount, due_amount,
        rate_per_gram, mc_rate, round_off, subtotal, total_amount, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
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
        Number(grandTotal || 0)
      ]
    );

    const saleId = saleInsert.insertId;

    for (const item of items) {
      const barcode = String(item.barcode || "").trim();

      await connection.query(
        `
        INSERT INTO sales_items
        (
          sale_id, invoice_number, barcode, product_name, sku, purity, size, weight, lot_number, customer_name, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
        `,
        [
          saleId,
          invoiceNumber,
          barcode,
          item.productName || "",
          item.sku || "",
          item.purity || "",
          item.size || "",
          Number(item.weight || 0),
          item.lot || "",
          customerName
        ]
      );

      await connection.query(
        `UPDATE stock SET status = 'SOLD' WHERE barcode = ?`,
        [barcode]
      );
    }

    await connection.commit();

    res.json({
      success: true,
      message: "Invoice saved successfully"
    });
  } catch (error) {
    await connection.rollback();
    console.error("Save invoice error:", error);
    res.status(500).json({ success: false, message: "Invoice save failed" });
  } finally {
    connection.release();
  }
});

/* =========================
   SALES HISTORY
========================= */
app.get("/getSalesHistory", async (req, res) => {
  try {
    const [sales] = await pool.query(`
      SELECT 
        sh.*,
        (SELECT COUNT(*) FROM sales_items si WHERE si.sale_id = sh.id) AS total_items
      FROM sales_history sh
      ORDER BY sh.id DESC
    `);

    res.json({
      success: true,
      sales
    });
  } catch (error) {
    console.error("Sales history error:", error);
    res.status(500).json({ success: false, message: "Sales history fetch failed" });
  }
});

/* =========================
   INVOICE ITEMS
========================= */
app.get("/getInvoiceItems/:invoiceNumber", async (req, res) => {
  try {
    const invoiceNumber = String(req.params.invoiceNumber || "").trim();

    const [items] = await pool.query(
      `
      SELECT *
      FROM sales_items
      WHERE invoice_number = ?
      ORDER BY id DESC
      `,
      [invoiceNumber]
    );

    res.json({
      success: true,
      items
    });
  } catch (error) {
    console.error("Invoice items error:", error);
    res.status(500).json({ success: false, message: "Invoice items fetch failed" });
  }
});

/* =========================
   RETURN ITEM
========================= */
app.put("/returnItem/:barcode", async (req, res) => {
  try {
    const barcode = String(req.params.barcode || "").trim();

    await pool.query(
      `UPDATE stock SET status = 'IN_STOCK' WHERE barcode = ?`,
      [barcode]
    );

    res.json({
      success: true,
      message: "Item returned successfully"
    });
  } catch (error) {
    console.error("Return item error:", error);
    res.status(500).json({ success: false, message: "Return failed" });
  }
});

/* =========================
   DEFAULT
========================= */
app.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const [rows] = await db.query(
      "SELECT * FROM users WHERE email = ? AND password = ?",
      [email, password]
    );

    if (!rows.length) {
      return res.json({ success: false, message: "Invalid login" });
    }

    const user = rows[0];

    if (user.status !== "approved") {
      return res.json({ success: false, message: "Pending approval" });
    }

    res.json({ success: true, user });

  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
});
app.get("/", (req, res) => {
  res.json({ success: true, message: "ERP backend running" });
});

app.listen(PORT, async () => {
  try {
    const conn = await pool.getConnection();
    console.log("MySQL Connected");
    conn.release();
  } catch (error) {
    console.error("MySQL connection failed:", error.message);
  }

  console.log(`Server running on port ${PORT}`);
});
