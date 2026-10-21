import Integration from '../models/Integration.js';
import integrationExecutor from '../services/integrationExecutor.js';

const GEMINI_S2S_TEMPLATE_ID = 'gemini_live';

const GEMINI_AVAILABLE_MODELS = [
  {
    id: 'gemini-3.1-flash-live-preview',
    name: 'Gemini 3.1 Flash Live Preview',
    description: 'Audio-to-audio low-latency model for realtime dialogue',
  },
  {
    id: 'gemini-3.8-live',
    name: 'Gemini 3.8 Live',
    description: 'Audio-to-audio low-latency model for realtime dialogue',
  },
];

const GEMINI_AVAILABLE_VOICES = [
  { id: 'Puck', name: 'Puck' },
  { id: 'Charon', name: 'Charon' },
  { id: 'Kore', name: 'Kore' },
  { id: 'Fenrir', name: 'Fenrir' },
  { id: 'Aoede', name: 'Aoede' },
];

const GEMINI_AVAILABLE_LANGUAGES = [
  { code: 'hinglish', name: 'Hinglish (Hindi in English Script)' },
  { code: 'kn-IN', name: 'Kannada (Karnataka / Kanglish)' },
  { code: 'te-IN', name: 'Telugu (Andhra & Telangana)' },
  { code: 'ta-IN', name: 'Tamil (Tamil Nadu / Tanglish)' },
  { code: 'ml-IN', name: 'Malayalam (Kerala)' },
  { code: 'en-IN', name: 'English (India)' },
  { code: 'hi-IN', name: 'Hindi (India)' },
  { code: 'en-US', name: 'English (US)' },
  { code: 'es-ES', name: 'Spanish (Spain)' },
];

const autoHealS2SIntegration = (integration) => {
  if (!integration || integration.type !== 's2s') return;
  const baseUrl = (integration.baseUrl || '').trim();
  const desc = (integration.description || '').toLowerCase();
  const name = (integration.name || '').toLowerCase();

  const isGeminiLive =
    /generativelanguage\.googleapis\.com/i.test(baseUrl) ||
    desc.includes('gemini') ||
    name.includes('gemini') ||
    (integration.metadata instanceof Map
      ? integration.metadata.get('provider') === 'google_gemini_live' || integration.metadata.get('templateId') === 'gemini_live'
      : integration.metadata?.provider === 'google_gemini_live' || integration.metadata?.templateId === 'gemini_live');

  if (isGeminiLive) {
    if (!integration.availableModels || integration.availableModels.length === 0) {
      integration.availableModels = GEMINI_AVAILABLE_MODELS;
    }
    if (!integration.availableVoices || integration.availableVoices.length === 0) {
      integration.availableVoices = GEMINI_AVAILABLE_VOICES;
    }
    if (!integration.availableLanguages || integration.availableLanguages.length === 0) {
      integration.availableLanguages = GEMINI_AVAILABLE_LANGUAGES;
    }
    if (integration.metadata instanceof Map) {
      if (!integration.metadata.get('templateId')) integration.metadata.set('templateId', 'gemini_live');
      if (!integration.metadata.get('provider')) integration.metadata.set('provider', 'google_gemini_live');
      if (!integration.metadata.get('model')) integration.metadata.set('model', 'gemini-3.1-flash-live-preview');
    } else {
      if (!integration.metadata) integration.metadata = {};
      if (!integration.metadata.templateId) integration.metadata.templateId = 'gemini_live';
      if (!integration.metadata.provider) integration.metadata.provider = 'google_gemini_live';
      if (!integration.metadata.model) integration.metadata.model = 'gemini-3.1-flash-live-preview';
    }
  }
};

