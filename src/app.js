require("dotenv").config();
const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const morgan = require("morgan");
const path = require("path");

// Routes
const kioskRoutes = require("./routes/kiosk");
const adminRoutes = require("./routes/admin");

const app = express();

// 🛡️ Security & Middleware
app.use(helmet());
app.use(
  cors({
    origin: process.env.CLIENT_URL || "*", // restrict later in production
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
    credentials: true,
  })
);
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan("dev"));

// 📁 Serve static uploads
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// 🔹 API Routes
app.use("/kiosk", kioskRoutes);
app.use("/admin", adminRoutes);

// 🧩 Health check route
app.get("/", (req, res) => {
  res.json({
    ok: true,
    version: "1.0.0",
    environment: process.env.NODE_ENV || "development",
    message: "Server is running 🚀",
  });
});

// ❌ 404 fallback
app.use((req, res) => {
  res.status(404).json({ error: "Route not found" });
});

// 💥 Global error handler
app.use((err, req, res, next) => {
  console.error("🚨 Global Error:", err);
  res.status(500).json({
    error: err.message || "Internal server error",
  });
});

module.exports = app;
