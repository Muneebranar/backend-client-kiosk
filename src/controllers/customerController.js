// controllers/customerController.js
// ✅ FIXED: Added marketing consent management
const mongoose = require('mongoose');
const Customer = require("../models/Customer");
const Checkin = require("../models/Checkin");
const RewardHistory = require("../models/rewardHistory");
const PointsLedger = require("../models/PointsLedger");
const CheckinLog = require('../models/CheckinLog');

/**
 * Search and filter customers
 * GET /admin/customers?phone=xxx&businessId=xxx&status=xxx&page=1&limit=50
 */
exports.searchCustomers = async (req, res) => {
  try {
    const { q, status, businessId, limit = 50, page = 1 } = req.query;
    
    const userRole = req.user.role;
    const userBusinessId = req.user.businessId;

    console.log('🔍 Search Customers:', { q, status, businessId, userRole });

    // Build query
    let query = { deleted: { $ne: true } };

    // Business admin can only see their own customers
    if (userRole === 'admin') {
      if (!userBusinessId) {
        return res.status(403).json({
          ok: false,
          error: 'No business assigned to your account'
        });
      }
      query.businessId = userBusinessId;
    } else if (businessId) {
      // Master admin can filter by business
      if (!mongoose.Types.ObjectId.isValid(businessId)) {
        return res.status(400).json({
          ok: false,
          error: 'Invalid business ID'
        });
      }
      query.businessId = businessId;
    }

    // Search by phone or name
    if (q) {
      const searchRegex = new RegExp(q.replace(/\D/g, ''), 'i');
      query.$or = [
        { phone: searchRegex },
        { 'metadata.name': new RegExp(q, 'i') }
      ];
    }

    // Filter by status
    if (status) {
      query.subscriberStatus = status;
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [customers, total] = await Promise.all([
      Customer.find(query)
        .populate('businessId', 'name slug')
        .select('-__v')
        .sort({ createdAt: -1 })
        .limit(parseInt(limit))
        .skip(skip)
        .lean(),
      Customer.countDocuments(query)
    ]);

    res.json({
      ok: true,
      customers,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit))
      }
    });

  } catch (error) {
    console.error('❌ Search Customers Error:', error);
    res.status(500).json({
      ok: false,
      error: 'Failed to search customers',
      message: error.message
    });
  }
};

/**
 * Get single customer details with history
 * GET /admin/customers/:id
 */
exports.getCustomerDetails = async (req, res) => {
  try {
    const { id } = req.params;
    
    console.log('🔍 Get Customer Details:', id);

    // Validate if it's a valid MongoDB ObjectId
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        ok: false,
        error: 'Invalid customer ID format'
      });
    }

    const userRole = req.user.role;
    const userBusinessId = req.user.businessId;

    // Build query based on role
    let query = { 
      _id: id,
      deleted: { $ne: true }
    };
    
    // Business admin can only see their own customers
    if (userRole === 'admin') {
      if (!userBusinessId) {
        return res.status(403).json({
          ok: false,
          error: 'No business assigned to your account'
        });
      }
      query.businessId = userBusinessId;
    }

    const customer = await Customer.findOne(query)
      .populate('businessId', 'name slug rewardSettings')
      .lean();

    if (!customer) {
      return res.status(404).json({
        ok: false,
        error: 'Customer not found'
      });
    }

    // Get recent check-ins
    const recentCheckins = await CheckinLog.find({
      customerId: customer._id
    })
      .sort({ createdAt: -1 })
      .limit(10)
      .select('createdAt pointsAwarded status metadata')
      .lean();

    // Get total check-ins count
    const totalCheckins = customer.totalCheckins || 0;

    // Get rewards for this customer
    const rewardHistoryRecords = await RewardHistory.find({
      customerId: customer._id
    })
      .populate({
        path: 'rewardId',
        select: 'name code description expiresAt redeemed redeemedAt discountType discountValue threshold'
      })
      .sort({ createdAt: -1 })
      .lean();

    console.log(`📊 Customer ${customer.phone}:`);
    console.log(`   - Total checkins: ${totalCheckins}`);
    console.log(`   - Marketing consent: ${customer.marketingConsent}`);
    console.log(`   - Rewards found: ${rewardHistoryRecords.length}`);

    // Format rewards for frontend
    const rewards = rewardHistoryRecords.map(rh => ({
      _id: rh.rewardId?._id,
      name: rh.rewardId?.name,
      code: rh.rewardId?.code,
      description: rh.rewardId?.description,
      expiresAt: rh.rewardId?.expiresAt,
      redeemed: rh.rewardId?.redeemed,
      redeemedAt: rh.rewardId?.redeemedAt,
      discountType: rh.rewardId?.discountType,
      discountValue: rh.rewardId?.discountValue,
      threshold: rh.rewardId?.threshold,
      status: rh.status,
      earnedAt: rh.createdAt
    }));

    res.json({
      ok: true,
      customer: {
        ...customer,
        recentCheckins,
        totalCheckins
      },
      checkins: recentCheckins,
      rewards: rewards
    });

  } catch (error) {
    console.error('❌ Get Customer Error:', error);
    res.status(500).json({
      ok: false,
      error: 'Failed to fetch customer details',
      message: error.message
    });
  }
};

