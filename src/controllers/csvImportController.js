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
const DEFAULT_CHECKINS = 3;

const WELCOME_BATCH_SIZE = 50;
const WELCOME_DELAY = 500;

/**
 * ✅ IMPROVED: Case-insensitive header detection
 */
function hasHeaders(firstRow) {
  if (!firstRow) return false;
  
  const keys = Object.keys(firstRow);
  
  // If all keys are numeric indices (0, 1, 2...), no headers
  if (keys.every(k => /^\d+$/.test(k))) {
    return false;
  }
  
  // Check for common header keywords (case-insensitive)
  const headerKeywords = [
    'phone', 'name', 'email', 'status', 'subscribed', 
    'checkin', 'signup', 'date', 'notes', 'customer', 'location', 'rewards'
  ];
  
  const hasHeaderKeywords = keys.some(key => 
    headerKeywords.some(keyword => 
      key.toLowerCase().includes(keyword)
    )
  );
  
  if (hasHeaderKeywords) return true;
  
  // Check if first value looks like data (phone number)
  const firstValue = firstRow[keys[0]];
  if (!firstValue) return false;
  
  const phonePattern = /^[\+\d\(\)\s\-]{10,}$/;
  if (phonePattern.test(String(firstValue).trim())) {
    return false; // First row is data, not header
  }
  
  return true; // Assume it's a header
}

/**
 * ✅ IMPROVED: Extract phone with case-insensitive column matching
 */
function extractPhone(row, csvHasHeaders) {
  if (!csvHasHeaders) {
    return extractPhoneFromHeaderlessRow(row);
  }

  // Case-insensitive phone column search
  const phoneColumns = ['phone', 'Phone', 'PHONE', 'phoneNumber', 'phone_number', 'PhoneNumber', 'mobile', 'Mobile', 'cell', 'Cell'];
  
  for (const col of phoneColumns) {
    if (row[col] !== undefined && row[col] !== null && row[col] !== '') {
      return String(row[col]).trim();
    }
  }

  // Try to find any column with "phone" in the name (case-insensitive)
  const keys = Object.keys(row);
  for (const key of keys) {
    if (key.toLowerCase().includes('phone')) {
      const value = row[key];
      if (value !== undefined && value !== null && value !== '') {
        return String(value).trim();
      }
    }
  }

  // Fallback: check first column
  const firstKey = keys[0];
  if (firstKey && row[firstKey]) {
    const value = String(row[firstKey]).trim();
    if (looksLikePhone(value)) {
      return value;
    }
  }

  return null;
}

