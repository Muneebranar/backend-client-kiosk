const multer = require("multer");
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const cloudinary = require("./cloudinary");

// ✅ Cloudinary storage for images
const storage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: 'uploads', // your folder name on Cloudinary
    allowed_formats: ['jpg', 'png', 'jpeg'],
  },
});

// ✅ Multer instance for images (Cloudinary)
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
});

// ✅ Separate multer instance for CSV (in-memory, not Cloudinary)
const csvStorage = multer.memoryStorage();

const uploadCSV = multer({
  storage: csvStorage,
  fileFilter: (req, file, cb) => {
    if (
      file.mimetype === "text/csv" ||
      file.mimetype === "application/vnd.ms-excel" ||
      file.originalname.toLowerCase().endsWith(".csv")
    ) {
      cb(null, true);
    } else {
      cb(new Error("Only CSV files are allowed"), false);
    }
  },
  limits: { fileSize: 5 * 1024 * 1024 },
});

// ✅ Export both (keeps old variable name `upload`)
module.exports = { upload, uploadCSV };
