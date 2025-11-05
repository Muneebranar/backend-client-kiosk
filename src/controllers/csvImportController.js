// const csv = require('csv-parser');
// const { Readable } = require('stream');
// const Business = require('../models/Business');
// const Customer = require('../models/Customer');
// const ImportHistory = require('../models/ImportHistory');

// const MAX_ROWS = 20000;
// const BATCH_SIZE = 100;

// /**
//  * Import customers from CSV file
//  * POST /admin/customers/import
//  */
// exports.importCustomersCSV = async (req, res) => {
//   let importRecord = null;

//   try {
//     console.log('📦 CSV Import Request:', {
//       file: req.file?.originalname,
//       businessId: req.body.businessId,
//       userRole: req.user?.role,
//       userId: req.user?.id,
//       userBusinessId: req.user?.businessId,
//       hasBuffer: !!req.file?.buffer,
//       bufferSize: req.file?.buffer?.length
//     });

//     // ✅ Validate file
//     if (!req.file || !req.file.buffer) {
//       return res.status(400).json({
//         ok: false,
//         error: 'No CSV file uploaded'
//       });
//     }

//     // ✅ Determine businessId
//     let businessId = req.body.businessId;

//     if (req.user.role !== 'master' && req.user.role !== 'superadmin') {
//       businessId = req.user.businessId;
//       console.log('🏢 Using admin\'s business:', businessId);
//     }

//     if (!businessId) {
//       return res.status(400).json({
//         ok: false,
//         error: 'Business ID is required'
//       });
//     }

//     // ✅ Verify business exists
//     const business = await Business.findById(businessId);
//     if (!business) {
//       return res.status(404).json({
//         ok: false,
//         error: 'Business not found'
//       });
//     }

//     console.log('✅ Importing to business:', business.name);

//     // ✅ Create import history record
//     // FIX: Handle userId properly - store as string if not ObjectId
//     const importData = {
//       businessId: businessId,
//       filename: req.file.originalname,
//       status: 'processing',
//       startedAt: new Date(),
//       results: {
//         totalRows: 0,
//         created: 0,
//         updated: 0,
//         skipped: 0,
//         errors: []
//       }
//     };

//     // Only add userId if it's a valid ObjectId format
//     if (req.user.id && /^[0-9a-fA-F]{24}$/.test(req.user.id)) {
//       importData.userId = req.user.id;
//     } else {
//       // Store as metadata for non-ObjectId users
//       importData.importedBy = {
//         id: req.user.id,
//         name: req.user.name,
//         email: req.user.email
//       };
//     }

//     importRecord = await ImportHistory.create(importData);

//     // ✅ Parse CSV from buffer
//     const results = {
//       totalRows: 0,
//       created: 0,
//       updated: 0,
//       skipped: 0,
//       errors: []
//     };

//     const rows = [];
    
//     // Convert buffer to readable stream
//     const bufferStream = Readable.from(req.file.buffer);
    
//     // Read CSV from buffer stream
//     await new Promise((resolve, reject) => {
//       bufferStream
//         .pipe(csv())
//         .on('data', (row) => {
//           results.totalRows++;
          
//           // ✅ Enforce row limit
//           if (results.totalRows > MAX_ROWS) {
//             return reject(new Error(`CSV exceeds maximum of ${MAX_ROWS} rows`));
//           }
          
//           rows.push(row);
//         })
//         .on('end', resolve)
//         .on('error', reject);
//     });

//     console.log(`📊 CSV parsed: ${results.totalRows} rows`);

//     // Update import record
//     importRecord.results.totalRows = results.totalRows;
//     await importRecord.save();

//     // ✅ Process rows in batches
//     for (let i = 0; i < rows.length; i += BATCH_SIZE) {
//       const batch = rows.slice(i, Math.min(i + BATCH_SIZE, rows.length));
      
//       // Process batch in parallel
//       await Promise.all(batch.map(async (row, batchIdx) => {
//         const rowNumber = i + batchIdx + 2; // +2 for header and 0-index

