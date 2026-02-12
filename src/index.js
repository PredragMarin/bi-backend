// src/index.js
require("./index.dev");
const express = require("express");
const app = express();
app.use(express.json({ limit: "10mb" }));

const { runUseCase } = require("./core/runtime");

app.post("/api/epr/attendance/v1/run", async (req, res) => {
  try {
    // minimalna validacija
    if (!req.body || req.body.use_case !== "epr_attendance_v1") {
      return res.status(400).json({ error: "Invalid or missing use_case" });
    }

    const result = await runUseCase(req.body);
    return res.status(200).json(result);
  } catch (e) {
    return res.status(500).json({
      error: "INTERNAL_ERROR",
      message: String(e?.message || e)
    });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`API listening on :${port}`));

