const csv = require('csv-parser');
const { Readable } = require('stream');
const Business = require('../models/Business');
const Customer = require('../models/Customer');
const ImportHistory = require('../models/ImportHistory');
const CheckinLog = require('../models/CheckinLog');
const importQueue = require('../services/importQueue');
const twilioService = require('../services/twilioService');
const dayjs = require('dayjs');
const customParseFormat = require('dayjs/plugin/customParseFormat');

dayjs.extend(customParseFormat);

const MAX_ROWS = 20000;
const BATCH_SIZE = 100;
const ASYNC_THRESHOLD = 1000;
const DEFAULT_CHECKINS = 3; // ✅ Each CSV row = 3 check-in

const WELCOME_BATCH_SIZE = 50;
const WELCOME_DELAY = 500;

/**
 * ✅ Detect if CSV has headers by checking first row
 */
function hasHeaders(firstRow) {
  if (!firstRow) return false;
  
  const keys = Object.keys(firstRow);
  
  if (keys.every(k => /^\d+$/.test(k))) {
    return false;
  }
  
  const headerKeywords = [
    'phone', 'name', 'email', 'status', 'subscribed', 
    'checkin', 'signup', 'date', 'notes', 'customer'
  ];
  
  const hasHeaderKeywords = keys.some(key => 
    headerKeywords.some(keyword => 
      key.toLowerCase().includes(keyword)
    )
  );
  
  if (hasHeaderKeywords) return true;
  
  const firstValue = firstRow[keys[0]];
  if (!firstValue) return false;
  
  const phonePattern = /^[\+\d\(\)\s\-]{10,}$/;
  if (phonePattern.test(String(firstValue).trim())) {
    return false;
  }
  
  return true;
}

function extractPhoneFromHeaderlessRow(row) {
  const keys = Object.keys(row);
  
  const firstKey = keys[0];
  if (firstKey && row[firstKey]) {
    const value = String(row[firstKey]).trim();
    if (looksLikePhone(value)) {
      return value;
    }
  }
  
  for (const key of keys) {
    const value = String(row[key] || '').trim();
    if (looksLikePhone(value)) {
      return value;
    }
  }
  
  return null;
}

function looksLikePhone(str) {
  if (!str) return false;
  const cleaned = str.replace(/[\s\-\(\)]/g, '');
  return /^[\+]?\d{10,15}$/.test(cleaned);
}

function extractNameFromHeaderlessRow(row) {
  const keys = Object.keys(row);
  
  if (keys[1] && row[keys[1]]) {
    const value = String(row[keys[1]]).trim();
    
    if (!looksLikePhone(value) && 
        !value.includes('@') && 
        !looksLikeDate(value) &&
        value.length > 0) {
      return value;
    }
  }
  
  return '';
}

function extractEmailFromHeaderlessRow(row) {
  const keys = Object.keys(row);
  
  for (const key of keys) {
    const value = String(row[key] || '').trim();
    if (value.includes('@') && value.includes('.')) {
      return value;
    }
  }
  
  return '';
}

function looksLikeDate(str) {
  if (!str) return false;
  
  const datePatterns = [
    /^\d{4}[-\/]\d{1,2}[-\/]\d{1,2}/,
    /^\d{1,2}[-\/]\d{1,2}[-\/]\d{4}/,
    /^\d{1,2}[-\/]\d{1,2}[-\/]\d{2}$/
  ];
  
  return datePatterns.some(pattern => pattern.test(str));
}

function parseDate(dateString) {
  if (!dateString || dateString.trim() === '') {
    return null;
  }

  const formats = [
    'YYYY-MM-DD', 'MM/DD/YYYY', 'DD/MM/YYYY', 'YYYY/MM/DD',
    'MM-DD-YYYY', 'DD-MM-YYYY', 'M/D/YYYY', 'D/M/YYYY',
    'YYYY-MM-DD HH:mm:ss', 'MM/DD/YYYY HH:mm:ss'
  ];

  for (const format of formats) {
    const parsed = dayjs(dateString, format, true);
    if (parsed.isValid()) {
      return parsed.toDate();
    }
  }

  const isoDate = dayjs(dateString);
  if (isoDate.isValid()) {
    return isoDate.toDate();
  }

  return null;
}

