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

// ✅ SIMPLE CORS - Allow all origins in development
if (process.env.NODE_ENV === "development" || process.env.NODE_ENV === "production") {
  // For development: Allow all origins (React Native needs this)
  app.use(
    cors({
      origin: "*", // ✅ Allow all origins
      methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
      credentials: false, // Set to false when using origin: "*"
      allowedHeaders: ["Content-Type", "Authorization"],
    })
  );
} else {
  // For strict production: Use specific origins
  const allowedOrigins = [
    // "https://flourishing-faun-369382.netlify.app",
    "http://localhost:8080",
    process.env.CLIENT_URL
  ].filter(Boolean);

  app.use(
    cors({
      origin: function (origin, callback) {
        if (!origin) return callback(null, true);
        
        if (allowedOrigins.indexOf(origin) !== -1) {
          callback(null, true);
        } else {
          callback(new Error('Not allowed by CORS'));
        }
      },
      methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
      credentials: true,
      allowedHeaders: ["Content-Type", "Authorization"],
    })
  );
}

// Handle preflight requests explicitly
app.options("*", cors());

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