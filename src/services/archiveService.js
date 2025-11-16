// // services/archiveService.js
// const { createClient } = require('@supabase/supabase-js');
// const ImportHistory = require('../models/ImportHistory');
// const cron = require('node-cron');

// const supabaseUrl = 'https://zbujmbijzlbkscyljnlp.supabase.co';
// const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpidWptYmlqemxia3NjeWxqbmxwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjI0MDYxNjIsImV4cCI6MjA3Nzk4MjE2Mn0.S8_rK1gtjme6cgw1AsxOZNDabmrp90wByOii50YOC8s';

// const supabase = createClient(supabaseUrl, supabaseAnonKey);

// /**
//  * Archive old import history records to Supabase Storage
//  * Keeps only last 30 days in MongoDB
//  */
// async function archiveOldImports() {
//   try {
//     console.log('🗄️ Starting archive process...');

//     // Calculate date 30 days ago
//     const thirtyDaysAgo = new Date();
//     thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

//     console.log(`📅 Archiving records older than: ${thirtyDaysAgo.toISOString()}`);

//     // Find records older than 30 days
//     const oldRecords = await ImportHistory.find({
//       createdAt: { $lt: thirtyDaysAgo }
//     })
//       .populate('businessId', 'name slug')
//       .lean();

//     if (oldRecords.length === 0) {
//       console.log('✅ No records to archive');
//       return { archived: 0, deleted: 0 };
//     }

//     console.log(`📦 Found ${oldRecords.length} records to archive`);

//     // Group records by month for better organization
//     const recordsByMonth = {};
    
//     oldRecords.forEach(record => {
//       const date = new Date(record.createdAt);
//       const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      
//       if (!recordsByMonth[monthKey]) {
//         recordsByMonth[monthKey] = [];
//       }
//       recordsByMonth[monthKey].push(record);
//     });

//     let totalArchived = 0;
//     let totalDeleted = 0;

//     // Archive each month's records
//     for (const [monthKey, records] of Object.entries(recordsByMonth)) {
//       try {
//         // Create JSON file
//         const fileName = `import-history-${monthKey}.json`;
//         const filePath = `archives/import-history/${fileName}`;
        
//         const archiveData = {
//           archivedAt: new Date().toISOString(),
//           month: monthKey,
//           recordCount: records.length,
//           records: records
//         };

//         const jsonBlob = new Blob([JSON.stringify(archiveData, null, 2)], {
//           type: 'application/json'
//         });

//         // Upload to Supabase Storage
//         console.log(`📤 Uploading ${fileName} to Supabase...`);
        
//         const { data, error } = await supabase.storage
//           .from('KioskSystem')
//           .upload(filePath, jsonBlob, {
//             cacheControl: '3600',
//             upsert: true, // Overwrite if exists
//             contentType: 'application/json'
//           });

//         if (error) {
//           console.error(`❌ Upload failed for ${fileName}:`, error);
//           continue; // Skip deletion if upload fails
//         }

//         console.log(`✅ Uploaded ${fileName} successfully`);

//         // Delete archived records from MongoDB
//         const recordIds = records.map(r => r._id);
//         const deleteResult = await ImportHistory.deleteMany({
//           _id: { $in: recordIds }
//         });

//         console.log(`🗑️ Deleted ${deleteResult.deletedCount} records for ${monthKey}`);
        
//         totalArchived += records.length;
//         totalDeleted += deleteResult.deletedCount;

//       } catch (monthError) {
//         console.error(`❌ Error archiving ${monthKey}:`, monthError);
//       }
//     }

//     console.log('✅ Archive process completed');
//     console.log(`📊 Summary: ${totalArchived} archived, ${totalDeleted} deleted`);

//     return {
//       archived: totalArchived,
//       deleted: totalDeleted,
//       months: Object.keys(recordsByMonth)
//     };

//   } catch (error) {
//     console.error('❌ Archive process failed:', error);
//     throw error;
//   }
// }

// /**
//  * Restore archived data from Supabase (optional utility function)
//  * @param {string} monthKey - Format: YYYY-MM
//  */
// async function restoreArchivedMonth(monthKey) {
//   try {
//     const filePath = `archives/import-history/import-history-${monthKey}.json`;
    
//     console.log(`📥 Restoring data from ${filePath}...`);

//     // Download from Supabase
//     const { data, error } = await supabase.storage
//       .from('KioskSystem')
//       .download(filePath);

//     if (error) {
//       throw new Error(`Failed to download: ${error.message}`);
//     }

//     // Parse JSON
//     const text = await data.text();
//     const archiveData = JSON.parse(text);

//     console.log(`📦 Found ${archiveData.recordCount} records to restore`);

//     // Restore to MongoDB
//     const restored = [];
//     for (const record of archiveData.records) {
//       // Remove _id to let MongoDB generate new ones
//       const { _id, ...recordData } = record;
      
//       const newRecord = await ImportHistory.create(recordData);
//       restored.push(newRecord);
//     }

//     console.log(`✅ Restored ${restored.length} records for ${monthKey}`);
//     return restored;

//   } catch (error) {
//     console.error('❌ Restore failed:', error);
//     throw error;
//   }
// }

// /**
//  * List all archived files in Supabase
//  */
// async function listArchivedFiles() {
//   try {
//     const { data, error } = await supabase.storage
//       .from('KioskSystem')
//       .list('archives/import-history', {
//         limit: 100,
//         sortBy: { column: 'name', order: 'desc' }
//       });

//     if (error) {
//       throw error;
//     }

//     return data.map(file => ({
//       name: file.name,
//       size: file.metadata?.size || 0,
//       createdAt: file.created_at,
//       url: `${supabaseUrl}/storage/v1/object/public/KioskSystem/archives/import-history/${file.name}`
//     }));

//   } catch (error) {
//     console.error('❌ Failed to list archives:', error);
//     throw error;
//   }
// }

// /**
//  * Schedule daily archive job
//  * Runs at 2 AM every day
//  */
// function scheduleArchiveJob() {
//   // Run at 2:00 AM every day
//   cron.schedule('0 2 * * *', async () => {
//     console.log('⏰ Running scheduled archive job...');
//     try {
//       await archiveOldImports();
//     } catch (error) {
//       console.error('❌ Scheduled archive job failed:', error);
//     }
//   });

//   console.log('✅ Archive job scheduled (runs daily at 2 AM)');
// }

// /**
//  * Manual archive trigger (for testing or manual runs)
//  */
// async function manualArchive() {
//   console.log('🔧 Manual archive triggered');
//   return await archiveOldImports();
// }

// module.exports = {
//   archiveOldImports,
//   restoreArchivedMonth,
//   listArchivedFiles,
//   scheduleArchiveJob,
//   manualArchive
// };