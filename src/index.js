require('dotenv').config();   
const app = require('./app');
const mongoose = require('mongoose');

const PORT = process.env.PORT || 4000;
const MONGO_URI = process.env.MONGO_URI;
console.log("✅ Loaded Default Twilio Number:", process.env.DEFAULT_TWILIO_NUMBER);

mongoose.connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => {
    console.log('✅ Connected to MongoDB');
    
    // ✅ Listen on all network interfaces (0.0.0.0)
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`✅ Server running on port ${PORT}`);
      console.log(`📱 Local:   http://localhost:${PORT}`);
      console.log(`🌐 Network: http://10.76.45.11:${PORT}`);
      console.log(`📡 Mobile can access via: http://10.76.45.11:${PORT}`);
    });
    
    require("./cron/expireRewards");
  })
  .catch(err => {
    console.error('❌ MongoDB connection error:', err);
    process.exit(1);
  });