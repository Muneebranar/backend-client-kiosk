const mongoose = require('mongoose');
const Schema = mongoose.Schema;
const bcrypt = require('bcrypt');

const UserSchema = new Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },

  // ⚡ Role for access control
  role: { type: String, enum: ['master', 'admin', 'staff'], required: true },

  // ⚡ Which business this user belongs to (null for master)
  businessId: { type: Schema.Types.ObjectId, ref: 'Business' },

  createdAt: { type: Date, default: Date.now }
});

// // 🔐 Hash password before saving
// UserSchema.pre('save', async function (next) {
//   if (!this.isModified('password')) return next();
//   this.password = await bcrypt.hash(this.password, 10);
//   next();
// });

// // ✅ Compare password method
// UserSchema.methods.comparePassword = function (password) {
//   return bcrypt.compare(password, this.password);
// };

// module.exports = mongoose.model('AdminUser', UserSchema);

// models/AdminUser.js

const adminUserSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: {
      type: String,
      required: true,
      minlength: 6,
    },
    role: {
      type: String,
      enum: ["master", "admin", "staff"],
      default: "master",
    },
    businessId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Business",
      // Required for admin and staff, null for master
      required: function () {
        return this.role !== "master";
      },
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    lastLogin: {
      type: Date,
    },
    permissions: {
      canManageCustomers: { type: Boolean, default: true },
      canManageRewards: { type: Boolean, default: false },
      canManageSettings: { type: Boolean, default: false },
      canImportCSV: { type: Boolean, default: false },
      canManageUsers: { type: Boolean, default: false },
    },
  },
  {
    timestamps: true,
  }
);

// Hash password before saving
// Hash password before saving (only if not already hashed)
adminUserSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();

  // 🛡️ Prevent double hashing (check if password already looks like bcrypt hash)
  if (!this.password.startsWith("$2b$")) {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
  }

  next();
});


// Compare password method
adminUserSchema.methods.comparePassword = async function (candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// Set default permissions based on role
adminUserSchema.pre("save", function (next) {
  if (this.role === "master") {
    this.permissions = {
      canManageCustomers: true,
      canManageRewards: true,
      canManageSettings: true,
      canImportCSV: true,
      canManageUsers: true,
    };
  } else if (this.role === "admin") {
    this.permissions = {
      canManageCustomers: true,
      canManageRewards: true,
      canManageSettings: true,
      canImportCSV: true,
      canManageUsers: false,
    };
  } else if (this.role === "staff") {
    this.permissions = {
      canManageCustomers: true,
      canManageRewards: false,
      canManageSettings: false,
      canImportCSV: false,
      canManageUsers: false,
    };
  }
  next();
});

// ✅ Compare password method
UserSchema.methods.comparePassword = function (password) {
  return bcrypt.compare(password, this.password);
};

module.exports = mongoose.model('AdminUser', UserSchema);
