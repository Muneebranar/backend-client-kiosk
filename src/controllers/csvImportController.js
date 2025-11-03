// controllers/csvImportController.js
const Customer = require("../models/Customer");
const Business = require("../models/Business");
const { parseCSV } = require("../utils/csvParser");

/**
 * Import customers from CSV with merge logic
 * POST /admin/customers/import
 * Body: multipart/form-data with 'csv' file
 */
exports.importCustomersCSV = async (req, res) => {
  try {
    const { businessId } = req.body;
    
    // Validate business access
    const business = await Business.findById(businessId);
    if (!business) {
      return res.status(404).json({ error: "Business not found" });
    }

    // Check role-based access
    if (req.user.role === "admin" && req.user.businessId.toString() !== businessId) {
      return res.status(403).json({ error: "Access denied to this business" });
    }

    if (req.user.role === "staff") {
      return res.status(403).json({ error: "Staff cannot import CSV" });
    }

    // Validate file upload
    if (!req.file) {
      return res.status(400).json({ error: "No CSV file uploaded" });
    }

    // Check file size (max 5MB for ~20k rows)
    if (req.file.size > 5 * 1024 * 1024) {
      return res.status(400).json({ error: "File too large (max 5MB)" });
    }

    // Parse CSV
    const { validRows, errors } = await parseCSV(req.file.buffer, business);

    if (validRows.length === 0) {
      return res.status(400).json({
        ok: false,
        message: "No valid rows found",
        errors,
      });
    }

    // Process in batches to avoid timeout
    const BATCH_SIZE = 500;
    const results = {
      created: 0,
      updated: 0,
      skipped: 0,
      errors: [...errors],
    };

    for (let i = 0; i < validRows.length; i += BATCH_SIZE) {
      const batch = validRows.slice(i, i + BATCH_SIZE);

      for (const row of batch) {
        try {
          const existing = await Customer.findOne({
            phone: row.phone,
            businessId: row.businessId,
          });

          if (existing) {
            // Update points (add to existing)
            existing.points += row.points;
            existing.metadata.name = row.metadata.name || existing.metadata.name;
            existing.metadata.email = row.metadata.email || existing.metadata.email;
            await existing.save();
            results.updated++;
          } else {
            // Create new customer
            await Customer.create({
              ...row,
              subscriberStatus: "active",
              consentGiven: false,
              firstCheckinAt: new Date(),
            });
            results.created++;
          }
        } catch (err) {
          results.errors.push({
            phone: row.phone,
            reason: err.message,
          });
          results.skipped++;
        }
      }
    }

    res.json({
      ok: true,
      message: "Import completed",
      results: {
        totalRows: validRows.length,
        created: results.created,
        updated: results.updated,
        skipped: results.skipped,
        errors: results.errors,
      },
    });
  } catch (err) {
    console.error("CSV Import Error:", err);
    res.status(500).json({ error: "Import failed: " + err.message });
  }
};

/**
 * Get import history
 * GET /admin/customers/import-history
 */
exports.getImportHistory = async (req, res) => {
  try {
    // This would require an ImportLog model (future enhancement)
    // For MVP, we'll just return a simple response
    res.json({
      ok: true,
      message: "Import history not yet implemented",
      history: [],
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};