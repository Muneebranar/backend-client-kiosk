// src/scripts/migrateAutoReplies.js
// ✅ Migration script to add auto-reply settings to existing businesses

const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') }); // Ensure .env is loaded

// Import Business model
const Business = require('../models/Business');

/**
 * Migrate all existing businesses to include auto-reply settings
 */
async function migrateAutoReplies() {
  try {
    console.log('🚀 Starting auto-reply migration...\n');

    // Check MongoDB URI
    const mongoUri = process.env.MONGO_URI;
    if (!mongoUri) {
      throw new Error(
        '❌ MONGODB_URI is not defined in your .env file. Please add it like:\nMONGODB_URI=mongodb://localhost:27017/loyalty_db'
      );
    }

    // Connect to MongoDB
    await mongoose.connect(mongoUri, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('✅ Connected to MongoDB\n');

    // Find all businesses
    const businesses = await Business.find({});
    console.log(`📊 Found ${businesses.length} businesses to migrate\n`);

    let migratedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    for (const business of businesses) {
      try {
        if (!business.autoReplies || !business.autoReplies.keywords) {
          // Initialize auto-reply settings
          business.autoReplies = {
            enabled: true,
            keywords: [],
            fallbackMessage: "Thanks for your message! We'll get back to you soon.",
            sendFallback: true,
          };

          await business.save();
          migratedCount++;
          console.log(`✅ Migrated: ${business.name} (${business.slug})`);
        } else {
          skippedCount++;
          console.log(`⏭️  Skipped: ${business.name} (already has auto-replies)`);
        }
      } catch (error) {
        errorCount++;
        console.error(`❌ Error migrating ${business.name}:`, error.message);
      }
    }

    console.log('\n📈 Migration Summary:');
    console.log(`   ✅ Migrated: ${migratedCount}`);
    console.log(`   ⏭️  Skipped: ${skippedCount}`);
    console.log(`   ❌ Errors: ${errorCount}`);
    console.log(`   📊 Total: ${businesses.length}\n`);

    console.log('🎉 Migration complete!\n');

    await mongoose.connection.close();
    console.log('👋 Disconnected from MongoDB');
    process.exit(0);
  } catch (error) {
    console.error('💥 Migration failed:', error.message);
    process.exit(1);
  }
}

// Run migration
migrateAutoReplies();