const getS2STemplateConfig = ({ templateId, apiKey, customName, createdBy }) => {
  if (templateId !== GEMINI_S2S_TEMPLATE_ID) {
    return null;
  }

  return {
    name: customName || 'Google Gemini 3.1 Flash Live Preview',
    type: 's2s',
    description: 'Low-latency audio-to-audio Gemini Live integration for real-time calls',
    baseUrl:
      'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent',
    authType: 'bearer_token',
    authConfig: {
      // Stored as token for compatibility with existing auth UI/forms
      token: apiKey,
    },
    requestMethod: 'POST',
    contentType: 'application/json',
    responseType: 'stream',
    timeout: 30000,
    retryAttempts: 2,
    isActive: true,
    isDefault: false,
    createdBy,
    availableModels: GEMINI_AVAILABLE_MODELS,
    availableVoices: GEMINI_AVAILABLE_VOICES,
    availableLanguages: GEMINI_AVAILABLE_LANGUAGES,
    metadata: {
      templateId: GEMINI_S2S_TEMPLATE_ID,
      provider: 'google_gemini_live',
      model: 'gemini-3.1-flash-live-preview',
      thinkingLevel: 'minimal',
      liveApiVersion: 'v1beta',
    },
  };
};

// Get all integrations (admin only)
export const getAll = async (req, res, next) => {
  try {
    const integrations = await Integration.find()
      .populate('createdBy', 'name email')
      .sort({ type: 1, createdAt: -1 });

    // Hide sensitive auth data
    const safeIntegrations = integrations.map(integration => integration.toSafeObject());

    res.json({
      success: true,
      data: safeIntegrations
    });
  } catch (error) {
    next(error);
  }
};

// Get integrations by type (admin only)
export const getByType = async (req, res, next) => {
  try {
    const { type } = req.params;

    const integrations = await Integration.find({ type })
      .populate('createdBy', 'name email')
      .sort({ isDefault: -1, createdAt: -1 });

    // Hide sensitive auth data
    const safeIntegrations = integrations.map(integration => integration.toSafeObject());

    res.json({
      success: true,
      data: safeIntegrations
    });
  } catch (error) {
    next(error);
  }
};

// Get active integrations by type (available to all authenticated users)
export const getActiveByType = async (req, res, next) => {
  try {
    const { type } = req.params;

    const integrations = await Integration.find({ type, isActive: true })
      .select('name description type availableModels availableVoices availableLanguages isDefault metadata')
      .sort({ isDefault: -1, name: 1 });

    res.json({
      success: true,
      data: integrations.map((integration) => integration.toSafeObject())
    });
  } catch (error) {
    next(error);
  }
};

// Get single integration (admin only)
export const getOne = async (req, res, next) => {
  try {
    const integration = await Integration.findById(req.params.id)
      .populate('createdBy', 'name email');

    if (!integration) {
      return res.status(404).json({
        success: false,
        message: 'Integration not found'
      });
    }

    res.json({
      success: true,
      data: integration
    });
  } catch (error) {
    next(error);
  }
};

// Create new integration (admin only)
export const create = async (req, res, next) => {
  try {
    const integrationData = {
      ...req.body,
      createdBy: req.user._id
    };

    autoHealS2SIntegration(integrationData);

    const integration = await Integration.create(integrationData);

    res.status(201).json({
      success: true,
      data: integration.toSafeObject(),
      message: 'Integration created successfully'
    });
  } catch (error) {
    next(error);
  }
};

// Create S2S integration from a predefined template (admin only)
export const createFromTemplate = async (req, res, next) => {
  try {
    const { templateId } = req.params;
    const { apiKey, customName } = req.body || {};

    if (!apiKey || !apiKey.trim()) {
      return res.status(400).json({
        success: false,
        message: 'API key is required',
      });
    }

    const templateConfig = getS2STemplateConfig({
      templateId,
      apiKey: apiKey.trim(),
      customName: customName?.trim(),
      createdBy: req.user._id,
    });

    if (!templateConfig) {
      return res.status(400).json({
        success: false,
        message: `Unsupported S2S template: ${templateId}`,
      });
    }

    const integration = await Integration.create(templateConfig);

    res.status(201).json({
      success: true,
      data: integration.toSafeObject(),
      message: 'Template integration created successfully',
    });
  } catch (error) {
    next(error);
  }
};