//         try {
//           // Extract phone number
//           let phone = row.phone || row.Phone || row.PHONE || row.phoneNumber;
          
//           if (!phone) {
//             results.skipped++;
//             results.errors.push({
//               row: rowNumber,
//               phone: 'N/A',
//               reason: 'Missing phone number'
//             });
//             return;
//           }

//           // Clean and normalize phone number
//           const originalPhone = phone;
//           phone = phone.trim();

//           // If phone already has +, keep it as is (international format)
//           if (phone.startsWith('+')) {
//             phone = phone.replace(/[\s\-\(\)]/g, '');
            
//             if (!/^\+\d{10,15}$/.test(phone)) {
//               results.skipped++;
//               results.errors.push({
//                 row: rowNumber,
//                 phone: originalPhone,
//                 reason: `Invalid international format (must be +[country code][number])`
//               });
//               return;
//             }
//           } else {
//             // No +, assume US number
//             phone = phone.replace(/\D/g, '');
            
//             if (phone.length === 10) {
//               phone = '+1' + phone;
//             } else if (phone.length === 11 && phone.startsWith('1')) {
//               phone = '+' + phone;
//             } else {
//               results.skipped++;
//               results.errors.push({
//                 row: rowNumber,
//                 phone: originalPhone,
//                 reason: `Invalid US format (must be 10 digits or +1 followed by 10 digits)`
//               });
//               return;
//             }
//           }

//           // Extract country code
//           let countryCode = '+1';
//           if (phone.startsWith('+92')) {
//             countryCode = '+92';
//           } else if (phone.startsWith('+44')) {
//             countryCode = '+44';
//           } else if (phone.startsWith('+1')) {
//             countryCode = '+1';
//           } else {
//             const match = phone.match(/^\+(\d{1,4})/);
//             if (match) {
//               countryCode = '+' + match[1];
//             }
//           }

//           // Extract optional fields
//           const points = parseInt(row.points || row.Points || 0) || 0;
//           const name = row.name || row.Name || '';
//           const email = row.email || row.Email || '';
//           const notes = row.notes || row.Notes || '';

//           // Check if customer exists
//           const existingCustomer = await Customer.findOne({
//             phone: phone,
//             businessId: businessId,
//             deleted: { $ne: true }
//           });

//           if (existingCustomer) {
//             // ✅ Merge logic: Update without duplicates
//             let updated = false;

//             // Only update points if new value is higher
//             if (points > 0 && points > existingCustomer.points) {
//               existingCustomer.points = points;
//               updated = true;
//             }
            
//             if (!existingCustomer.metadata) {
//               existingCustomer.metadata = {};
//             }
            
//             if (name && name.trim()) {
//               existingCustomer.metadata.name = name.trim();
//               updated = true;
//             }
//             if (email && email.trim()) {
//               existingCustomer.metadata.email = email.trim();
//               updated = true;
//             }
//             if (notes && notes.trim()) {
//               existingCustomer.metadata.notes = notes.trim();
//               updated = true;
//             }

//             if (updated) {
//               await existingCustomer.save();
//               results.updated++;
//             } else {
//               results.skipped++;
//             }

//           } else {
//             // Create new customer
//             await Customer.create({
//               phone: phone,
//               countryCode: countryCode,
//               businessId: businessId,
//               points: points,
//               totalCheckins: points > 0 ? points : 0,
//               subscriberStatus: 'active', // ✅ Default to active
//               consentGiven: true,
//               ageVerified: true,
//               firstCheckinAt: new Date(),
//               lastCheckinAt: new Date(),
//               metadata: {
//                 name: name || undefined,
//                 email: email || undefined,
//                 notes: notes || undefined
//               }
//             });

//             results.created++;
//           }

//         } catch (err) {
//           console.error(`❌ Error processing row ${rowNumber}:`, err.message);
//           results.skipped++;
//           results.errors.push({
//             row: rowNumber,
//             phone: row.phone || row.Phone || 'N/A',
//             reason: err.message
//           });
//         }
//       }));

