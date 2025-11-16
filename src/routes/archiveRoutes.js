// routes/archiveRoutes.js
const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth'); // Adjust path if needed
const archiveService = require('../services/archiveService');

/**
 * POST /admin/archive/trigger
 * Manually trigger archive process (master/superadmin only)
 */
router.post('/archive/trigger', requireAuth, async (req, res) => {
  try {
    // Check authorization
    if (req.user.role !== 'master' && req.user.role !== 'superadmin') {
      return res.status(403).json({
        ok: false,
        error: 'Only master/superadmin can trigger archive'
      });
    }

    console.log(`📋 Manual archive triggered by: ${req.user.name || req.user.id}`);

    // Run archive process
    const result = await archiveService.manualArchive();
    
    res.json({
      ok: true,
      message: 'Archive completed successfully',
      result: {
        archived: result.archived,
        deleted: result.deleted,
        months: result.months
      }
    });
  } catch (error) {
    console.error('❌ Archive trigger error:', error);
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

/**
 * GET /admin/archive/list
 * List all archived files in Supabase (master/superadmin only)
 */
router.get('/archive/list', requireAuth, async (req, res) => {
  try {
    // Check authorization
    if (req.user.role !== 'master' && req.user.role !== 'superadmin') {
      return res.status(403).json({
        ok: false,
        error: 'Access denied'
      });
    }

    const files = await archiveService.listArchivedFiles();
    
    res.json({
      ok: true,
      files,
      count: files.length
    });
  } catch (error) {
    console.error('❌ List archives error:', error);
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

/**
 * POST /admin/archive/restore/:monthKey
 * Restore archived data for a specific month (master/superadmin only)
 * @param {string} monthKey - Format: YYYY-MM (e.g., 2024-01)
 */
router.post('/archive/restore/:monthKey', requireAuth, async (req, res) => {
  try {
    // Check authorization
    if (req.user.role !== 'master' && req.user.role !== 'superadmin') {
      return res.status(403).json({
        ok: false,
        error: 'Only master/superadmin can restore archives'
      });
    }

    const { monthKey } = req.params;
    
    // Validate month format
    if (!/^\d{4}-\d{2}$/.test(monthKey)) {
      return res.status(400).json({
        ok: false,
        error: 'Invalid month format. Use YYYY-MM (e.g., 2024-01)'
      });
    }

    console.log(`📥 Restoring archive for month: ${monthKey} by ${req.user.name || req.user.id}`);
    
    const restored = await archiveService.restoreArchivedMonth(monthKey);
    
    res.json({
      ok: true,
      message: `Successfully restored ${restored.length} records`,
      month: monthKey,
      count: restored.length
    });
  } catch (error) {
    console.error('❌ Restore archive error:', error);
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

/**
 * GET /admin/archive/status
 * Get archive system status (master/superadmin only)
 */
router.get('/archive/status', requireAuth, async (req, res) => {
  try {
    // Check authorization
    if (req.user.role !== 'master' && req.user.role !== 'superadmin') {
      return res.status(403).json({
        ok: false,
        error: 'Access denied'
      });
    }

    const ImportHistory = require('../models/ImportHistory');
    
    // Count records in MongoDB
    const totalRecords = await ImportHistory.countDocuments();
    
    // Count records older than 30 days
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const oldRecords = await ImportHistory.countDocuments({
      createdAt: { $lt: thirtyDaysAgo }
    });
    
    // Get oldest record date
    const oldestRecord = await ImportHistory.findOne()
      .sort({ createdAt: 1 })
      .select('createdAt')
      .lean();
    
    // Get newest record date
    const newestRecord = await ImportHistory.findOne()
      .sort({ createdAt: -1 })
      .select('createdAt')
      .lean();
    
    // List archived files
    const archivedFiles = await archiveService.listArchivedFiles();
    
    res.json({
      ok: true,
      status: {
        mongodb: {
          totalRecords,
          recordsToArchive: oldRecords,
          oldestRecord: oldestRecord?.createdAt || null,
          newestRecord: newestRecord?.createdAt || null
        },
        supabase: {
          archivedFiles: archivedFiles.length,
          files: archivedFiles
        },
        nextArchive: '2:00 AM (daily)'
      }
    });
  } catch (error) {
    console.error('❌ Archive status error:', error);
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

module.exports = router;