function getSubscriberStatusFromCSV(row, isHeaderless = false) {
  if (isHeaderless) {
    const keys = Object.keys(row);
    for (const key of keys) {
      const value = String(row[key] || '').trim().toLowerCase();
      if (value === 'yes' || value === 'y' || value === 'true' || value === '1') {
        return 'active';
      } else if (value === 'no' || value === 'n' || value === 'false' || value === '0') {
        return 'unsubscribed';
      } else if (value === 'unsubscribed' || value === 'inactive') {
        return 'unsubscribed';
      }
    }
    return 'active';
  }

  const subscribedColumns = ['Subscribed', 'subscribed', 'SUBSCRIBED', 'Subscribe', 'subscribe', 'SUBSCRIBE'];

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

  const statusColumns = ['status', 'Status', 'STATUS', 'subscriberStatus', 'SubscriberStatus', 'subscriber_status'];

  for (const col of statusColumns) {
    if (row[col]) {
      const normalizedStatus = String(row[col]).trim().toLowerCase();
      const unsubscribedKeywords = [
        'unsubscribed', 'unsub', 'unsubscribe', 'inactive', 'disabled',
        'opted-out', 'opted_out', 'optedout', 'opt-out', 'opt_out', 'optout',
        'cancelled', 'canceled', 'stopped', 'no'
      ];
      const isUnsubscribed = unsubscribedKeywords.some(keyword => normalizedStatus.includes(keyword));
      return isUnsubscribed ? 'unsubscribed' : 'active';
    }
  }

  return 'active';
}

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
      return res.status(400).json({ ok: false, error: 'No CSV file uploaded' });
    }

    let businessId = req.body.businessId;

    if (req.user.role !== 'master' && req.user.role !== 'superadmin') {
      businessId = req.user.businessId;
    }

    if (!businessId) {
      return res.status(400).json({ ok: false, error: 'Business ID is required' });
    }

    const business = await Business.findById(businessId);
    if (!business) {
      return res.status(404).json({ ok: false, error: 'Business not found' });
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
      importData.importedBy = { id: req.user.id, name: req.user.name, email: req.user.email };
    }

    importRecord = await ImportHistory.create(importData);

    const rows = [];
    const bufferStream = Readable.from(req.file.buffer);
    
    await new Promise((resolve, reject) => {
      bufferStream
        .pipe(csv({ headers: false }))
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
    const csvHasHeaders = totalRows > 0 ? hasHeaders(rows[0]) : false;
    console.log(`🔍 CSV: ${totalRows} rows, Headers: ${csvHasHeaders ? 'YES' : 'NO'}`);

    let dataRows = rows;
    if (!csvHasHeaders && totalRows > 0) {
      const firstRow = rows[0];
      const firstValue = firstRow[Object.keys(firstRow)[0]];
      if (firstValue && !looksLikePhone(String(firstValue).trim())) {
        dataRows = rows.slice(1);
      }
    }

    importRecord.results.totalRows = dataRows.length;
    await importRecord.save();

    const sendWelcome = req.body.sendWelcome !== 'false';

    if (dataRows.length > ASYNC_THRESHOLD) {
      await importQueue.add({
        importId: importRecord._id.toString(),
        businessId: businessId,
        rows: dataRows,
        sendWelcome: sendWelcome,
        hasHeaders: csvHasHeaders
      }, { attempts: 3, backoff: { type: 'exponential', delay: 2000 } });

      return res.json({
        ok: true, success: true, message: 'CSV import queued for processing',
        importId: importRecord._id, async: true, totalRows: dataRows.length,
        hasHeaders: csvHasHeaders, status: 'queued'
      });
    } else {
      importRecord.status = 'processing';
      await importRecord.save();

      const results = await processImportRows(dataRows, businessId, importRecord, sendWelcome, csvHasHeaders);

      importRecord.status = 'completed';
      importRecord.progress = 100;
      importRecord.results = results;
      importRecord.completedAt = new Date();
      await importRecord.save();

      return res.json({
        ok: true, success: true, message: 'CSV import completed',
        importId: importRecord._id, async: false, hasHeaders: csvHasHeaders, results
      });
    }

  } catch (err) {
    console.error('❌ CSV Import Error:', err);
    if (importRecord) {
      importRecord.status = 'failed';
      importRecord.completedAt = new Date();
      importRecord.results.errors.push({ row: 0, phone: 'N/A', reason: err.message });
      await importRecord.save();
    }
    res.status(500).json({ ok: false, error: err.message });
  }
};