exports.getCustomers = async (req, res) => {
  try {
    const { phone, businessId, status, page = 1, limit = 50 } = req.query;

    console.log('🔍 Search Customers Request:', {
      phone,
      businessId,
      status,
      page,
      limit
    });

    const query = { deleted: { $ne: true } };

    // Role-based business filtering
    if (req.user.role !== 'master' && req.user.role !== 'superadmin') {
      query.businessId = req.user.businessId;
    } else if (businessId) {
      query.businessId = businessId;
    }

    // Phone search
    if (phone) {
      query.phone = { $regex: phone, $options: 'i' };
    }

    // Subscriber status filter
    if (status) {
      query.subscriberStatus = status;
    }

    console.log('📋 Query:', JSON.stringify(query));

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [customers, total] = await Promise.all([
      Customer.find(query)
        .populate('businessId', 'name slug')
        .sort({ lastCheckinAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      Customer.countDocuments(query)
    ]);

    console.log('✅ Found customers:', customers.length, '/ Total:', total);

    res.json({
      ok: true,
      customers,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (err) {
    console.error('❌ Get Customers Error:', err);
    res.status(500).json({
      ok: false,
      error: err.message
    });
  }
};

/**
 * ✅ NEW: Enable marketing consent for a customer
 * PUT /admin/customers/:id/marketing-consent
 */
exports.enableMarketingConsent = async (req, res) => {
  try {
    const { id } = req.params;
    const { marketingConsent } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        ok: false,
        error: 'Invalid customer ID format'
      });
    }

    const customer = await Customer.findOne({
      _id: id,
      deleted: { $ne: true }
    });

    if (!customer) {
      return res.status(404).json({
        ok: false,
        error: 'Customer not found'
      });
    }

    // Check access
    if (req.user.role !== 'master' && req.user.role !== 'superadmin') {
      if (customer.businessId.toString() !== req.user.businessId.toString()) {
        return res.status(403).json({
          ok: false,
          error: 'Access denied'
        });
      }
    }

    // Update marketing consent
    customer.marketingConsent = marketingConsent;
    customer.marketingConsentDate = marketingConsent ? new Date() : null;
    
    await customer.save();

    console.log(`✅ Marketing consent ${marketingConsent ? 'enabled' : 'disabled'} for:`, customer.phone);

    res.json({
      ok: true,
      customer,
      message: `Marketing consent ${marketingConsent ? 'enabled' : 'disabled'}`
    });
  } catch (err) {
    console.error('❌ Update Marketing Consent Error:', err);
    res.status(500).json({
      ok: false,
      error: err.message
    });
  }
};

/**
 * ✅ NEW: Bulk enable marketing consent
 * POST /admin/customers/bulk/marketing-consent
 */
exports.bulkEnableMarketingConsent = async (req, res) => {
  try {
    const { businessId, enable = true } = req.body;

    if (!businessId || !mongoose.Types.ObjectId.isValid(businessId)) {
      return res.status(400).json({
        ok: false,
        error: 'Valid business ID is required'
      });
    }

    // Check access
    if (req.user.role !== 'master' && req.user.role !== 'superadmin') {
      if (businessId !== req.user.businessId.toString()) {
        return res.status(403).json({
          ok: false,
          error: 'Access denied'
        });
      }
    }

    const result = await Customer.updateMany(
      {
        businessId: businessId,
        subscriberStatus: 'active',
        deleted: { $ne: true }
      },
      {
        $set: {
          marketingConsent: enable,
          marketingConsentDate: enable ? new Date() : null
        }
      }
    );

    console.log(`✅ Bulk marketing consent update: ${result.modifiedCount} customers affected`);

    res.json({
      ok: true,
      modifiedCount: result.modifiedCount,
      message: `Marketing consent ${enable ? 'enabled' : 'disabled'} for ${result.modifiedCount} customers`
    });
  } catch (err) {
    console.error('❌ Bulk Update Error:', err);
    res.status(500).json({
      ok: false,
      error: err.message
    });
  }
};

/**
 * Manually add check-in for customer
 * POST /admin/customers/:id/checkin
 */
exports.addManualCheckin = async (req, res) => {
  try {
    const { id } = req.params;
    const { points = 1 } = req.body;

    // Validate ObjectId
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        ok: false,
        error: 'Invalid customer ID format'
      });
    }

    const customer = await Customer.findOne({
      _id: id,
      deleted: { $ne: true }
    });

    if (!customer) {
      return res.status(404).json({
        ok: false,
        error: 'Customer not found'
      });
    }

    // Check access
    if (req.user.role !== 'master' && req.user.role !== 'superadmin') {
      if (customer.businessId.toString() !== req.user.businessId.toString()) {
        return res.status(403).json({
          ok: false,
          error: 'Access denied'
        });
      }
    }

    // Add check-in
    customer.totalCheckins += 1;
    customer.lastCheckinAt = new Date();
    
    if (!customer.firstCheckinAt) {
      customer.firstCheckinAt = new Date();
    }

    await customer.save();

    console.log('✅ Manual check-in added:', customer.phone, 'Total:', customer.totalCheckins);

    res.json({
      ok: true,
      customer
    });
  } catch (err) {
    console.error('❌ Add Checkin Error:', err);
    res.status(500).json({
      ok: false,
      error: err.message
    });
  }
};

