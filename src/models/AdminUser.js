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

// 🔐 Hash password before saving
UserSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 10);
  next();
});

// ✅ Compare password method
UserSchema.methods.comparePassword = function (password) {
  return bcrypt.compare(password, this.password);
};

module.exports = mongoose.model('AdminUser', UserSchema);
