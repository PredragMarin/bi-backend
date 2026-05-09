"use strict";

const express = require("express");
const path = require("path");
const createSanitizeDxfRouterV0 = require("./routes/sanitize_dxf_v0");

const app = express();
app.use(express.json({ limit: "10mb" }));

const uiDir = path.join(__dirname, "ui");
const sanitizeDxfHtmlPath = path.join(uiDir, "sanitize_dxf.html");

app.use("/ui", express.static(uiDir, { extensions: ["html"] }));
app.use("/api/sanitize-dxf/v0", createSanitizeDxfRouterV0());

app.get("/ui/sanitize-dxf", (req, res) => res.sendFile(sanitizeDxfHtmlPath));
app.get("/ui/sanitize_dxf.html", (req, res) => res.sendFile(sanitizeDxfHtmlPath));
app.get("/health", (req, res) => {
  res.json({
    ok: true,
    use_case: "sanitize_dxf_v0_standalone"
  });
});

const PORT = Number(process.env.PORT || 3010);
app.listen(PORT, () => {
  console.log(`SANITIZE DXF standalone listening on http://localhost:${PORT}`);
  console.log(`UI SANITIZE DXF: http://localhost:${PORT}/ui/sanitize-dxf`);
});