/**
 * Update customer subscriber status
 * PUT /admin/customers/:id/status
 */
exports.updateSubscriberStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    
    console.log('📝 Received status update request:', {
      customerId: id,
      body: req.body,
      status: status
    });

    // Validate ObjectId
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        ok: false,
        error: 'Invalid customer ID format'
      });
    }

    if (!['active', 'invalid', 'blocked', 'unsubscribed', 'opted-out'].includes(status)) {
      return res.status(400).json({
        ok: false,
        error: 'Invalid status'
      });
    }

    const customer = await Customer.findOne({
      _id: id,
      deleted: { $ne: true }
    });

    if (!customer) {
      return res.status(404).json({
        ok: false,
        error: 'Customer not found'
      });
    }

    // Check access
    if (req.user.role !== 'master' && req.user.role !== 'superadmin') {
      if (customer.businessId.toString() !== req.user.businessId.toString()) {
        return res.status(403).json({
          ok: false,
          error: 'Access denied'
        });
      }
    }

    customer.subscriberStatus = status;
    
    // Auto-disable marketing consent if unsubscribed/blocked
    if (['unsubscribed', 'blocked', 'invalid'].includes(status)) {
      customer.marketingConsent = false;
    }
    
    await customer.save();

    console.log('✅ Subscriber status updated:', customer.phone, '->', status);

    res.json({
      ok: true,
      customer
    });
  } catch (err) {
    console.error('❌ Update Status Error:', err);
    res.status(500).json({
      ok: false,
      error: err.message
    });
  }
};

/**
 * Update customer metadata
 * PUT /admin/customers/:id
 */
exports.updateCustomer = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    // Validate ObjectId
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        ok: false,
        error: 'Invalid customer ID format'
      });
    }

    const customer = await Customer.findOne({
      _id: id,
      deleted: { $ne: true }
    });

    if (!customer) {
      return res.status(404).json({
        ok: false,
        error: 'Customer not found'
      });
    }

    // Check access
    if (req.user.role !== 'master' && req.user.role !== 'superadmin') {
      if (customer.businessId.toString() !== req.user.businessId.toString()) {
        return res.status(403).json({
          ok: false,
          error: 'Access denied'
        });
      }
    }

    // Update allowed fields
    if (updates.totalCheckins !== undefined) customer.totalCheckins = updates.totalCheckins;
    if (updates.subscriberStatus) customer.subscriberStatus = updates.subscriberStatus;
    if (updates.marketingConsent !== undefined) {
      customer.marketingConsent = updates.marketingConsent;
      customer.marketingConsentDate = updates.marketingConsent ? new Date() : null;
    }
    if (updates.metadata) {
      customer.metadata = { ...customer.metadata, ...updates.metadata };
    }

    await customer.save();

    console.log('✅ Customer updated:', customer.phone);

    res.json({
      ok: true,
      customer
    });
  } catch (err) {
    console.error('❌ Update Customer Error:', err);
    res.status(500).json({
      ok: false,
      error: err.message
    });
  }
};