//       // Update progress
//       const progress = Math.min(100, Math.round(((i + BATCH_SIZE) / rows.length) * 100));
//       importRecord.progress = progress;
//       importRecord.results = results;
//       await importRecord.save();
      
//       console.log(`📊 Progress: ${progress}% (${i + BATCH_SIZE}/${rows.length} rows)`);
//     }

//     // ✅ Mark import as completed
//     importRecord.status = 'completed';
//     importRecord.progress = 100;
//     importRecord.results = results;
//     importRecord.completedAt = new Date();
//     await importRecord.save();

//     console.log('✅ CSV Import completed:', results);

//     res.json({
//       ok: true,
//       success: true,
//       message: 'CSV import completed',
//       importId: importRecord._id,
//       results
//     });

//   } catch (err) {
//     console.error('❌ CSV Import Error:', err);

//     // Update import record to failed
//     if (importRecord) {
//       importRecord.status = 'failed';
//       importRecord.completedAt = new Date();
//       if (!importRecord.results.errors) {
//         importRecord.results.errors = [];
//       }
//       importRecord.results.errors.push({
//         row: 0,
//         phone: 'N/A',
//         reason: err.message
//       });
//       await importRecord.save();
//     }

//     res.status(500).json({
//       ok: false,
//       error: err.message
//     });
//   }
// };

// /**
//  * Get import history
//  * GET /admin/customers/import-history
//  */
// exports.getImportHistory = async (req, res) => {
//   try {
//     const userRole = req.user.role;
//     const userBusinessId = req.user.businessId;
//     const { businessId, limit = 50 } = req.query;

//     console.log('📋 Get Import History Request:', {
//       userRole,
//       userBusinessId,
//       requestedBusinessId: businessId
//     });

//     let query = {};
    
//     // Business admin can only see their own imports
//     if (userRole === 'admin') {
//       if (!userBusinessId) {
//         return res.status(403).json({
//           ok: false,
//           error: 'No business assigned to your account',
//           history: []
//         });
//       }
//       query.businessId = userBusinessId;
//       console.log('🏢 Admin restricted to business:', userBusinessId);
//     } else if (userRole === 'master' || userRole === 'superadmin') {
//       // Master admin can filter by specific business or see all
//       if (businessId) {
//         query.businessId = businessId;
//         console.log('🔍 Filtering by business:', businessId);
//       } else {
//         console.log('👑 Master admin - showing all businesses');
//       }
//     } else {
//       // Staff or other roles - restrict to their business
//       if (userBusinessId) {
//         query.businessId = userBusinessId;
//       }
//     }

//     console.log('🔍 Final query:', query);

//     const imports = await ImportHistory.find(query)
//       .populate('businessId', 'name slug')
//       .populate({
//         path: 'userId',
//         select: 'name email',
//         options: { strictPopulate: false }
//       })
//       .sort({ createdAt: -1 })
//       .limit(parseInt(limit))
//       .lean();

//     console.log('📊 Found', imports.length, 'import records');

//     // Transform and normalize the data
//     const transformedHistory = imports.map(record => {
//       // Ensure results object has all required fields
//       if (!record.results) {
//         record.results = {
//           totalRows: 0,
//           created: 0,
//           updated: 0,
//           skipped: 0,
//           errors: []
//         };
//       }
      
//       // Ensure errors array exists
//       if (!record.results.errors) {
//         record.results.errors = [];
//       }

//       // Ensure progress exists
//       if (typeof record.progress !== 'number') {
//         record.progress = 0;
//       }

//       // Handle userId population fallback
//       if (!record.userId && record.importedBy) {
//         // Use importedBy metadata for non-ObjectId users
//         record.userId = record.importedBy;
//       } else if (!record.userId) {
//         // Provide default if both are missing
//         record.userId = {
//           name: 'Unknown User',
//           email: ''
//         };
//       }

