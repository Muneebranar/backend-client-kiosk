require("dotenv").config();
const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const morgan = require("morgan");
const path = require("path");

const kioskRoutes = require("./routes/kiosk");
const adminRoutes = require("./routes/admin");

const app = express();

// 🛡 Security & Middleware
app.use(helmet());

app.use(
  cors({
    origin: "https://gilded-tanuki-47e0bd.netlify.app", // ⚠ YOUR NETLIFY URL
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  })
);

// ⚠️ THE MOST IMPORTANT LINE FOR RENDER
app.options("*", cors());

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan("dev"));

app.use("/uploads", express.static(path.join(__dirname, "uploads")));

app.use("/kiosk", kioskRoutes);
app.use("/admin", adminRoutes);

app.get("/", (req, res) => {
  res.json({
    ok: true,
    version: "1.0.0",
    environment: process.env.NODE_ENV || "development",
    message: "Server is running 🚀",
  });
});

app.use((req, res) => {
  res.status(404).json({ error: "Route not found" });
});

app.use((err, req, res, next) => {
  console.error("🚨 Global Error:", err);
  res.status(500).json({
    error: err.message || "Internal server error",
  });
});

module.exports = app;