// Update integration (admin only)
export const update = async (req, res, next) => {
  try {
    const integration = await Integration.findById(req.params.id);
    const updates = req.body || {};

    if (!integration) {
      return res.status(404).json({
        success: false,
        message: 'Integration not found'
      });
    }

    // Update fields
    Object.keys(updates).forEach(key => {
      if (key !== 'createdBy' && key !== '_id') {
        if (key === 'authConfig') {
          const existingConfig = integration.authConfig || {};
          const newConfig = updates.authConfig || {};
          
          if (newConfig.token === '***') newConfig.token = existingConfig.token;
          if (newConfig.password === '***') newConfig.password = existingConfig.password;
          if (newConfig.headerValue === '***') newConfig.headerValue = existingConfig.headerValue;
          
          integration.authConfig = newConfig;
        } else {
          integration[key] = updates[key];
        }
      }
    });

    autoHealS2SIntegration(integration);

    await integration.save();

    res.json({
      success: true,
      data: integration.toSafeObject(),
      message: 'Integration updated successfully'
    });
  } catch (error) {
    next(error);
  }
};

// Refresh an existing integration from a template (admin only)
export const updateFromTemplate = async (req, res, next) => {
  try {
    const { integrationId } = req.params;
    const { templateId, apiKey } = req.body || {};

    if (!templateId) {
      return res.status(400).json({
        success: false,
        message: 'templateId is required',
      });
    }

    const integration = await Integration.findById(integrationId);
    if (!integration) {
      return res.status(404).json({
        success: false,
        message: 'Integration not found',
      });
    }

    const effectiveApiKey = (apiKey || integration.authConfig?.token || '').trim();
    if (!effectiveApiKey) {
      return res.status(400).json({
        success: false,
        message: 'API key is required to apply this template',
      });
    }

    const templateConfig = getS2STemplateConfig({
      templateId,
      apiKey: effectiveApiKey,
      customName: integration.name,
      createdBy: integration.createdBy,
    });

    if (!templateConfig) {
      return res.status(400).json({
        success: false,
        message: `Unsupported S2S template: ${templateId}`,
      });
    }

    // Keep existing identity/default flags while refreshing template-driven config.
    integration.description = templateConfig.description;
    integration.type = templateConfig.type;
    integration.baseUrl = templateConfig.baseUrl;
    integration.authType = templateConfig.authType;
    integration.authConfig = templateConfig.authConfig;
    integration.requestMethod = templateConfig.requestMethod;
    integration.contentType = templateConfig.contentType;
    integration.responseType = templateConfig.responseType;
    integration.timeout = templateConfig.timeout;
    integration.retryAttempts = templateConfig.retryAttempts;
    integration.availableModels = templateConfig.availableModels;
    integration.availableVoices = templateConfig.availableVoices;
    integration.availableLanguages = templateConfig.availableLanguages;
    integration.metadata = templateConfig.metadata;
    integration.isActive = true;

    await integration.save();

    res.json({
      success: true,
      data: integration.toSafeObject(),
      message: 'Integration updated from template successfully',
    });
  } catch (error) {
    next(error);
  }
};

// Delete integration (admin only)
export const deleteIntegration = async (req, res, next) => {
  try {
    const integration = await Integration.findById(req.params.id);

    if (!integration) {
      return res.status(404).json({
        success: false,
        message: 'Integration not found'
      });
    }

    await integration.deleteOne();

    res.json({
      success: true,
      message: 'Integration deleted successfully'
    });
  } catch (error) {
    next(error);
  }
};