/**
 * Get a customer by reward code
 * GET /admin/customers/by-code/:code
 */
exports.getCustomerByRewardCode = async (req, res) => {
  try {
    const { code } = req.params;
    
    console.log('🎫 Looking up reward code:', code);

    if (!code || code.length < 4) {
      return res.status(400).json({
        ok: false,
        error: 'Invalid reward code'
      });
    }

    const userRole = req.user.role;
    const userBusinessId = req.user.businessId;

    // Find reward first
    const Reward = require('../models/Reward');
    const reward = await Reward.findOne({ 
      code: code.toUpperCase(),
      redeemed: false
    }).lean();

    if (!reward) {
      return res.status(404).json({
        ok: false,
        error: 'Reward not found or already redeemed'
      });
    }

    // Build customer query
    let query = { 
      phone: reward.phone,
      businessId: reward.businessId,
      deleted: { $ne: true }
    };

    // Business admin can only see their own customers
    if (userRole === 'admin') {
      if (!userBusinessId) {
        return res.status(403).json({
          ok: false,
          error: 'No business assigned to your account'
        });
      }
      if (reward.businessId.toString() !== userBusinessId) {
        return res.status(403).json({
          ok: false,
          error: 'Access denied'
        });
      }
    }

    const customer = await Customer.findOne(query)
      .populate('businessId', 'name slug rewardSettings')
      .lean();

    if (!customer) {
      return res.status(404).json({
        ok: false,
        error: 'Customer not found'
      });
    }

    res.json({
      ok: true,
      customer,
      reward
    });

  } catch (error) {
    console.error('❌ Get Customer By Code Error:', error);
    res.status(500).json({
      ok: false,
      error: 'Failed to find customer',
      message: error.message
    });
  }
};

exports.deleteCustomer = async (req, res) => {
  try {
    const { id } = req.params;

    // Validate ObjectId
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        ok: false,
        error: 'Invalid customer ID format'
      });
    }

    const customer = await Customer.findOne({
      _id: id,
      deleted: { $ne: true }
    });

    if (!customer) {
      return res.status(404).json({
        ok: false,
        error: 'Customer not found'
      });
    }

    // Check access
    if (req.user.role !== 'master' && req.user.role !== 'superadmin') {
      if (customer.businessId.toString() !== req.user.businessId.toString()) {
        return res.status(403).json({
          ok: false,
          error: 'Access denied'
        });
      }
    }

    // Soft delete
    customer.deleted = true;
    customer.deletedAt = new Date();
    await customer.save();

    console.log('✅ Customer deleted:', customer.phone);

    res.json({
      ok: true,
      message: 'Customer deleted successfully'
    });
  } catch (err) {
    console.error('❌ Delete Customer Error:', err);
    res.status(500).json({
      ok: false,
      error: err.message
    });
  }
};

/**
 * Export customer data
 * GET /admin/customers/export?businessId=xxx&format=csv
 */
exports.exportCustomers = async (req, res) => {
  try {
    const { businessId, format = "csv" } = req.query;

    console.log("📥 Export customers:", { businessId, format });

    let query = { deleted: { $ne: true } };

    if (req.user && req.user.role === "master") {
      if (businessId) query.businessId = businessId;
    } else if (req.user) {
      query.businessId = req.user.businessId;
    }

    const customers = await Customer.find(query)
      .populate("businessId", "name")
      .sort({ createdAt: -1 })
      .lean();

    if (format === "json") {
      return res.json({
        ok: true,
        customers,
        total: customers.length,
      });
    }

    // CSV export
    const csv = [
      "Phone,Business,Total Check-ins,Status,Marketing Consent,Age Verified,First Visit,Last Visit",
      ...customers.map((c) =>
        [
          c.phone,
          c.businessId?.name || "",
          c.totalCheckins || 0,
          c.subscriberStatus,
          c.marketingConsent ? "Yes" : "No",
          c.ageVerified ? "Yes" : "No",
          c.firstCheckinAt ? new Date(c.firstCheckinAt).toISOString() : "",
          c.lastCheckinAt ? new Date(c.lastCheckinAt).toISOString() : "",
        ].join(",")
      ),
    ].join("\n");

    res.setHeader("Content-Type", "text/csv");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=customers-${Date.now()}.csv`
    );
    res.send(csv);

    console.log("✅ Customers exported successfully");
  } catch (err) {
    console.error("❌ Export Customers Error:", err);
    res.status(500).json({ 
      ok: false, 
      error: err.message 
    });
  }
};

module.exports = exports;