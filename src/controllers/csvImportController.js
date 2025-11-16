const csv = require('csv-parser');
const { Readable } = require('stream');
const Business = require('../models/Business');
const Customer = require('../models/Customer');
const ImportHistory = require('../models/ImportHistory');
const CheckinLog = require('../models/CheckinLog');
const PointsLedger = require('../models/PointsLedger');
const importQueue = require('../services/importQueue');
const twilioService = require('../services/twilioService');
const dayjs = require('dayjs');
const customParseFormat = require('dayjs/plugin/customParseFormat');

dayjs.extend(customParseFormat);

const MAX_ROWS = 20000;
const BATCH_SIZE = 100;
const ASYNC_THRESHOLD = 1000;
const DEFAULT_POINTS = 3;  // ✅ Default points for CSV imports
const DEFAULT_CHECKINS = 3; // ✅ Default checkins for CSV imports

// ⚡ OPTIMIZED SMS SETTINGS
const WELCOME_BATCH_SIZE = 50;
const WELCOME_DELAY = 500;

/**
 * ✅ Parse date from CSV with multiple format support
 */
function parseDate(dateString) {
  if (!dateString || dateString.trim() === '') {
    return null;
  }

  const formats = [
    'YYYY-MM-DD',
    'MM/DD/YYYY',
    'DD/MM/YYYY',
    'YYYY/MM/DD',
    'MM-DD-YYYY',
    'DD-MM-YYYY',
    'M/D/YYYY',
    'D/M/YYYY',
    'YYYY-MM-DD HH:mm:ss',
    'MM/DD/YYYY HH:mm:ss'
  ];

  for (const format of formats) {
    const parsed = dayjs(dateString, format, true);
    if (parsed.isValid()) {
      return parsed.toDate();
    }
  }

  // Try ISO format as fallback
  const isoDate = dayjs(dateString);
  if (isoDate.isValid()) {
    return isoDate.toDate();
  }

  console.warn('⚠️ Could not parse date:', dateString);
  return null;
}

/**
 * ✅ ROBUST CSV SUBSCRIBER STATUS HANDLER
 */
function getSubscriberStatusFromCSV(row) {
  // Check for "Subscribed" column first (as per requirement)
  const subscribedColumns = [
    'Subscribed', 'subscribed', 'SUBSCRIBED',
    'Subscribe', 'subscribe', 'SUBSCRIBE'
  ];

  for (const col of subscribedColumns) {
    if (row[col] !== undefined) {
      const value = String(row[col]).trim().toLowerCase();
      if (value === 'yes' || value === 'y' || value === 'true' || value === '1') {
        return 'active';
      } else if (value === 'no' || value === 'n' || value === 'false' || value === '0') {
        return 'unsubscribed';
      }
    }
  }

  // Fallback: Check status columns
  const statusColumns = [
    'status', 'Status', 'STATUS',
    'subscriberStatus', 'SubscriberStatus', 'subscriber_status',
    'subscriptionStatus', 'SubscriptionStatus', 'subscription_status'
  ];

  for (const col of statusColumns) {
    if (row[col]) {
      const normalizedStatus = String(row[col]).trim().toLowerCase();
      
      const unsubscribedKeywords = [
        'unsubscribed', 'unsub', 'unsubscribe', 'inactive', 'disabled',
        'opted-out', 'opted_out', 'optedout', 'opt-out', 'opt_out', 'optout',
        'cancelled', 'canceled', 'stopped', 'no'
      ];

      const isUnsubscribed = unsubscribedKeywords.some(keyword => 
        normalizedStatus.includes(keyword)
      );

      return isUnsubscribed ? 'unsubscribed' : 'active';
    }
  }

  return 'active';
}

/**
 * ✅ Check if phone number is US-based
 */
