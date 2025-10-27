require('dotenv').config();   
const app = require('./app');
const mongoose = require('mongoose');

const PORT = process.env.PORT || 4000;
const MONGO_URI = process.env.MONGO_URI;
console.log("✅ Loaded Default Twilio Number:", process.env.DEFAULT_TWILIO_NUMBER);


mongoose.connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => {
    console.log('Connected to MongoDB' );
    app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
    require("./cron/expireRewards");
  })
  .catch(err => {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  });
