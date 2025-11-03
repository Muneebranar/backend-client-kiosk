// controllers/customerController.js
const Customer = require("../models/Customer");
const CheckinLog = require("../models/CheckinLog");
const Reward = require("../models/Reward");

/**
 * Search and filter customers
 * GET /admin/customers?phone=xxx&businessId=xxx&status=xxx&page=1&limit=50
 */
exports.searchCustomers = async (req, res) => {
  try {
    const {
      phone = "",
      businessId,
      status,
      page = 1,
      limit = 50,
    } = req.query;

    // Build query based on role
    let query = {};

    if (req.user.role === "master") {
      // Master can see all businesses
      if (businessId) query.businessId = businessId;
    } else {
      // Admin/Staff can only see their business
      query.businessId = req.user.businessId;
    }

    // Add filters
    if (phone) {
      query.phone = { $regex: phone, $options: "i" };
    }

    if (status) {
      query.subscriberStatus = status;
    }

    // Pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const customers = await Customer.find(query)
      .populate("businessId", "name slug")
      .sort({ lastCheckinAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Customer.countDocuments(query);

    res.json({
      ok: true,
      customers,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (err) {
    console.error("Search Customers Error:", err);
    res.status(500).json({ error: err.message });
  }
};

/**
 * Get single customer details with history
 * GET /admin/customers/:id
 */
exports.getCustomerDetails = async (req, res) => {
  try {
    const customer = await Customer.findById(req.params.id).populate(
      "businessId",
      "name slug logo"
    );

    if (!customer) {
      return res.status(404).json({ error: "Customer not found" });
    }

    // Check access
    if (
      req.user.role !== "master" &&
      customer.businessId._id.toString() !== req.user.businessId.toString()
    ) {
      return res.status(403).json({ error: "Access denied" });
    }

    // Fetch check-in history
    const checkins = await CheckinLog.find({
      phone: customer.phone,
      businessId: customer.businessId._id,
    })
      .sort({ createdAt: -1 })
      .limit(50);

    // Fetch rewards history
    const rewards = await Reward.find({
      phone: customer.phone,
      businessId: customer.businessId._id,
    }).sort({ createdAt: -1 });

    res.json({
      ok: true,
      customer,
      checkins,
      rewards,
    });
  } catch (err) {
    console.error("Get Customer Error:", err);
    res.status(500).json({ error: err.message });
  }
};

/**
 * Manually add check-in for customer
 * POST /admin/customers/:id/checkin
 */
exports.addManualCheckin = async (req, res) => {
  try {
    const customer = await Customer.findById(req.params.id);

    if (!customer) {
      return res.status(404).json({ error: "Customer not found" });
    }

    // Check access
    if (
      req.user.role !== "master" &&
      customer.businessId.toString() !== req.user.businessId.toString()
    ) {
      return res.status(403).json({ error: "Access denied" });
    }

    // Add points
    customer.points += 1;
    customer.totalCheckins += 1;
    customer.lastCheckinAt = new Date();

    if (!customer.firstCheckinAt) {
      customer.firstCheckinAt = new Date();
    }

    await customer.save();

    // Log the check-in
    await CheckinLog.create({
      businessId: customer.businessId,
      phone: customer.phone,
      countryCode: customer.countryCode,
      status: "manual",
      addedBy: req.user._id,
    });

    res.json({
      ok: true,
      message: "Check-in added successfully",
      customer,
    });
  } catch (err) {
    console.error("Add Checkin Error:", err);
    res.status(500).json({ error: err.message });
  }
};

/**
 * Update customer subscriber status
 * PUT /admin/customers/:id/status
 */
exports.updateSubscriberStatus = async (req, res) => {
  try {
    const { status } = req.body;

    if (!["active", "invalid", "blocked", "opted-out"].includes(status)) {
      return res.status(400).json({ error: "Invalid status value" });
    }

    const customer = await Customer.findById(req.params.id);

    if (!customer) {
      return res.status(404).json({ error: "Customer not found" });
    }

    // Check access
    if (
      req.user.role !== "master" &&
      customer.businessId.toString() !== req.user.businessId.toString()
    ) {
      return res.status(403).json({ error: "Access denied" });
    }

    customer.subscriberStatus = status;
    await customer.save();

    res.json({
      ok: true,
      message: "Status updated successfully",
      customer,
    });
  } catch (err) {
    console.error("Update Status Error:", err);
    res.status(500).json({ error: err.message });
  }
};

/**
 * Update customer metadata
 * PUT /admin/customers/:id
 */
exports.updateCustomer = async (req, res) => {
  try {
    const { name, email, notes, tags } = req.body;

    const customer = await Customer.findById(req.params.id);

    if (!customer) {
      return res.status(404).json({ error: "Customer not found" });
    }

    // Check access
    if (
      req.user.role !== "master" &&
      customer.businessId.toString() !== req.user.businessId.toString()
    ) {
      return res.status(403).json({ error: "Access denied" });
    }

    if (name !== undefined) customer.metadata.name = name;
    if (email !== undefined) customer.metadata.email = email;
    if (notes !== undefined) customer.metadata.notes = notes;
    if (tags !== undefined) customer.metadata.tags = tags;

    await customer.save();

    res.json({
      ok: true,
      message: "Customer updated successfully",
      customer,
    });
  } catch (err) {
    console.error("Update Customer Error:", err);
    res.status(500).json({ error: err.message });
  }
};

/**
 * Delete customer (soft delete - set to blocked)
 * DELETE /admin/customers/:id
 */
exports.deleteCustomer = async (req, res) => {
  try {
    const customer = await Customer.findById(req.params.id);

    if (!customer) {
      return res.status(404).json({ error: "Customer not found" });
    }

    // Check access - only master or admin can delete
    if (req.user.role === "staff") {
      return res.status(403).json({ error: "Staff cannot delete customers" });
    }

    if (
      req.user.role !== "master" &&
      customer.businessId.toString() !== req.user.businessId.toString()
    ) {
      return res.status(403).json({ error: "Access denied" });
    }

    // Soft delete
    customer.subscriberStatus = "blocked";
    await customer.save();

    res.json({
      ok: true,
      message: "Customer blocked successfully",
    });
  } catch (err) {
    console.error("Delete Customer Error:", err);
    res.status(500).json({ error: err.message });
  }
};