//       // Ensure businessId is populated
//       if (!record.businessId) {
//         record.businessId = {
//           _id: 'unknown',
//           name: 'Unknown Business'
//         };
//       }

//       return record;
//     });

//     console.log('✅ Sending', transformedHistory.length, 'records to frontend');

//     // Return as 'history' to match frontend expectations
//     res.json({
//       ok: true,
//       history: transformedHistory,
//       total: transformedHistory.length
//     });

//   } catch (error) {
//     console.error('❌ Get Import History Error:', error);
//     res.status(500).json({
//       ok: false,
//       error: 'Failed to fetch import history',
//       message: error.message,
//       history: [] // Always return empty array on error
//     });
//   }
// };

// /**
//  * Get import status
//  * GET /admin/customers/import/:id
//  */
// exports.getImportStatus = async (req, res) => {
//   try {
//     const { id } = req.params;

//     const importRecord = await ImportHistory.findById(id)
//       .populate('businessId', 'name')
//       .populate({
//         path: 'userId',
//         select: 'name email',
//         options: { strictPopulate: false }
//       })
//       .lean();

//     if (!importRecord) {
//       return res.status(404).json({
//         ok: false,
//         error: 'Import not found'
//       });
//     }

//     // Handle missing userId population
//     if (!importRecord.userId && importRecord.importedBy) {
//       importRecord.userId = importRecord.importedBy;
//     }

//     // Check access
//     if (req.user.role !== 'master' && req.user.role !== 'superadmin') {
//       if (importRecord.businessId._id.toString() !== req.user.businessId.toString()) {
//         return res.status(403).json({
//           ok: false,
//           error: 'Access denied'
//         });
//       }
//     }

//     res.json({
//       ok: true,
//       import: importRecord
//     });
//   } catch (err) {
//     console.error('❌ Get Import Status Error:', err);
//     res.status(500).json({
//       ok: false,
//       error: err.message
//     });
//   }
// };
const csv = require('csv-parser');
const { Readable } = require('stream');
const Business = require('../models/Business');
const Customer = require('../models/Customer');
const ImportHistory = require('../models/ImportHistory');
const importQueue = require('../services/importQueue'); // ✅ Import the queue

const MAX_ROWS = 20000;
const BATCH_SIZE = 100;
const ASYNC_THRESHOLD = 1000; // Use background job for files > 1000 rows

/**
 * Import customers from CSV file
 * POST /admin/customers/import
 */
