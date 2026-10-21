import Lead from '../models/Lead.js';
import Campaign from '../models/Campaign.js';
import CallSession from '../models/CallSession.js';
import csvParser from 'csv-parser';
import { Readable } from 'stream';
import s2sCallingService from '../services/s2sCallingService.js';

// @desc    Get all leads for a campaign
// @route   GET /api/campaigns/:campaignId/leads
// @access  Private
export const getLeads = async (req, res) => {
  try {
    const { campaignId } = req.params;
    const { status, search, limit = 50, offset = 0 } = req.query;

    // Verify campaign belongs to user
    const campaign = await Campaign.findOne({ _id: campaignId, createdBy: req.user._id });
    if (!campaign) {
      return res.status(404).json({ success: false, message: 'Campaign not found' });
    }

    // Build query
    const query = { campaignId };
    if (status) query.status = status;
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { phoneNumber: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
      ];
    }

    const leads = await Lead.find(query)
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip(parseInt(offset));

    const leadIds = leads.map((lead) => lead._id);
    const sessionData = leadIds.length
      ? await CallSession.aggregate([
          { $match: { leadId: { $in: leadIds } } },
          { $sort: { createdAt: -1 } },
          {
            $group: {
              _id: '$leadId',
              count: { $sum: 1 },
              interest_level: { $first: '$extracted.interest_level' },
              intent: { $first: '$extracted.intent' },
            },
          },
        ])
      : [];

    const sessionDataByLeadId = new Map(
      sessionData.map((row) => [String(row._id), row])
    );

    const leadsWithAttempts = leads.map((lead) => {
      const sData = sessionDataByLeadId.get(String(lead._id)) || {};
      return {
        ...lead.toObject(),
        callAttempts: sData.count || 0,
        interest_level: sData.interest_level || '',
        intent: sData.intent || '',
      };
    });

    const total = await Lead.countDocuments(query);

    res.json({
      success: true,
      data: leadsWithAttempts,
      pagination: {
        total,
        limit: parseInt(limit),
        offset: parseInt(offset),
        hasMore: total > parseInt(offset) + parseInt(limit),
      },
    });
  } catch (error) {
    console.error('Error fetching leads:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Create lead for a campaign
// @route   POST /api/campaigns/:campaignId/leads
// @access  Private
export const createLead = async (req, res) => {
  try {
    const { campaignId } = req.params;
    const { name = '', phoneNumber = '', phone = '', email = '', customFields = {}, notes = '' } = req.body;

    // Verify campaign belongs to user
    const campaign = await Campaign.findOne({ _id: campaignId, createdBy: req.user._id });
    if (!campaign) {
      return res.status(404).json({ success: false, message: 'Campaign not found' });
    }

    const resolvedPhone = (phoneNumber || phone || '').trim();
    if (!resolvedPhone) {
      return res.status(400).json({ success: false, message: 'Phone number is required' });
    }

    const lead = await Lead.create({
      campaignId,
      name: name || resolvedPhone,
      phone: resolvedPhone,
      phoneNumber: resolvedPhone,
      email,
      customFields,
      notes,
    });

    await Campaign.findByIdAndUpdate(campaignId, {
      $inc: { 'stats.totalLeads': 1 },
    });

    res.status(201).json({ success: true, data: lead });
  } catch (error) {
    console.error('Error creating lead:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Upload leads from CSV
// @route   POST /api/campaigns/:campaignId/leads/upload
// @access  Private
export const uploadLeads = async (req, res) => {
  try {
    const { campaignId } = req.params;
    const file = req.file;
    const fieldMapping = req.body.fieldMapping ? JSON.parse(req.body.fieldMapping) : null;

    if (!file || !fieldMapping) {
      return res.status(400).json({
        success: false,
        message: 'CSV file and field mapping are required',
      });
    }

    // Verify campaign belongs to user
    const campaign = await Campaign.findOne({ _id: campaignId, createdBy: req.user._id });
    if (!campaign) {
      return res.status(404).json({ success: false, message: 'Campaign not found' });
    }

    const leads = [];
    const errors = [];

    // Parse CSV data from buffer
    const stream = Readable.from(file.buffer.toString('utf8'));
    const parser = stream.pipe(csvParser());

    parser.on('data', (row) => {
      try {
        const lead = {
          campaignId,
          name: row[fieldMapping.name] || '',
          phone: row[fieldMapping.phoneNumber] || '',
          phoneNumber: row[fieldMapping.phoneNumber] || '',
          email: row[fieldMapping.email] || '',
          customFields: {},
        };

        // Map custom fields
        if (fieldMapping.customFields) {
          Object.keys(fieldMapping.customFields).forEach((key) => {
            const csvColumn = fieldMapping.customFields[key];
            if (row[csvColumn]) {
              lead.customFields[key] = row[csvColumn];
            }
          });
        }

        // Validate required fields
        if (!lead.phoneNumber) {
          errors.push({ row, error: 'Phone number is required' });
          return;
        }

        leads.push(lead);
      } catch (error) {
        errors.push({ row, error: error.message });
      }
    });

    await new Promise((resolve, reject) => {
      parser.on('end', resolve);
      parser.on('error', reject);
    });

    // Insert leads into database
    if (leads.length > 0) {
      const insertedLeads = await Lead.insertMany(leads, { ordered: false });

      // Update campaign statistics
      await Campaign.findByIdAndUpdate(campaignId, {
        $inc: { 'stats.totalLeads': insertedLeads.length },
      });

      res.json({
        success: true,
        message: `Successfully uploaded ${insertedLeads.length} leads`,
        data: {
          imported: insertedLeads.length,
          errors: errors.length,
          errorDetails: errors.slice(0, 10), // Return first 10 errors
        },
      });
    } else {
      res.status(400).json({
        success: false,
        message: 'No valid leads found in CSV',
        data: { errors },
      });
    }
  } catch (error) {
    console.error('Error uploading leads:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Get single lead
// @route   GET /api/leads/:id
// @access  Private
export const getLead = async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id).populate('campaignId', 'name');

    if (!lead) {
      return res.status(404).json({ success: false, message: 'Lead not found' });
    }

    // Verify user has access to this lead's campaign
    const campaign = await Campaign.findOne({
      _id: lead.campaignId._id,
      createdBy: req.user._id,
    });

    if (!campaign) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    res.json({ success: true, data: lead });
  } catch (error) {
    console.error('Error fetching lead:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Update lead
// @route   PUT /api/leads/:id
// @access  Private
export const updateLead = async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id);

    if (!lead) {
      return res.status(404).json({ success: false, message: 'Lead not found' });
    }

    // Verify user has access to this lead's campaign
    const campaign = await Campaign.findOne({
      _id: lead.campaignId,
      createdBy: req.user._id,
    });

    if (!campaign) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const { name, phoneNumber, email, customFields, status, notes } = req.body;

    if (name !== undefined) lead.name = name;
    if (phoneNumber !== undefined) {
      lead.phoneNumber = phoneNumber;
      lead.phone = phoneNumber;
    }
    if (email !== undefined) lead.email = email;
    if (customFields !== undefined) lead.customFields = customFields;
    if (status !== undefined) lead.status = status;
    if (notes !== undefined) lead.notes = notes;

    await lead.save();

    res.json({ success: true, data: lead });
  } catch (error) {
    console.error('Error updating lead:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Initiate immediate call to a lead via active telephony provider + Gemini S2S
// @route   POST /api/leads/:id/call
// @access  Private
export const initiateLeadCall = async (req, res) => {
  try {
    const callData = await s2sCallingService.initiateLeadCall({
      leadId: req.params.id,
      ownerUserId: req.user._id,
      requestBaseUrl: `${req.protocol}://${req.get('host')}`,
      source: 'manual-endpoint',
    });

    res.status(200).json({
      success: true,
      data: callData,
      message: 'Call initiated via active telephony provider',
    });
  } catch (error) {
    console.error('Error initiating lead call:', error);
    res.status(error?.statusCode || 500).json({
      success: false,
      message: error.message || 'Failed to initiate call',
    });
  }
};

// @desc    Delete lead
// @route   DELETE /api/leads/:id
// @access  Private
export const deleteLead = async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id);

    if (!lead) {
      return res.status(404).json({ success: false, message: 'Lead not found' });
    }

    // Verify user has access to this lead's campaign
    const campaign = await Campaign.findOne({
      _id: lead.campaignId,
      createdBy: req.user._id,
    });

    if (!campaign) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    await lead.deleteOne();

    // Update campaign statistics
    await Campaign.findByIdAndUpdate(lead.campaignId, {
      $inc: { 'stats.totalLeads': -1 },
    });

    res.json({ success: true, message: 'Lead deleted successfully' });
  } catch (error) {
    console.error('Error deleting lead:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Get campaign statistics
// @route   GET /api/campaigns/:campaignId/leads/stats
// @access  Private
export const getLeadStats = async (req, res) => {
  try {
    const { campaignId } = req.params;

    // Verify campaign belongs to user
    const campaign = await Campaign.findOne({ _id: campaignId, createdBy: req.user._id });
    if (!campaign) {
      return res.status(404).json({ success: false, message: 'Campaign not found' });
    }

    const stats = await Lead.aggregate([
      { $match: { campaignId: campaign._id } },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
        },
      },
    ]);

    const statusCounts = {
      pending: 0,
      calling: 0,
      completed: 0,
      failed: 0,
      scheduled: 0,
    };

    stats.forEach((stat) => {
      statusCounts[stat._id] = stat.count;
    });

    res.json({ success: true, data: statusCounts });
  } catch (error) {
    console.error('Error fetching lead stats:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};