function isUSPhoneNumber(phone) {
  return phone.startsWith('+1');
}

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
      sendWelcome: req.body.sendWelcome
    });

    if (!req.file || !req.file.buffer) {
      return res.status(400).json({
        ok: false,
        error: 'No CSV file uploaded'
      });
    }

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

    const business = await Business.findById(businessId);
    if (!business) {
      return res.status(404).json({
        ok: false,
        error: 'Business not found'
      });
    }

    console.log('✅ Importing to business:', business.name);

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
        welcomesSent: 0,
        welcomesFailed: 0,
        errors: []
      }
    };

    if (req.user.id && /^[0-9a-fA-F]{24}$/.test(req.user.id)) {
      importData.userId = req.user.id;
    } else {
      importData.importedBy = {
        id: req.user.id,
        name: req.user.name,
        email: req.user.email
      };
    }

    importRecord = await ImportHistory.create(importData);
    console.log('✅ Import record created:', importRecord._id);

    const rows = [];
    const bufferStream = Readable.from(req.file.buffer);
    
    await new Promise((resolve, reject) => {
      bufferStream
        .pipe(csv())
        .on('data', (row) => {
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

    importRecord.results.totalRows = totalRows;
    await importRecord.save();

    const sendWelcome = req.body.sendWelcome !== 'false';

    if (totalRows > ASYNC_THRESHOLD) {
      console.log(`🔄 Large file detected (${totalRows} rows) - queuing background job`);
      
      await importQueue.add({
        importId: importRecord._id.toString(),
        businessId: businessId,
        rows: rows,
        sendWelcome: sendWelcome
      }, {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000
        }
      });

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
      console.log(`⚡ Small file (${totalRows} rows) - processing immediately`);
      
      importRecord.status = 'processing';
      await importRecord.save();

      const results = await processImportRows(rows, businessId, importRecord, sendWelcome);

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
 * ⚡ OPTIMIZED: Process import rows - FIXED CheckinLog
 */
async function processImportRows(rows, businessId, importRecord, sendWelcome = true) {
  const results = {
    totalRows: rows.length,
    created: 0,
    updated: 0,
    skipped: 0,
    welcomesSent: 0,
    welcomesFailed: 0,
    errors: []
  };

  const business = await Business.findById(businessId);
  if (!business) {
    throw new Error('Business not found');
  }

  const newCustomersForWelcome = [];
  const processedPhones = new Set();

  // Process rows in batches
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, Math.min(i + BATCH_SIZE, rows.length));
    
    await Promise.all(batch.map(async (row, batchIdx) => {
      const rowNumber = i + batchIdx + 2;

      try {
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

        const originalPhone = phone;
        phone = phone.trim();

        // Phone validation and normalization
        if (phone.startsWith('+')) {
          phone = phone.replace(/[\s\-\(\)]/g, '');
          
          if (!/^\+\d{10,15}$/.test(phone)) {
            results.skipped++;
            results.errors.push({
              row: rowNumber,
              phone: originalPhone,
              reason: `Invalid international format`
            });
            return;
          }
        } else {
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
              reason: `Invalid US format`
            });
            return;
          }
        }

        // ✅ REQUIREMENT #3: Ignore duplicate rows within same CSV
        if (processedPhones.has(phone)) {
          console.log(`⏭️ Skipping duplicate phone in CSV: ${phone}`);
          results.skipped++;
          return;
        }
        processedPhones.add(phone);

        // Determine country code
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

        // ✅ Parse data from CSV
        const name = row.name || row.Name || '';
        const email = row.email || row.Email || '';
        const notes = row.notes || row.Notes || '';
        
        // ✅ Get status from "Subscribed" column
        const csvSubscriberStatus = getSubscriberStatusFromCSV(row);
        const isUnsubscribedInCSV = csvSubscriberStatus === 'unsubscribed';

        // ✅ Parse dates from CSV
        const lastCheckInDate = parseDate(row['Last Check-In'] || row['lastCheckIn'] || row['last_check_in']);
        const signUpDate = parseDate(row['Sign Up Date'] || row['signUpDate'] || row['sign_up_date']);

        const isUSNumber = isUSPhoneNumber(phone);

        const existingCustomer = await Customer.findOne({
          phone: phone,
          businessId: businessId,
          deleted: { $ne: true }
        });

        if (existingCustomer) {
          // ✅ REQUIREMENT #2: Update existing customer
          
          // Increment points, currentCheckIns, and totalCheckIns by 3
          existingCustomer.points += DEFAULT_POINTS;
          existingCustomer.currentCheckIns = (existingCustomer.currentCheckIns || 0) + DEFAULT_CHECKINS;
          existingCustomer.totalCheckins = (existingCustomer.totalCheckins || 0) + DEFAULT_CHECKINS;

          // Update lastCheckinAt with date from CSV
          if (lastCheckInDate) {
            existingCustomer.lastCheckinAt = lastCheckInDate;
          }

          // Update status based on CSV "Subscribed" column
          existingCustomer.subscriberStatus = csvSubscriberStatus;
          
          if (!existingCustomer.metadata) {
            existingCustomer.metadata = {};
          }
          
          if (name && name.trim()) {
            existingCustomer.metadata.name = name.trim();
          }
          if (email && email.trim()) {
            existingCustomer.metadata.email = email.trim();
          }
          if (notes && notes.trim()) {
            existingCustomer.metadata.notes = notes.trim();
          }

          await existingCustomer.save();

          // ✅ FIXED: Create checkin log with correct fields
          await CheckinLog.create({
            businessId,
            customerId: existingCustomer._id,
            phone: existingCustomer.phone, // ✅ Required field
            countryCode: existingCustomer.countryCode || countryCode,
            status: 'api', // ✅ Valid enum value: 'manual', 'kiosk', or 'api'
            pointsAwarded: DEFAULT_POINTS,
            metadata: {
              source: 'csv_import_update',
              importId: importRecord._id.toString()
            },
            createdAt: lastCheckInDate || new Date()
          });

          // Create points ledger
          await PointsLedger.create({
            customerId: existingCustomer._id,
            businessId,
            type: 'earned',
            amount: DEFAULT_POINTS,
            balance: existingCustomer.points,
            description: 'Points added from CSV import',
            createdAt: lastCheckInDate || new Date(),
            metadata: {
              source: 'csv_import_update',
              importId: importRecord._id.toString()
            }
          });

          results.updated++;
          console.log(`✅ Updated ${phone}: +${DEFAULT_POINTS} points (Total: ${existingCustomer.points}), Status: ${csvSubscriberStatus}`);

        } else {
          // ✅ REQUIREMENT #1: NEW CUSTOMER - Set defaults
          const newCustomer = await Customer.create({
            phone: phone,
            countryCode: countryCode,
            businessId: businessId,
            points: DEFAULT_POINTS,
            currentCheckIns: DEFAULT_CHECKINS,
            totalCheckins: DEFAULT_CHECKINS,
            subscriberStatus: csvSubscriberStatus,
            consentGiven: true,
            ageVerified: true,
            firstCheckinAt: signUpDate || new Date(),
            lastCheckinAt: lastCheckInDate || new Date(),
            metadata: {
              name: name || undefined,
              email: email || undefined,
              notes: notes || undefined,
              welcomeSent: false,
              importedViaCSV: true,
              isInternational: !isUSNumber
            }
          });

          // ✅ FIXED: Create checkin log with correct fields
          await CheckinLog.create({
            businessId,
            customerId: newCustomer._id,
            phone: newCustomer.phone, // ✅ Required field
            countryCode: newCustomer.countryCode,
            status: 'api', // ✅ Valid enum value
            pointsAwarded: DEFAULT_POINTS,
            metadata: {
              source: 'csv_import',
              importId: importRecord._id.toString()
            },
            createdAt: lastCheckInDate || new Date()
          });

          // Create points ledger
          await PointsLedger.create({
            customerId: newCustomer._id,
            businessId,
            type: 'earned',
            amount: DEFAULT_POINTS,
            balance: DEFAULT_POINTS,
            description: 'Initial points from CSV import',
            createdAt: lastCheckInDate || new Date(),
            metadata: {
              source: 'csv_import',
              importId: importRecord._id.toString()
            }
          });

          results.created++;
          console.log(`✅ Created ${phone} with ${DEFAULT_POINTS} points and ${DEFAULT_CHECKINS} checkins (Status: ${csvSubscriberStatus})`);

          if (sendWelcome && !isUnsubscribedInCSV && isUSNumber) {
            newCustomersForWelcome.push(newCustomer);
          }
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

    if (importRecord) {
      const progress = Math.min(100, Math.round(((i + BATCH_SIZE) / rows.length) * 100));
      importRecord.progress = progress;
      importRecord.results = results;
      await importRecord.save();
      
      console.log(`📊 Progress: ${progress}% (${i + BATCH_SIZE}/${rows.length} rows)`);
    }
  }

  // ⚡ Send welcome messages
  if (sendWelcome && newCustomersForWelcome.length > 0) {
    console.log(`📨 Sending welcome messages to ${newCustomersForWelcome.length} new US customers`);
    
    const welcomeMessage = business.messages?.welcome || 
      `Welcome to ${business.name}! 🎉 You've been added to our loyalty program with ${DEFAULT_POINTS} points. Reply STOP to unsubscribe.`;

    const successfulCustomerIds = [];
    const startTime = Date.now();

    for (let i = 0; i < newCustomersForWelcome.length; i += WELCOME_BATCH_SIZE) {
      const welcomeBatch = newCustomersForWelcome.slice(i, i + WELCOME_BATCH_SIZE);
      
      const batchResults = await Promise.allSettled(
        welcomeBatch.map(async (customer) => {
          try {
            await twilioService.sendSMS({
              to: customer.phone,
              body: welcomeMessage,
              businessId: businessId
            });

            successfulCustomerIds.push(customer._id);
            results.welcomesSent++;
            
            return { success: true, phone: customer.phone };
          } catch (smsErr) {
            console.error(`❌ Failed to send welcome to ${customer.phone}:`, smsErr.message);
            results.welcomesFailed++;
            return { success: false, phone: customer.phone };
          }
        })
      );

      const batchSuccess = batchResults.filter(r => r.status === 'fulfilled' && r.value?.success).length;
      console.log(`📊 SMS Batch ${Math.floor(i/WELCOME_BATCH_SIZE) + 1}: ${batchSuccess}/${welcomeBatch.length} sent`);

      if (i + WELCOME_BATCH_SIZE < newCustomersForWelcome.length) {
        await new Promise(resolve => setTimeout(resolve, WELCOME_DELAY));
      }
    }

    // ✅ BULK UPDATE
    if (successfulCustomerIds.length > 0) {
      try {
        const updateResult = await Customer.updateMany(
          { _id: { $in: successfulCustomerIds } },
          { 
            $set: { 
              'metadata.welcomeSent': true,
              'metadata.welcomeSentAt': new Date()
            }
          }
        );
        console.log(`✅ Bulk updated ${updateResult.modifiedCount} customers`);
      } catch (updateErr) {
        console.error('❌ Failed to bulk update customers:', updateErr.message);
      }
    }

    const elapsedTime = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`📨 Welcome messages complete: ${results.welcomesSent} sent, ${results.welcomesFailed} failed in ${elapsedTime}s`);
  }

  return results;
}

exports.getImportHistory = async (req, res) => {
  try {
    const userRole = req.user.role;
    const userBusinessId = req.user.businessId;
    const { businessId, limit = 50 } = req.query;

    let query = {};
    
    if (userRole === 'admin') {
      if (!userBusinessId) {
        return res.status(403).json({
          ok: false,
          error: 'No business assigned to your account',
          history: []
        });
      }
      query.businessId = userBusinessId;
    } else if (userRole === 'master' || userRole === 'superadmin') {
      if (businessId) {
        query.businessId = businessId;
      }
    } else {
      if (userBusinessId) {
        query.businessId = userBusinessId;
      }
    }

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

    const transformedHistory = imports.map(record => {
      if (!record.results) {
        record.results = {
          totalRows: 0,
          created: 0,
          updated: 0,
          skipped: 0,
          welcomesSent: 0,
          welcomesFailed: 0,
          errors: []
        };
      }
      
      if (!record.results.errors) {
        record.results.errors = [];
      }

      record.results.totalRows = record.results.totalRows || 0;
      record.results.created = record.results.created || 0;
      record.results.updated = record.results.updated || 0;
      record.results.skipped = record.results.skipped || 0;
      record.results.welcomesSent = record.results.welcomesSent || 0;
      record.results.welcomesFailed = record.results.welcomesFailed || 0;

      if (typeof record.progress !== 'number') {
        record.progress = record.status === 'completed' ? 100 : 0;
      }

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

      if (!record.businessId) {
        record.businessId = {
          _id: 'unknown',
          name: 'Unknown Business'
        };
      }

      record.totalRecords = record.results.totalRows;
      record.successCount = record.results.created + record.results.updated;
      record.failureCount = record.results.errors.length;

      return record;
    });

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

    if (!importRecord.userId && importRecord.importedBy) {
      importRecord.userId = importRecord.importedBy;
    }

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

exports.processImportRows = processImportRows;

module.exports = exports;