function extractPhoneFromHeaderlessRow(row) {
  const keys = Object.keys(row);
  
  // Check first column first
  const firstKey = keys[0];
  if (firstKey && row[firstKey]) {
    const value = String(row[firstKey]).trim();
    if (looksLikePhone(value)) {
      return value;
    }
  }
  
  // Scan all columns
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

/**
 * ✅ IMPROVED: Extract name with better column matching
 */
function extractNameFromRow(row, csvHasHeaders) {
  if (!csvHasHeaders) {
    return extractNameFromHeaderlessRow(row);
  }

  const nameColumns = ['name', 'Name', 'NAME', 'customer_name', 'Customer Name', 'CustomerName', 'full_name', 'Full Name'];
  
  for (const col of nameColumns) {
    if (row[col] !== undefined && row[col] !== null && row[col] !== '') {
      return String(row[col]).trim();
    }
  }

  return '';
}

function extractNameFromHeaderlessRow(row) {
  const keys = Object.keys(row);
  
  // Assume second column is name if it exists
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

/**
 * ✅ IMPROVED: Extract email with better column matching
 */
function extractEmailFromRow(row, csvHasHeaders) {
  if (!csvHasHeaders) {
    return extractEmailFromHeaderlessRow(row);
  }

  const emailColumns = ['email', 'Email', 'EMAIL', 'e-mail', 'E-mail', 'customer_email', 'Customer Email'];
  
  for (const col of emailColumns) {
    if (row[col] !== undefined && row[col] !== null && row[col] !== '') {
      const value = String(row[col]).trim();
      if (value.includes('@')) {
        return value;
      }
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

/**
 * ✅ Extract location/notes
 */
function extractLocation(row, csvHasHeaders) {
  if (!csvHasHeaders) return '';
  
  const locationColumns = ['location', 'Location', 'LOCATION', 'city', 'City', 'address', 'Address'];
  
  for (const col of locationColumns) {
    if (row[col] !== undefined && row[col] !== null && row[col] !== '') {
      return String(row[col]).trim();
    }
  }
  
  return '';
}

function extractNotes(row, csvHasHeaders) {
  if (!csvHasHeaders) return '';
  
  const notesColumns = ['notes', 'Notes', 'NOTES', 'comments', 'Comments', 'remarks', 'Remarks'];
  
  for (const col of notesColumns) {
    if (row[col] !== undefined && row[col] !== null && row[col] !== '') {
      return String(row[col]).trim();
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
    'YYYY-MM-DD HH:mm:ss', 'MM/DD/YYYY HH:mm:ss', 'MM/DD/YYYY h:mm:a'
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
        .pipe(csv({ headers: false })) // Let csv-parser auto-detect
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
    console.log(`📊 Total rows parsed: ${totalRows}`);

    if (totalRows === 0) {
      throw new Error('CSV file is empty or could not be parsed');
    }

    // Check if CSV has headers
    const csvHasHeaders = hasHeaders(rows[0]);
    console.log(`🔍 CSV Headers: ${csvHasHeaders ? 'YES' : 'NO'}`);

    if (csvHasHeaders) {
      console.log('📋 First row (header):', Object.keys(rows[0]).join(', '));
    } else {
      console.log('📋 First row (data):', Object.values(rows[0]).slice(0, 5).join(', '));
    }

    // Skip header row if present
    const dataRows = csvHasHeaders ? rows.slice(1) : rows;
    console.log(`📊 Data rows to process: ${dataRows.length}`);

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
 * ⚡ Process import rows
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
      const rowNumber = i + batchIdx + (csvHasHeaders ? 2 : 1);

      try {
        // ✅ Use improved extraction functions
        const phone = extractPhone(row, csvHasHeaders);
        const name = extractNameFromRow(row, csvHasHeaders);
        const email = extractEmailFromRow(row, csvHasHeaders);
        const location = extractLocation(row, csvHasHeaders);
        const notes = extractNotes(row, csvHasHeaders);
        
        if (!phone) {
          results.skipped++;
          results.errors.push({ 
            row: rowNumber, 
            phone: 'N/A', 
            reason: 'Missing phone number',
            data: JSON.stringify(row).substring(0, 100)
          });
          return;
        }

        const originalPhone = phone;
        let cleanedPhone = phone.trim();

        // ✅ FIXED: Phone validation and normalization
        if (cleanedPhone.startsWith('+')) {
          cleanedPhone = cleanedPhone.replace(/[\s\-\(\)]/g, '');
          if (!/^\+\d{10,15}$/.test(cleanedPhone)) {
            results.skipped++;
            results.errors.push({ row: rowNumber, phone: originalPhone, reason: 'Invalid international format' });
            return;
          }
        } else {
          // Remove all non-digits
          cleanedPhone = cleanedPhone.replace(/\D/g, '');
          
          if (cleanedPhone.length === 10) {
            cleanedPhone = '+1' + cleanedPhone; // ✅ Add +1 for 10-digit US numbers
          } else if (cleanedPhone.length === 11 && cleanedPhone.startsWith('1')) {
            cleanedPhone = '+' + cleanedPhone;
          } else if (cleanedPhone.length > 10 && cleanedPhone.length <= 15) {
            cleanedPhone = '+' + cleanedPhone; // International number
          } else {
            results.skipped++;
            results.errors.push({ row: rowNumber, phone: originalPhone, reason: `Invalid phone length: ${cleanedPhone.length} digits` });
            return;
          }
        }

        if (processedPhones.has(cleanedPhone)) {
          console.log(`⏭️ Skipping duplicate: ${cleanedPhone}`);
          results.skipped++;
          return;
        }
        processedPhones.add(cleanedPhone);

        // Determine country code
        let countryCode = '+1';
        if (cleanedPhone.startsWith('+92')) countryCode = '+92';
        else if (cleanedPhone.startsWith('+44')) countryCode = '+44';
        else if (cleanedPhone.startsWith('+1')) countryCode = '+1';
        else {
          const match = cleanedPhone.match(/^\+(\d{1,4})/);
          if (match) countryCode = '+' + match[1];
        }

        const csvSubscriberStatus = getSubscriberStatusFromCSV(row, !csvHasHeaders);
        const isUnsubscribedInCSV = csvSubscriberStatus === 'unsubscribed';

        // ✅ Parse dates
        let lastCheckInDate = null;
        let signUpDate = null;
        
        if (csvHasHeaders) {
          const lastCheckinColumns = ['Last Check-In', 'Last Checkin', 'lastCheckIn', 'last_check_in', 'LastCheckIn'];
          const signupColumns = ['Sign Up Date', 'Signup Date', 'signUpDate', 'sign_up_date', 'SignUpDate'];
          
          for (const col of lastCheckinColumns) {
            if (row[col]) {
              lastCheckInDate = parseDate(row[col]);
              if (lastCheckInDate) break;
            }
          }
          
          for (const col of signupColumns) {
            if (row[col]) {
              signUpDate = parseDate(row[col]);
              if (signUpDate) break;
            }
          }
        }

        const isUSNumber = isUSPhoneNumber(cleanedPhone);

        const existingCustomer = await Customer.findOne({
          phone: cleanedPhone,
          businessId: businessId,
          deleted: { $ne: true }
        });

        if (existingCustomer) {
          // Update existing customer
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
          if (location && location.trim()) existingCustomer.metadata.location = location.trim();
          if (notes && notes.trim()) existingCustomer.metadata.notes = notes.trim();

          await existingCustomer.save();

          await CheckinLog.create({
            businessId,
            customerId: existingCustomer._id,
            phone: existingCustomer.phone,
            countryCode: existingCustomer.countryCode || countryCode,
            status: 'checkin',
            pointsAwarded: 0,
            metadata: {
              source: 'csv_import_update',
              importId: importRecord._id.toString()
            },
            createdAt: lastCheckInDate || new Date()
          });

          results.updated++;
          console.log(`✅ Updated ${cleanedPhone}: +${DEFAULT_CHECKINS} checkins (Total: ${existingCustomer.totalCheckins})`);

        } else {
          // Create new customer
          const newCustomer = await Customer.create({
            phone: cleanedPhone,
            countryCode: countryCode,
            businessId: businessId,
            totalCheckins: DEFAULT_CHECKINS,
            subscriberStatus: csvSubscriberStatus,
            marketingConsent: true,
            consentGiven: true,
            ageVerified: true,
            firstCheckinAt: signUpDate || new Date(),
            lastCheckinAt: lastCheckInDate || new Date(),
            metadata: {
              name: name || undefined,
              email: email || undefined,
              location: location || undefined,
              notes: notes || undefined,
              welcomeSent: false,
              importedViaCSV: true,
              isInternational: !isUSNumber
            }
          });

          await CheckinLog.create({
            businessId,
            customerId: newCustomer._id,
            phone: newCustomer.phone,
            countryCode: newCustomer.countryCode,
            status: 'checkin',
            pointsAwarded: 0,
            metadata: {
              source: 'csv_import',
              importId: importRecord._id.toString()
            },
            createdAt: lastCheckInDate || new Date()
          });

          results.created++;
          console.log(`✅ Created ${cleanedPhone} with ${DEFAULT_CHECKINS} checkins`);

          if (sendWelcome && !isUnsubscribedInCSV && isUSNumber) {
            newCustomersForWelcome.push(newCustomer);
          }
        }

      } catch (err) {
        console.error(`❌ Error row ${rowNumber}:`, err.message);
        results.skipped++;
        results.errors.push({
          row: rowNumber,
          phone: extractPhone(row, csvHasHeaders) || 'N/A',
          reason: err.message
        });
      }
    }));

    if (importRecord) {
      const progress = Math.min(100, Math.round(((i + BATCH_SIZE) / rows.length) * 100));
      importRecord.progress = progress;
      importRecord.results = results;
      await importRecord.save();
      console.log(`📊 Progress: ${progress}%`);
    }
  }

  // Send welcome messages
  if (sendWelcome && newCustomersForWelcome.length > 0) {
    console.log(`📨 Sending welcome to ${newCustomersForWelcome.length} new US customers`);
    
    const welcomeMessage = business.messages?.welcome || 
      `Hi Welcome! 🎉 You've been added to our loyalty program with ${DEFAULT_CHECKINS} check-ins. Reply STOP to unsubscribe.`;

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

  console.log(`✅ Import complete: ${results.created} created, ${results.updated} updated, ${results.skipped} skipped`);
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