exports.importCustomersCSV = async (req, res) => {
  let importRecord = null;

  try {
    console.log('📦 CSV Import Request:', {
      file: req.file?.originalname,
      businessId: req.body.businessId,
      userRole: req.user?.role,
      userId: req.user?.id,
      userBusinessId: req.user?.businessId,
      hasBuffer: !!req.file?.buffer,
      bufferSize: req.file?.buffer?.length
    });

    // ✅ Validate file
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({
        ok: false,
        error: 'No CSV file uploaded'
      });
    }

    // ✅ Determine businessId
    let businessId = req.body.businessId;

    if (req.user.role !== 'master' && req.user.role !== 'superadmin') {
      businessId = req.user.businessId;
      console.log('🏢 Using admin\'s business:', businessId);
    }

    if (!businessId) {
      return res.status(400).json({
        ok: false,
        error: 'Business ID is required'
      });
    }

    // ✅ Verify business exists
    const business = await Business.findById(businessId);
    if (!business) {
      return res.status(404).json({
        ok: false,
        error: 'Business not found'
      });
    }

    console.log('✅ Importing to business:', business.name);

    // ✅ Create import history record
    const importData = {
      businessId: businessId,
      filename: req.file.originalname,
      status: 'queued',
      startedAt: new Date(),
      results: {
        totalRows: 0,
        created: 0,
        updated: 0,
        skipped: 0,
        errors: []
      }
    };

    // Handle userId properly
    if (req.user.id && /^[0-9a-fA-F]{24}$/.test(req.user.id)) {
      importData.userId = req.user.id;
      console.log('✅ Using ObjectId userId:', req.user.id);
    } else {
      importData.importedBy = {
        id: req.user.id,
        name: req.user.name,
        email: req.user.email
      };
      console.log('✅ Using importedBy metadata:', req.user.id);
    }

    importRecord = await ImportHistory.create(importData);
    console.log('✅ Import record created:', importRecord._id);

    // ✅ Parse CSV from buffer
    const rows = [];
    const bufferStream = Readable.from(req.file.buffer);
    
    await new Promise((resolve, reject) => {
      bufferStream
        .pipe(csv())
        .on('data', (row) => {
          // ✅ Enforce row limit
          if (rows.length >= MAX_ROWS) {
            return reject(new Error(`CSV exceeds maximum of ${MAX_ROWS} rows`));
          }
          rows.push(row);
        })
        .on('end', resolve)
        .on('error', reject);
    });

    const totalRows = rows.length;
    console.log(`📊 CSV parsed: ${totalRows} rows`);

    // Update import record with total rows
    importRecord.results.totalRows = totalRows;
    await importRecord.save();

    // ✅ DECISION: Sync or Async processing?
    if (totalRows > ASYNC_THRESHOLD) {
      // 🔄 Large file - Use background job (async)
      console.log(`🔄 Large file detected (${totalRows} rows) - queuing background job`);
      
      await importQueue.add({
        importId: importRecord._id.toString(),
        businessId: businessId,
        rows: rows
      }, {
        attempts: 3, // Retry up to 3 times if failed
        backoff: {
          type: 'exponential',
          delay: 2000
        }
      });

      // Return immediately - processing in background
      return res.json({
        ok: true,
        success: true,
        message: 'CSV import queued for processing',
        importId: importRecord._id,
        async: true,
        totalRows: totalRows,
        status: 'queued'
      });

    } else {
      // ⚡ Small file - Process immediately (sync)
      console.log(`⚡ Small file (${totalRows} rows) - processing immediately`);
      
      importRecord.status = 'processing';
      await importRecord.save();

      const results = await processImportRows(rows, businessId, importRecord);

      // Mark as completed
      importRecord.status = 'completed';
      importRecord.progress = 100;
      importRecord.results = results;
      importRecord.completedAt = new Date();
      await importRecord.save();

      console.log('✅ CSV Import completed:', results);

      return res.json({
        ok: true,
        success: true,
        message: 'CSV import completed',
        importId: importRecord._id,
        async: false,
        results
      });
    }

  } catch (err) {
    console.error('❌ CSV Import Error:', err);

    // Update import record to failed
    if (importRecord) {
      importRecord.status = 'failed';
      importRecord.completedAt = new Date();
      if (!importRecord.results.errors) {
        importRecord.results.errors = [];
      }
      importRecord.results.errors.push({
        row: 0,
        phone: 'N/A',
        reason: err.message
      });
      await importRecord.save();
    }

    res.status(500).json({
      ok: false,
      error: err.message
    });
  }
};

/**
 * Process import rows (shared by both sync and async processing)
 */
