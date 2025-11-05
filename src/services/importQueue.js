// services/importQueue.js
const Queue = require('bull');
const Customer = require('../models/Customer');
const ImportHistory = require('../models/ImportHistory');

const importQueue = new Queue('csv-import', {
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT) || 6379
  }
});

// Process imports
importQueue.process(async (job) => {
  const { importId, businessId, rows } = job.data;
  
  console.log(`🔄 Processing import job ${importId}...`);
  
  const results = {
    totalRows: rows.length,
    created: 0,
    updated: 0,
    skipped: 0,
    errors: []
  };

  // Update import status to processing
  await ImportHistory.findByIdAndUpdate(importId, {
    status: 'processing',
    startedAt: new Date()
  });

  const BATCH_SIZE = 100;

  // Process rows in batches
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, Math.min(i + BATCH_SIZE, rows.length));
    
    await Promise.all(batch.map(async (row, batchIdx) => {
      const rowNumber = i + batchIdx + 2;

      try {
        // Extract phone number
        let phone = row.phone || row.Phone || row.PHONE;
        
        if (!phone) {
          results.skipped++;
          results.errors.push({
            row: rowNumber,
            phone: 'N/A',
            reason: 'Missing phone number'
          });
          return;
        }

        // Clean and normalize
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

        // Extract country code
        let countryCode = '+1';
        if (phone.startsWith('+92')) countryCode = '+92';
        else if (phone.startsWith('+44')) countryCode = '+44';
        else if (phone.startsWith('+1')) countryCode = '+1';

        // Extract fields
        const points = parseInt(row.points || row.Points || 0) || 0;
        const name = row.name || row.Name || '';
        const email = row.email || row.Email || '';
        const notes = row.notes || row.Notes || '';

        // Check existing
        const existingCustomer = await Customer.findOne({
          phone: phone,
          businessId: businessId,
          deleted: { $ne: true }
        });

        if (existingCustomer) {
          let updated = false;

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
        console.error(`❌ Error row ${rowNumber}:`, err.message);
        results.skipped++;
        results.errors.push({
          row: rowNumber,
          phone: row.phone || 'N/A',
          reason: err.message
        });
      }
    }));

    // Update progress
    const progress = Math.min(100, Math.round(((i + BATCH_SIZE) / rows.length) * 100));
    await job.progress(progress);
    
    await ImportHistory.findByIdAndUpdate(importId, {
      progress: progress,
      'results.created': results.created,
      'results.updated': results.updated,
      'results.skipped': results.skipped
    });
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