// services/importQueue.js
const Queue = require('bull');
const Customer = require('../models/Customer');
const Business = require('../models/Business');
const ImportHistory = require('../models/ImportHistory');
const CheckinLog = require('../models/CheckinLog');
const twilioService = require('./twilioService');
const dayjs = require('dayjs');
const customParseFormat = require('dayjs/plugin/customParseFormat');
const logger = require('../utils/logger');

dayjs.extend(customParseFormat);

const DEFAULT_CHECKINS = 3;

// ⚡ OPTIMIZED SMS SETTINGS
const WELCOME_BATCH_SIZE = 50;
const WELCOME_DELAY = 500;

// 🔧 Redis Configuration
const getRedisConfig = () => {
  logger.debug('Checking Redis configuration...');
  logger.debug('REDIS_HOST:', process.env.REDIS_HOST);
  logger.debug('REDIS_PORT:', process.env.REDIS_PORT);
  logger.debug('REDIS_PASSWORD:', process.env.REDIS_PASSWORD ? '***SET***' : 'NOT SET');
  logger.debug('REDIS_USERNAME:', process.env.REDIS_USERNAME || 'NOT SET');
  logger.debug('REDIS_URL:', process.env.REDIS_URL ? '***SET***' : 'NOT SET');
  logger.debug('REDIS_TLS:', process.env.REDIS_TLS || 'NOT SET');
  
  // Priority 1: Use REDIS_URL if provided
  if (process.env.REDIS_URL) {
    logger.redis('Using Redis from REDIS_URL');
    return process.env.REDIS_URL;
  }
  
  // Priority 2: Use host/port configuration
  if (process.env.REDIS_HOST && process.env.REDIS_PORT) {
    logger.redis('Using Redis from REDIS_HOST/PORT');
    
    const config = {
      host: process.env.REDIS_HOST,
      port: parseInt(process.env.REDIS_PORT),
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      connectTimeout: 30000,
      retryStrategy: (times) => {
        logger.warn(`Redis retry attempt ${times}`);
        if (times > 10) {
          logger.error('Redis max retries reached');
          return null;
        }
        const delay = Math.min(times * 1000, 5000);
        return delay;
      }
    };

    // Handle authentication
    if (process.env.REDIS_PASSWORD) {
      if (process.env.REDIS_USERNAME) {
        logger.redis('Using username + password authentication');
        config.username = process.env.REDIS_USERNAME;
        config.password = process.env.REDIS_PASSWORD;
      } else {
        logger.redis('Using password-only authentication');
        config.password = process.env.REDIS_PASSWORD;
      }
    } else {
      logger.redis('No authentication configured');
    }

    // TLS Handling
    const tlsEnabled = process.env.REDIS_TLS === 'true' || 
                       process.env.REDIS_TLS === '1' || 
                       process.env.REDIS_TLS === 'TRUE';
    
    if (tlsEnabled) {
      logger.redis('TLS explicitly enabled via REDIS_TLS=true');
      config.tls = {
        rejectUnauthorized: process.env.REDIS_TLS_REJECT_UNAUTHORIZED !== 'false',
        servername: process.env.REDIS_HOST,
        minVersion: 'TLSv1.2'
      };
    } else {
      logger.redis(`TLS disabled (REDIS_TLS=${process.env.REDIS_TLS})`);
    }

    return config;
  }
  
  // Fallback to localhost without auth
  logger.redis('Using Local Redis (localhost:6379) - No Auth');
  return {
    host: 'localhost',
    port: 6379,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    retryStrategy: (times) => {
      const delay = Math.min(times * 50, 2000);
      return delay;
    }
  };
};

const importQueue = new Queue('csv-import', {
  redis: getRedisConfig(),
  settings: {
    lockDuration: 300000,
    stalledInterval: 60000,
    maxStalledCount: 2
  },
  limiter: {
    max: 1,
    duration: 1000
  }
});

