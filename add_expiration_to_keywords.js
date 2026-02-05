// scripts/add_expiration_to_keywords.js
// Migration script to add expiration fields to existing keywords
// Run this ONCE after deploying the new Business model

const mongoose = require('mongoose');
require('dotenv').config();

// Connect to MongoDB
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('✅ MongoDB Connected');
  } catch (err) {
    console.error('❌ MongoDB connection error:', err);
    process.exit(1);
  }
};

// Migration function
const migrateKeywords = async () => {
  try {
    console.log('🚀 Starting migration: Adding expiration fields to keywords...\n');

    // Get the Business collection directly
    const db = mongoose.connection.db;
    const businessesCollection = db.collection('businesses');

    // Find all businesses that have keywords
    const businesses = await businessesCollection.find({
      'autoReplies.keywords': { $exists: true, $ne: [] }
    }).toArray();

    console.log(`📊 Found ${businesses.length} businesses with keywords\n`);

    let totalUpdated = 0;
    let totalKeywords = 0;

    // Update each business
    for (const business of businesses) {
      const businessId = business._id;
      const businessName = business.name;
      const keywords = business.autoReplies?.keywords || [];

      console.log(`\n🏢 Processing: ${businessName} (${keywords.length} keywords)`);

      // Update each keyword in the business
      const updatedKeywords = keywords.map(keyword => {
        // Only add fields if they don't exist
        if (!keyword.hasOwnProperty('hasExpiration')) {
          keyword.hasExpiration = false;
        }
        if (!keyword.hasOwnProperty('expirationDays')) {
          keyword.expirationDays = 0;
        }
        return keyword;
      });

      // Update the business document
      const result = await businessesCollection.updateOne(
        { _id: businessId },
        { $set: { 'autoReplies.keywords': updatedKeywords } }
      );

      if (result.modifiedCount > 0) {
        totalUpdated++;
        totalKeywords += keywords.length;
        console.log(`   ✅ Updated ${keywords.length} keywords`);
      } else {
        console.log(`   ℹ️  No changes needed (fields already exist)`);
      }
    }

    console.log('\n' + '='.repeat(60));
    console.log('📈 Migration Summary:');
    console.log('='.repeat(60));
    console.log(`✅ Businesses updated: ${totalUpdated}`);
    console.log(`✅ Total keywords migrated: ${totalKeywords}`);
    console.log('='.repeat(60));
    console.log('\n✨ Migration completed successfully!\n');

  } catch (err) {
    console.error('\n❌ Migration error:', err);
    throw err;
  }
};

// Rollback function (if needed)
const rollbackMigration = async () => {
  try {
    console.log('⏪ Rolling back migration: Removing expiration fields...\n');

    const db = mongoose.connection.db;
    const businessesCollection = db.collection('businesses');

    const result = await businessesCollection.updateMany(
      { 'autoReplies.keywords': { $exists: true } },
      { 
        $unset: { 
          'autoReplies.keywords.$[].hasExpiration': '',
          'autoReplies.keywords.$[].expirationDays': ''
        }
      }
    );

    console.log(`✅ Rollback complete. Modified ${result.modifiedCount} businesses\n`);

  } catch (err) {
    console.error('❌ Rollback error:', err);
    throw err;
  }
};

// Verification function
const verifyMigration = async () => {
  try {
    console.log('🔍 Verifying migration...\n');

    const db = mongoose.connection.db;
    const businessesCollection = db.collection('businesses');

    // Check businesses with keywords
    const businesses = await businessesCollection.find({
      'autoReplies.keywords': { $exists: true, $ne: [] }
    }).toArray();

    let allKeywordsHaveFields = true;
    let totalChecked = 0;

    for (const business of businesses) {
      const keywords = business.autoReplies?.keywords || [];
      
      for (const keyword of keywords) {
        totalChecked++;
        
        if (!keyword.hasOwnProperty('hasExpiration') || 
            !keyword.hasOwnProperty('expirationDays')) {
          console.log(`❌ Missing fields in keyword: ${keyword.keyword} (Business: ${business.name})`);
          allKeywordsHaveFields = false;
        }
      }
    }

    console.log('='.repeat(60));
    if (allKeywordsHaveFields) {
      console.log(`✅ Verification PASSED: All ${totalChecked} keywords have required fields`);
    } else {
      console.log(`❌ Verification FAILED: Some keywords missing fields`);
    }
    console.log('='.repeat(60) + '\n');

    return allKeywordsHaveFields;

  } catch (err) {
    console.error('❌ Verification error:', err);
    throw err;
  }
};

// Main execution
const main = async () => {
  try {
    await connectDB();

    // Check command line arguments
    const args = process.argv.slice(2);
    const command = args[0];

    switch (command) {
      case 'migrate':
        await migrateKeywords();
        await verifyMigration();
        break;

      case 'rollback':
        const confirmed = args[1] === '--confirm';
        if (!confirmed) {
          console.log('⚠️  Rollback requires confirmation. Run with: npm run migrate:rollback -- --confirm');
          process.exit(0);
        }
        await rollbackMigration();
        break;

      case 'verify':
        await verifyMigration();
        break;

      default:
        console.log('Usage:');
        console.log('  node scripts/add_expiration_to_keywords.js migrate   - Run migration');
        console.log('  node scripts/add_expiration_to_keywords.js verify    - Verify migration');
        console.log('  node scripts/add_expiration_to_keywords.js rollback --confirm  - Rollback migration');
        process.exit(0);
    }

    process.exit(0);

  } catch (err) {
    console.error('\n💥 Fatal error:', err);
    process.exit(1);
  }
};

// Run the script
main();