async function processImportRows(rows, businessId, importRecord) {
  const results = {
    totalRows: rows.length,
    created: 0,
    updated: 0,
    skipped: 0,
    errors: []
  };

  // Process rows in batches
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, Math.min(i + BATCH_SIZE, rows.length));
    
    // Process batch in parallel
    await Promise.all(batch.map(async (row, batchIdx) => {
      const rowNumber = i + batchIdx + 2; // +2 for header and 0-index

      try {
        // Extract phone number
        let phone = row.phone || row.Phone || row.PHONE || row.phoneNumber;
        
        if (!phone) {
          results.skipped++;
          results.errors.push({
            row: rowNumber,
            phone: 'N/A',
            reason: 'Missing phone number'
          });
          return;
        }

        // Clean and normalize phone number
        const originalPhone = phone;
        phone = phone.trim();

        // If phone already has +, keep it as is (international format)
        if (phone.startsWith('+')) {
          phone = phone.replace(/[\s\-\(\)]/g, '');
          
          if (!/^\+\d{10,15}$/.test(phone)) {
            results.skipped++;
            results.errors.push({
              row: rowNumber,
              phone: originalPhone,
              reason: `Invalid international format (must be +[country code][number])`
            });
            return;
          }
        } else {
          // No +, assume US number
          phone = phone.replace(/\D/g, '');
          
          if (phone.length === 10) {
            phone = '+1' + phone;
          } else if (phone.length === 11 && phone.startsWith('1')) {
            phone = '+' + phone;
          } else {
            results.skipped++;
            results.errors.push({
              row: rowNumber,
              phone: originalPhone,
              reason: `Invalid US format (must be 10 digits or +1 followed by 10 digits)`
            });
            return;
          }
        }

        // Extract country code
        let countryCode = '+1';
        if (phone.startsWith('+92')) {
          countryCode = '+92';
        } else if (phone.startsWith('+44')) {
          countryCode = '+44';
        } else if (phone.startsWith('+1')) {
          countryCode = '+1';
        } else {
          const match = phone.match(/^\+(\d{1,4})/);
          if (match) {
            countryCode = '+' + match[1];
          }
        }

        // Extract optional fields
        const points = parseInt(row.points || row.Points || 0) || 0;
        const name = row.name || row.Name || '';
        const email = row.email || row.Email || '';
        const notes = row.notes || row.Notes || '';

        // Check if customer exists
        const existingCustomer = await Customer.findOne({
          phone: phone,
          businessId: businessId,
          deleted: { $ne: true }
        });

        if (existingCustomer) {
          // ✅ Merge logic: Update without duplicates
          let updated = false;

          // Only update points if new value is higher
          if (points > 0 && points > existingCustomer.points) {
            existingCustomer.points = points;
            updated = true;
          }
          
          if (!existingCustomer.metadata) {
            existingCustomer.metadata = {};
          }
          
          if (name && name.trim()) {
            existingCustomer.metadata.name = name.trim();
            updated = true;
          }
          if (email && email.trim()) {
            existingCustomer.metadata.email = email.trim();
            updated = true;
          }
          if (notes && notes.trim()) {
            existingCustomer.metadata.notes = notes.trim();
            updated = true;
          }

          if (updated) {
            await existingCustomer.save();
            results.updated++;
          } else {
            results.skipped++;
          }

        } else {
          // Create new customer
          await Customer.create({
            phone: phone,
            countryCode: countryCode,
            businessId: businessId,
            points: points,
            totalCheckins: points > 0 ? points : 0,
            subscriberStatus: 'active',
            consentGiven: true,
            ageVerified: true,
            firstCheckinAt: new Date(),
            lastCheckinAt: new Date(),
            metadata: {
              name: name || undefined,
              email: email || undefined,
              notes: notes || undefined
            }
          });

          results.created++;
        }

      } catch (err) {
        console.error(`❌ Error processing row ${rowNumber}:`, err.message);
        results.skipped++;
        results.errors.push({
          row: rowNumber,
          phone: row.phone || row.Phone || 'N/A',
          reason: err.message
        });
      }
    }));

    // Update progress (only if importRecord is provided)
    if (importRecord) {
      const progress = Math.min(100, Math.round(((i + BATCH_SIZE) / rows.length) * 100));
      importRecord.progress = progress;
      importRecord.results = results;
      await importRecord.save();
      
      console.log(`📊 Progress: ${progress}% (${i + BATCH_SIZE}/${rows.length} rows)`);
    }
  }

  return results;
}

/**
 * Get import history
 * GET /admin/customers/import-history
 */