importQueue.on('error', (error) => {
  logger.error('Queue Redis Error:', error.message);
});

importQueue.on('stalled', (job) => {
  logger.warn('Job Stalled:', job.id);
});

importQueue.on('ready', () => {
  logger.success('Import Queue Connected to Redis');
});

/**
 * ✅ IMPROVED: Extract phone with case-insensitive column matching
 */
function extractPhone(row) {
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

function looksLikePhone(str) {
  if (!str) return false;
  const cleaned = str.replace(/[\s\-\(\)]/g, '');
  return /^[\+]?\d{10,15}$/.test(cleaned);
}

/**
 * ✅ Extract name
 */
function extractName(row) {
  const nameColumns = ['name', 'Name', 'NAME', 'customer_name', 'Customer Name', 'CustomerName', 'full_name', 'Full Name'];
  
  for (const col of nameColumns) {
    if (row[col] !== undefined && row[col] !== null && row[col] !== '') {
      return String(row[col]).trim();
    }
  }
  return '';
}

/**
 * ✅ Extract email
 */
function extractEmail(row) {
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

/**
 * ✅ Extract location
 */
function extractLocation(row) {
  const locationColumns = ['location', 'Location', 'LOCATION', 'city', 'City', 'address', 'Address'];
  
  for (const col of locationColumns) {
    if (row[col] !== undefined && row[col] !== null && row[col] !== '') {
      return String(row[col]).trim();
    }
  }
  return '';
}

/**
 * ✅ Extract notes
 */
function extractNotes(row) {
  const notesColumns = ['notes', 'Notes', 'NOTES', 'comments', 'Comments', 'remarks', 'Remarks'];
  
  for (const col of notesColumns) {
    if (row[col] !== undefined && row[col] !== null && row[col] !== '') {
      return String(row[col]).trim();
    }
  }
  return '';
}

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
    'MM/DD/YYYY HH:mm:ss',
    'MM/DD/YYYY h:mm:a'
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

  console.warn('⚠️ Could not parse date:', dateString);
  return null;
}

/**
 * ✅ Get subscriber status from CSV "Subscribed" column
 */
function getSubscriberStatusFromCSV(row) {
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

  const statusColumns = [
    'status', 'Status', 'STATUS',
    'subscriberStatus', 'SubscriberStatus'
  ];

  for (const col of statusColumns) {
    if (row[col]) {
      const normalizedStatus = String(row[col]).trim().toLowerCase();
      
      const unsubscribedKeywords = [
        'unsubscribed', 'unsub', 'inactive', 'disabled',
        'opted-out', 'opt-out', 'cancelled', 'stopped', 'no'
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
 * ✅ Check if phone is US-based
 */
function isUSPhoneNumber(phone) {
  return phone.startsWith('+1');
}

// ⚡ OPTIMIZED: Process imports with check-in based system
importQueue.process(1, async (job) => {
  const { importId, businessId, rows, sendWelcome = true } = job.data;
  
  logger.import(`Processing import job ${importId}...`);
  logger.import(`Welcome messages enabled: ${sendWelcome}`);
  logger.import(`Total rows to process: ${rows.length}`);
  
  const results = {
    totalRows: rows.length,
    created: 0,
    updated: 0,
    skipped: 0,
    welcomesSent: 0,
    welcomesFailed: 0,
    errors: []
  };

  try {
    await ImportHistory.findByIdAndUpdate(importId, {
      status: 'processing',
      startedAt: new Date()
    });

    const business = await Business.findById(businessId);
    if (!business) {
      throw new Error('Business not found');
    }

    const newCustomersForWelcome = [];
    const processedPhones = new Set();
    const BATCH_SIZE = 50;

    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, Math.min(i + BATCH_SIZE, rows.length));
    
      await Promise.all(batch.map(async (row, batchIdx) => {
        const rowNumber = i + batchIdx + 2;

        try {
          // ✅ Use improved extraction functions
          const phone = extractPhone(row);
          const name = extractName(row);
          const email = extractEmail(row);
          const location = extractLocation(row);
          const notes = extractNotes(row);
          
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
              results.errors.push({
                row: rowNumber,
                phone: originalPhone,
                reason: 'Invalid international format'
              });
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
              results.errors.push({
                row: rowNumber,
                phone: originalPhone,
                reason: `Invalid phone length: ${cleanedPhone.length} digits`
              });
              return;
            }
          }

          if (processedPhones.has(cleanedPhone)) {
            console.log(`⏭️ Skipping duplicate phone in CSV: ${cleanedPhone}`);
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
            if (match) {
              countryCode = '+' + match[1];
            }
          }

          const csvSubscriberStatus = getSubscriberStatusFromCSV(row);
          const isUnsubscribedInCSV = csvSubscriberStatus === 'unsubscribed';

          // ✅ Parse dates
          let lastCheckInDate = null;
          let signUpDate = null;
          
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
                importId: importId,
                checkinsAdded: DEFAULT_CHECKINS
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
                importId: importId,
                checkinsAdded: DEFAULT_CHECKINS
              },
              createdAt: lastCheckInDate || new Date()
            });

            results.created++;
            console.log(`✅ Created ${cleanedPhone} with ${DEFAULT_CHECKINS} check-ins`);

            if (sendWelcome && !isUnsubscribedInCSV && isUSNumber) {
              newCustomersForWelcome.push(newCustomer);
            }
          }

        } catch (err) {
          console.error(`❌ Error row ${rowNumber}:`, err.message);
          results.skipped++;
          results.errors.push({
            row: rowNumber,
            phone: extractPhone(row) || 'N/A',
            reason: err.message
          });
        }
      }));

      const progress = Math.min(100, Math.round(((i + BATCH_SIZE) / rows.length) * 100));
      await job.progress(progress);
      
      await job.update({ ...job.data, lastProcessedIndex: i + BATCH_SIZE });
      
      await ImportHistory.findByIdAndUpdate(importId, {
        progress: progress,
        'results.created': results.created,
        'results.updated': results.updated,
        'results.skipped': results.skipped,
        'results.welcomesSent': results.welcomesSent,
        'results.welcomesFailed': results.welcomesFailed
      });
      
      console.log(`📊 Progress: ${progress}% (${i + BATCH_SIZE}/${rows.length} rows processed)`);
    }

    // Send welcome messages
    if (sendWelcome && newCustomersForWelcome.length > 0) {
      console.log(`📨 Sending welcome messages to ${newCustomersForWelcome.length} new US customers`);
      
      const welcomeMessage = business.messages?.welcome || 
        `Welcome to ${business.name}! 🎉 You've been added to our loyalty program with ${DEFAULT_CHECKINS} check-ins. Reply STOP to unsubscribe.`;

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

    await ImportHistory.findByIdAndUpdate(importId, {
      status: 'completed',
      progress: 100,
      results: results,
      completedAt: new Date()
    });

    console.log(`✅ Import job ${importId} completed:`, results);

    return results;
  
  } catch (error) {
    console.error(`❌ Import job ${importId} failed:`, error);
    
    await ImportHistory.findByIdAndUpdate(importId, {
      status: 'failed',
      completedAt: new Date(),
      results: {
        ...results,
        errors: [...results.errors, {
          row: 0,
          phone: 'N/A',
          reason: error.message
        }]
      }
    });
    
    throw error;
  }
});

importQueue.on('failed', async (job, err) => {
  console.error(`❌ Job ${job.id} failed:`, err);
  
  if (job.data.importId) {
    await ImportHistory.findByIdAndUpdate(job.data.importId, {
      status: 'failed',
      completedAt: new Date(),
      'results.errors': [{
        row: 0,
        phone: 'N/A',
        reason: err.message
      }]
    });
  }
});

module.exports = importQueue;