const express = require("express");
const app = express();
const PORT = process.env.PORT || 8080;

app.get("/", (req, res) => {
  res.json({ ok: true, message: "root working" });
});

app.get("/api/test", (req, res) => {
  res.json({ ok: true, message: "api working" });
});

app.get("/health", (req, res) => {
  res.json({ ok: true, message: "health working" });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log("Server running on port", PORT);
});