// Set integration as default (admin only)
export const setDefault = async (req, res, next) => {
  try {
    const integration = await Integration.findById(req.params.id);

    if (!integration) {
      return res.status(404).json({
        success: false,
        message: 'Integration not found'
      });
    }

    // Unset other defaults of the same type
    await Integration.updateMany(
      { type: integration.type, _id: { $ne: integration._id } },
      { isDefault: false }
    );

    integration.isDefault = true;
    await integration.save();

    res.json({
      success: true,
      data: integration.toSafeObject(),
      message: 'Integration set as default successfully'
    });
  } catch (error) {
    next(error);
  }
};

// Test integration (admin only)
export const test = async (req, res, next) => {
  try {
    const { testInput } = req.body || {};

    const integration = await Integration.findById(req.params.id);

    if (!integration) {
      return res.status(404).json({
        success: false,
        message: 'Integration not found'
      });
    }

    // S2S providers like Gemini Live are websocket-based and are not compatible
    // with the generic HTTP integration executor. Validate configuration instead.
    if (integration.type === 's2s') {
      autoHealS2SIntegration(integration);

      const apiKey = integration.authConfig?.token?.trim();
      const baseUrl = integration.baseUrl?.trim();

      const isGeminiLive = Boolean(
        (baseUrl && /generativelanguage\.googleapis\.com/i.test(baseUrl)) ||
        integration.description?.toLowerCase().includes('gemini') ||
        integration.name?.toLowerCase().includes('gemini') ||
        (integration.metadata instanceof Map
          ? integration.metadata.get('provider') === 'google_gemini_live'
          : integration.metadata?.provider === 'google_gemini_live')
      );
      const isOpenAiRealtime = Boolean(baseUrl && /api\.openai\.com/i.test(baseUrl));

      const defaultFallbackModel = isGeminiLive
        ? 'gemini-3.1-flash-live-preview'
        : isOpenAiRealtime
        ? 'gpt-4o-realtime-preview'
        : 'default';

      const model =
        (integration.metadata instanceof Map ? integration.metadata.get('model') : integration.metadata?.model) ||
        integration.availableModels?.[0]?.id ||
        defaultFallbackModel;

      const checks = {
        hasApiKey: Boolean(apiKey),
        hasWsBaseUrl: Boolean(baseUrl && /^wss?:\/\//i.test(baseUrl)),
        hasModel: Boolean(model),
      };
      const failedChecks = Object.entries(checks)
        .filter(([, passed]) => !passed)
        .map(([name]) => name);

      const validationSuccess = failedChecks.length === 0;
      const validationMessage = validationSuccess
        ? 'S2S configuration is valid. Runtime connectivity is tested during an actual Twilio media-stream call.'
        : `S2S configuration validation failed: ${failedChecks.join(', ')}`;

      integration.lastTested = new Date();
      integration.testStatus = validationSuccess ? 'success' : 'failed';
      integration.testMessage = validationMessage;
      await integration.save();

      return res.json({
        success: true,
        data: {
          success: validationSuccess,
          latency: 0,
          mode: 'configuration_validation',
          checks,
          message: validationMessage,
        },
      });
    }

    // Prepare test input based on type
    const defaultTestInput = {};

    const input = testInput || defaultTestInput;
    const startTime = Date.now();

    const result = await integrationExecutor.execute(req.params.id, input);

    const latency = Date.now() - startTime;

    // Update integration test status
    integration.lastTested = new Date();
    integration.testStatus = result.success ? 'success' : 'failed';
    integration.testMessage = result.success
      ? `Test successful (${latency}ms)`
      : `Test failed: ${result.error}`;
    await integration.save();

    res.json({
      success: true,
      data: {
        ...result,
        latency,
        message: integration.testMessage
      }
    });
  } catch (error) {
    // Update integration with failed test status
    try {
      const integration = await Integration.findById(req.params.id);
      if (integration) {
        integration.lastTested = new Date();
        integration.testStatus = 'failed';
        integration.testMessage = error.message;
        await integration.save();
      }
    } catch (e) {
      console.error('Failed to update test status:', e);
    }

    next(error);
  }
};