exports.getImportHistory = async (req, res) => {
  try {
    const userRole = req.user.role;
    const userBusinessId = req.user.businessId;
    const { businessId, limit = 50 } = req.query;

    console.log('📋 Getting import history for:', { 
      userRole, 
      userBusinessId, 
      requestedBusinessId: businessId 
    });

    let query = {};
    
    // Business admin can only see their own imports
    if (userRole === 'admin') {
      if (!userBusinessId) {
        return res.status(403).json({
          ok: false,
          error: 'No business assigned to your account',
          history: []
        });
      }
      query.businessId = userBusinessId;
      console.log('🏢 Admin restricted to business:', userBusinessId);
    } else if (userRole === 'master' || userRole === 'superadmin') {
      // Master admin can filter by specific business or see all
      if (businessId) {
        query.businessId = businessId;
        console.log('🔍 Filtering by business:', businessId);
      } else {
        console.log('👑 Master admin - showing all businesses');
      }
    } else {
      // Staff or other roles - restrict to their business
      if (userBusinessId) {
        query.businessId = userBusinessId;
      }
    }

    console.log('🔍 Query:', query);

    const imports = await ImportHistory.find(query)
      .populate('businessId', 'name slug')
      .populate({
        path: 'userId',
        select: 'name email',
        options: { strictPopulate: false }
      })
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .lean();

    console.log('📊 Found', imports.length, 'import records');

    // Transform and normalize the data
    const transformedHistory = imports.map(record => {
      // Ensure results object exists with all required fields
      if (!record.results) {
        record.results = {
          totalRows: 0,
          created: 0,
          updated: 0,
          skipped: 0,
          errors: []
        };
      }
      
      // Ensure errors array exists
      if (!record.results.errors) {
        record.results.errors = [];
      }

      // Ensure all numeric fields have values
      record.results.totalRows = record.results.totalRows || 0;
      record.results.created = record.results.created || 0;
      record.results.updated = record.results.updated || 0;
      record.results.skipped = record.results.skipped || 0;

      // Ensure progress exists
      if (typeof record.progress !== 'number') {
        record.progress = record.status === 'completed' ? 100 : 0;
      }

      // Handle userId population fallback
      if (!record.userId && record.importedBy) {
        record.userId = {
          name: record.importedBy.name || 'Unknown',
          email: record.importedBy.email || ''
        };
      } else if (!record.userId) {
        record.userId = {
          name: 'Unknown User',
          email: ''
        };
      }

      // Ensure businessId is populated
      if (!record.businessId) {
        record.businessId = {
          _id: 'unknown',
          name: 'Unknown Business'
        };
      }

      // Add computed fields for backward compatibility
      record.totalRecords = record.results.totalRows;
      record.successCount = record.results.created + record.results.updated;
      record.failureCount = record.results.errors.length;

      return record;
    });

    console.log('✅ Sending', transformedHistory.length, 'normalized records');

    res.json({
      ok: true,
      history: transformedHistory,
      total: transformedHistory.length
    });

  } catch (error) {
    console.error('❌ Get Import History Error:', error);
    res.status(500).json({
      ok: false,
      error: 'Failed to fetch import history',
      message: error.message,
      history: []
    });
  }
};

/**
 * Get import status
 * GET /admin/customers/import/:id
 */
exports.getImportStatus = async (req, res) => {
  try {
    const { id } = req.params;

    const importRecord = await ImportHistory.findById(id)
      .populate('businessId', 'name')
      .populate({
        path: 'userId',
        select: 'name email',
        options: { strictPopulate: false }
      })
      .lean();

    if (!importRecord) {
      return res.status(404).json({
        ok: false,
        error: 'Import not found'
      });
    }

    // Handle missing userId population
    if (!importRecord.userId && importRecord.importedBy) {
      importRecord.userId = importRecord.importedBy;
    }

    // Check access
    if (req.user.role !== 'master' && req.user.role !== 'superadmin') {
      if (importRecord.businessId._id.toString() !== req.user.businessId.toString()) {
        return res.status(403).json({
          ok: false,
          error: 'Access denied'
        });
      }
    }

    res.json({
      ok: true,
      import: importRecord
    });
  } catch (err) {
    console.error('❌ Get Import Status Error:', err);
    res.status(500).json({
      ok: false,
      error: err.message
    });
  }
};

// Export the processing function for use by importQueue
exports.processImportRows = processImportRows;