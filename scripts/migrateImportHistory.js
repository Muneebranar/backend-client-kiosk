// // scripts/migrateImportHistory.js
// // Run this script ONCE after updating the ImportHistory model
// // Usage: node scripts/migrateImportHistory.js

// require('dotenv').config();
// const mongoose = require('mongoose');

// const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/';

// async function migrate() {
//   try {
//     console.log('🔄 Connecting to MongoDB...');
//     await mongoose.connect(MONGO_URI);
//     console.log('✅ Connected to MongoDB');

//     const db = mongoose.connection.db;
//     const collection = db.collection('importhistories');

//     // Get all documents
//     const docs = await collection.find({}).toArray();
//     console.log(`📊 Found ${docs.length} import history records`);

//     let updated = 0;
//     let failed = 0;

//     for (const doc of docs) {
//       try {
//         const updates = {};

//         // Migrate fileName field if missing
//         if (!doc.fileName && doc.filename) {
//           updates.fileName = doc.filename;
//         }

//         // Migrate field names to match new schema
//         if (doc.results && !doc.totalRecords) {
//           updates.totalRecords = doc.results.totalRows || 0;
//           updates.successCount = doc.results.created || 0;
//           updates.failureCount = doc.results.skipped || 0;
          
//           // Keep results for backward compatibility
//           if (!updates.results) {
//             updates.results = doc.results;
//           }
//         }

//         // Ensure errors array exists
//         if (!doc.errors) {
//           updates.errors = doc.results?.errors || [];
//         }

//         // Update if there are changes
//         if (Object.keys(updates).length > 0) {
//           await collection.updateOne(
//             { _id: doc._id },
//             { $set: updates }
//           );
//           updated++;
//           console.log(`✅ Updated record ${doc._id}`);
//         }

//       } catch (error) {
//         failed++;
//         console.error(`❌ Failed to update ${doc._id}:`, error.message);
//       }
//     }

//     console.log('\n📈 Migration Summary:');
//     console.log(`   Total records: ${docs.length}`);
//     console.log(`   ✅ Updated: ${updated}`);
//     console.log(`   ⚠️  Failed: ${failed}`);
//     console.log(`   ℹ️  No changes: ${docs.length - updated - failed}`);

//   } catch (error) {
//     console.error('❌ Migration failed:', error);
//     process.exit(1);
//   } finally {
//     await mongoose.connection.close();
//     console.log('\n🔌 Disconnected from MongoDB');
//     process.exit(0);
//   }
// }

// migrate();