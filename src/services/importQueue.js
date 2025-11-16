// services/importQueue.js
const Queue = require('bull');
const Customer = require('../models/Customer');
const Business = require('../models/Business');
const ImportHistory = require('../models/ImportHistory');
const CheckinLog = require('../models/CheckinLog');
const PointsLedger = require('../models/PointsLedger');
const twilioService = require('./twilioService');
const dayjs = require('dayjs');
const customParseFormat = require('dayjs/plugin/customParseFormat');

dayjs.extend(customParseFormat);

const DEFAULT_POINTS = 3;
const DEFAULT_CHECKINS = 3;

// ⚡ OPTIMIZED SMS SETTINGS
const WELCOME_BATCH_SIZE = 50;
const WELCOME_DELAY = 500;

// 🔧 FIXED: Redis Configuration with Upstash Support
const getRedisConfig = () => {
  // Check if using Upstash
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    console.log('🌐 Using Upstash Redis (Cloud)');
    
    // Parse Upstash URL
    const url = new URL(process.env.UPSTASH_REDIS_REST_URL);
    
    return {
      host: url.hostname,
      port: 6379,
      password: process.env.UPSTASH_REDIS_REST_TOKEN,
      tls: {
        rejectUnauthorized: false
      },
      maxRetriesPerRequest: 3,
      enableReadyCheck: false,
      retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
      }
    };
  }
  
  // Fallback to localhost
  console.log('💻 Using Local Redis');
  return {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT) || 6379,
    maxRetriesPerRequest: 3,
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
    lockDuration: 30000,
    stalledInterval: 30000,
    maxStalledCount: 1
  }
});

importQueue.on('error', (error) => {
  console.error('❌ Queue Redis Error:', error.message);
});

importQueue.on('stalled', (job) => {
  console.warn('⚠️ Job Stalled:', job.id);
});

importQueue.on('ready', () => {
  console.log('✅ Import Queue Connected to Redis');
});

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
  // Check for "Subscribed" column first
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

// ⚡ OPTIMIZED: Process imports with updated requirements
importQueue.process(async (job) => {
  const { importId, businessId, rows, sendWelcome = true } = job.data;
  
  console.log(`🔄 Processing import job ${importId}...`);
  console.log(`📨 Welcome messages enabled: ${sendWelcome}`);
  
  const results = {
    totalRows: rows.length,
    created: 0,
    updated: 0,
    skipped: 0,
    welcomesSent: 0,
    welcomesFailed: 0,
    errors: []
  };

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
  const BATCH_SIZE = 100;

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

        if (phone.startsWith('+')) {
          phone = phone.replace(/[\s\-\(\)]/g, '');
          
          if (!/^\+\d{10,15}$/.test(phone)) {
            results.skipped++;
            results.errors.push({
              row: rowNumber,
              phone: originalPhone,
              reason: 'Invalid international format'
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
              reason: 'Invalid US format'
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

        let countryCode = '+1';
        if (phone.startsWith('+92')) countryCode = '+92';
        else if (phone.startsWith('+44')) countryCode = '+44';
        else if (phone.startsWith('+1')) countryCode = '+1';
        else {
          const match = phone.match(/^\+(\d{1,4})/);
          if (match) {
            countryCode = '+' + match[1];
          }
        }

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

          // ✅ Create checkin log
          await CheckinLog.create({
            businessId,
            customerId: existingCustomer._id,
            phone: existingCustomer.phone,
            countryCode: existingCustomer.countryCode || countryCode,
            status: 'api',
            pointsAwarded: DEFAULT_POINTS,
            metadata: {
              source: 'csv_import_update',
              importId: importId
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
              importId: importId
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

          // ✅ Create checkin log
          await CheckinLog.create({
            businessId,
            customerId: newCustomer._id,
            phone: newCustomer.phone,
            countryCode: newCustomer.countryCode,
            status: 'api',
            pointsAwarded: DEFAULT_POINTS,
            metadata: {
              source: 'csv_import',
              importId: importId
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
              importId: importId
            }
          });

          results.created++;
          console.log(`✅ Created ${phone} with ${DEFAULT_POINTS} points and ${DEFAULT_CHECKINS} checkins (Status: ${csvSubscriberStatus})`);

          if (sendWelcome && !isUnsubscribedInCSV && isUSNumber) {
            newCustomersForWelcome.push(newCustomer);
          }
        }

      } catch (err) {
        console.error(`❌ Error row ${rowNumber}:`, err.message);
        results.skipped++;
        results.errors.push({
          row: rowNumber,
          phone: row.phone || 'N/A',
          reason: err.message
        });
      }
    }));

    const progress = Math.min(100, Math.round(((i + BATCH_SIZE) / rows.length) * 100));
    await job.progress(progress);
    
    await ImportHistory.findByIdAndUpdate(importId, {
      progress: progress,
      'results.created': results.created,
      'results.updated': results.updated,
      'results.skipped': results.skipped,
      'results.welcomesSent': results.welcomesSent,
      'results.welcomesFailed': results.welcomesFailed
    });
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

  // Mark complete
  await ImportHistory.findByIdAndUpdate(importId, {
    status: 'completed',
    progress: 100,
    results: results,
    completedAt: new Date()
  });

  console.log(`✅ Import job ${importId} completed:`, results);

  return results;
});

// Error handling
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