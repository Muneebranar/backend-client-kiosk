// require("dotenv").config();
// const express = require("express");
// const helmet = require("helmet");
// const cors = require("cors");
// const morgan = require("morgan");
// const path = require("path");

// // Routes
// const kioskRoutes = require("./routes/kiosk");
// const adminRoutes = require("./routes/admin");

// const app = express();

// // 🛡️ Security & Middleware
// app.use(helmet());

// // ✅ CORS configuration
// const allowedOrigins = [
//   "https://flourishing-faun-369382.netlify.app", // ✅ Your production frontend (Netlify)
//   "http://localhost:8080",
//   process.env.CLIENT_URL    // 🔧 Additional URL from environment variable
// ].filter(Boolean);

// app.use(
//   cors({
//     origin: function (origin, callback) {
//       // Allow requests with no origin (like mobile apps or curl requests)
//       if (!origin) return callback(null, true);
      
//       if (allowedOrigins.indexOf(origin) !== -1) {
//         callback(null, true);
//       } else {
//         callback(new Error('Not allowed by CORS'));
//       }
//     },
//     methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
//     credentials: true,
//     allowedHeaders: ["Content-Type", "Authorization"],
//   })
// );

// // Handle preflight requests explicitly
// app.options("*", cors());

// app.use(express.json({ limit: "10mb" }));
// app.use(express.urlencoded({ extended: true }));
// app.use(morgan("dev"));

// // 📁 Serve static uploads
// app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// // 🔹 API Routes
// app.use("/kiosk", kioskRoutes);
// app.use("/admin", adminRoutes);

// // 🧩 Health check route
// app.get("/", (req, res) => {
//   res.json({
//     ok: true,
//     version: "1.0.0",
//     environment: process.env.NODE_ENV || "development",
//     message: "Server is running 🚀",
//   });
// });

// // ❌ 404 fallback
// app.use((req, res) => {
//   res.status(404).json({ error: "Route not found" });
// });

// // 💥 Global error handler
// app.use((err, req, res, next) => {
//   console.error("🚨 Global Error:", err);
//   res.status(500).json({
//     error: err.message || "Internal server error",
//   });
// });

// module.exports = app;

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

// ✅ CORS Configuration - Works for React Native App and Web
const isProduction = process.env.NODE_ENV === "production";

// Allowed web origins (for browser requests)
const allowedWebOrigins = [
  "https://flourishing-faun-369382.netlify.app",
  "http://localhost:8080",
  "http://localhost:3000",
  "http://localhost:8081",
  process.env.CLIENT_URL,
].filter(Boolean);

app.use(
  cors({
    origin: function (origin, callback) {
      // ✅ ALWAYS allow requests with no origin header
      // (React Native apps, mobile apps, Postman, curl)
      if (!origin) {
        return callback(null, true);
      }

      // ✅ In development, allow all origins
      if (!isProduction) {
        console.log(`🌐 CORS: Allowing origin (dev mode): ${origin}`);
        return callback(null, true);
      }

      // ✅ In production, check whitelist for web origins
      if (allowedWebOrigins.includes(origin)) {
        console.log(`✅ CORS: Allowed origin: ${origin}`);
        return callback(null, true);
      }

      // ❌ Block unknown web origins in production
      console.warn(`⚠️ CORS: Blocked origin: ${origin}`);
      callback(new Error("Not allowed by CORS"));
    },
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    credentials: true,
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
    exposedHeaders: ["Content-Length", "X-Request-Id"],
  })
);

// Handle preflight OPTIONS requests
app.options("*", cors());

// Body parser middleware
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// Logging middleware
app.use(morgan("dev"));

// 📁 Serve static uploads
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// 🔹 API Routes
app.use("/kiosk", kioskRoutes);
app.use("/admin", adminRoutes);
// Note: Campaign routes are in adminRoutes under /admin/campaigns

// 🧩 Health check route
app.get("/", (req, res) => {
  res.json({
    ok: true,
    version: "1.0.0",
    environment: process.env.NODE_ENV || "development",
    message: "Server is running 🚀",
    timestamp: new Date().toISOString(),
    cors: {
      mode: isProduction ? "production" : "development",
      allowsNoOrigin: true,
      webOrigins: isProduction ? allowedWebOrigins.length : "all",
    },
  });
});

// 🧩 API info route
app.get("/api/info", (req, res) => {
  res.json({
    ok: true,
    api: "Kiosk Loyalty System API",
    version: "1.0.0",
    endpoints: {
      kiosk: "/kiosk/*",
      admin: "/admin/*",
      campaigns: "/admin/campaigns/*",
    },
    status: "operational",
  });
});

// ❌ 404 fallback
app.use((req, res) => {
  console.warn(`⚠️ 404: ${req.method} ${req.path}`);
  res.status(404).json({
    ok: false,
    error: "Route not found",
    path: req.path,
    method: req.method,
  });
});

// 💥 Global error handler
app.use((err, req, res, next) => {
  console.error("🚨 Global Error:", err);

  // Handle CORS errors
  if (err.message === "Not allowed by CORS") {
    return res.status(403).json({
      ok: false,
      error: "CORS policy violation",
      message: "Your request origin is not whitelisted",
      origin: req.headers.origin || "none",
    });
  }

  // Handle JSON parsing errors
  if (err instanceof SyntaxError && err.status === 400 && "body" in err) {
    return res.status(400).json({
      ok: false,
      error: "Invalid JSON",
      message: "Request body contains invalid JSON",
    });
  }

  // Generic error response
  res.status(err.status || 500).json({
    ok: false,
    error: err.message || "Internal server error",
    ...(process.env.NODE_ENV === "development" && { stack: err.stack }),
  });
});

module.exports = app;