/**
 * ⚡ Process import rows - CHECKINS ONLY (No Points)
 */
async function processImportRows(rows, businessId, importRecord, sendWelcome = true, csvHasHeaders = true) {
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

  console.log(`📋 Processing ${rows.length} rows (Headers: ${csvHasHeaders ? 'YES' : 'NO'})`);

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, Math.min(i + BATCH_SIZE, rows.length));
    
    await Promise.all(batch.map(async (row, batchIdx) => {
      const rowNumber = i + batchIdx + 2;

      try {
        let phone, name, email, notes;
        
        if (csvHasHeaders) {
          phone = row.phone || row.Phone || row.PHONE || row.phoneNumber;
          name = row.name || row.Name || '';
          email = row.email || row.Email || '';
          notes = row.notes || row.Notes || '';
        } else {
          phone = extractPhoneFromHeaderlessRow(row);
          name = extractNameFromHeaderlessRow(row);
          email = extractEmailFromHeaderlessRow(row);
          notes = '';
        }
        
        if (!phone) {
          results.skipped++;
          results.errors.push({ row: rowNumber, phone: 'N/A', reason: 'Missing phone number' });
          return;
        }

        const originalPhone = phone;
        phone = phone.trim();

        // Phone validation and normalization
        if (phone.startsWith('+')) {
          phone = phone.replace(/[\s\-\(\)]/g, '');
          if (!/^\+\d{10,15}$/.test(phone)) {
            results.skipped++;
            results.errors.push({ row: rowNumber, phone: originalPhone, reason: 'Invalid international format' });
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
            results.errors.push({ row: rowNumber, phone: originalPhone, reason: 'Invalid US format' });
            return;
          }
        }

        if (processedPhones.has(phone)) {
          results.skipped++;
          return;
        }
        processedPhones.add(phone);

        // Determine country code
        let countryCode = '+1';
        if (phone.startsWith('+92')) countryCode = '+92';
        else if (phone.startsWith('+44')) countryCode = '+44';
        else if (phone.startsWith('+1')) countryCode = '+1';
        else {
          const match = phone.match(/^\+(\d{1,4})/);
          if (match) countryCode = '+' + match[1];
        }

        const csvSubscriberStatus = getSubscriberStatusFromCSV(row, !csvHasHeaders);
        const isUnsubscribedInCSV = csvSubscriberStatus === 'unsubscribed';

        let lastCheckInDate = null;
        let signUpDate = null;
        
        if (csvHasHeaders) {
          lastCheckInDate = parseDate(row['Last Check-In'] || row['lastCheckIn'] || row['last_check_in']);
          signUpDate = parseDate(row['Sign Up Date'] || row['signUpDate'] || row['sign_up_date']);
        }

        const isUSNumber = isUSPhoneNumber(phone);

        const existingCustomer = await Customer.findOne({
          phone: phone,
          businessId: businessId,
          deleted: { $ne: true }
        });

        if (existingCustomer) {
          // ✅ UPDATE EXISTING CUSTOMER - CHECKINS ONLY
          const currentCheckins = existingCustomer.totalCheckins || 0;
          existingCustomer.totalCheckins = currentCheckins + DEFAULT_CHECKINS;

          if (lastCheckInDate) {
            existingCustomer.lastCheckinAt = lastCheckInDate;
          } else {
            existingCustomer.lastCheckinAt = new Date();
          }

          existingCustomer.subscriberStatus = csvSubscriberStatus;
          
          if (!existingCustomer.metadata) {
            existingCustomer.metadata = {};
          }
          
          if (name && name.trim()) existingCustomer.metadata.name = name.trim();
          if (email && email.trim()) existingCustomer.metadata.email = email.trim();
          if (notes && notes.trim()) existingCustomer.metadata.notes = notes.trim();

          await existingCustomer.save();

          // ✅ Create CheckinLog with valid status
          await CheckinLog.create({
            businessId,
            customerId: existingCustomer._id,
            phone: existingCustomer.phone,
            countryCode: existingCustomer.countryCode || countryCode,
            status: 'checkin', // ✅ Valid enum value
            pointsAwarded: 0, // ✅ No points
            metadata: {
              source: 'csv_import_update',
              importId: importRecord._id.toString()
            },
            createdAt: lastCheckInDate || new Date()
          });

          results.updated++;
          console.log(`✅ Updated ${phone}: +${DEFAULT_CHECKINS} checkin (Total: ${existingCustomer.totalCheckins})`);

        } else {
          // ✅ CREATE NEW CUSTOMER - CHECKINS ONLY
          const newCustomer = await Customer.create({
            phone: phone,
            countryCode: countryCode,
            businessId: businessId,
            totalCheckins: DEFAULT_CHECKINS, // ✅ Only checkins
            subscriberStatus: csvSubscriberStatus,
            marketingConsent: true,
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

          // ✅ Create CheckinLog with valid status
          await CheckinLog.create({
            businessId,
            customerId: newCustomer._id,
            phone: newCustomer.phone,
            countryCode: newCustomer.countryCode,
            status: 'checkin', // ✅ Valid enum value
            pointsAwarded: 0, // ✅ No points
            metadata: {
              source: 'csv_import',
              importId: importRecord._id.toString()
            },
            createdAt: lastCheckInDate || new Date()
          });

          results.created++;
          console.log(`✅ Created ${phone} with ${DEFAULT_CHECKINS} checkin`);

          if (sendWelcome && !isUnsubscribedInCSV && isUSNumber) {
            newCustomersForWelcome.push(newCustomer);
          }
        }

      } catch (err) {
        console.error(`❌ Error row ${rowNumber}:`, err.message);
        results.skipped++;
        results.errors.push({
          row: rowNumber,
          phone: row.phone || row.Phone || extractPhoneFromHeaderlessRow(row) || 'N/A',
          reason: err.message
        });
      }
    }));

    if (importRecord) {
      const progress = Math.min(100, Math.round(((i + BATCH_SIZE) / rows.length) * 100));
      importRecord.progress = progress;
      importRecord.results = results;
      await importRecord.save();
    }
  }

  // Send welcome messages
  if (sendWelcome && newCustomersForWelcome.length > 0) {
    console.log(`📨 Sending welcome to ${newCustomersForWelcome.length} new US customers`);
    
    const welcomeMessage = business.messages?.welcome || 
      `Welcome to ${business.name}! 🎉 You've been added to our loyalty program. Reply STOP to unsubscribe.`;

    const successfulCustomerIds = [];

    for (let i = 0; i < newCustomersForWelcome.length; i += WELCOME_BATCH_SIZE) {
      const welcomeBatch = newCustomersForWelcome.slice(i, i + WELCOME_BATCH_SIZE);
      
      await Promise.allSettled(
        welcomeBatch.map(async (customer) => {
          try {
            await twilioService.sendSMS({
              to: customer.phone,
              body: welcomeMessage,
              businessId: businessId
            });
            successfulCustomerIds.push(customer._id);
            results.welcomesSent++;
          } catch (smsErr) {
            console.error(`❌ SMS failed ${customer.phone}:`, smsErr.message);
            results.welcomesFailed++;
          }
        })
      );

      if (i + WELCOME_BATCH_SIZE < newCustomersForWelcome.length) {
        await new Promise(resolve => setTimeout(resolve, WELCOME_DELAY));
      }
    }

    if (successfulCustomerIds.length > 0) {
      await Customer.updateMany(
        { _id: { $in: successfulCustomerIds } },
        { $set: { 'metadata.welcomeSent': true, 'metadata.welcomeSentAt': new Date() } }
      );
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

/**
 * Get single import status
 * GET /admin/customers/import-status/:id
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