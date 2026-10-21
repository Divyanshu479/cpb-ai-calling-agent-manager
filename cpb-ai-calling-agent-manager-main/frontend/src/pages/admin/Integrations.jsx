import { useState, useEffect } from 'react';
import axios from '../../utils/axios';
import toast from 'react-hot-toast';
import ConfirmDialog from '../../components/common/ConfirmDialog';
import SkeletonLoader from '../../components/common/SkeletonLoader';

// Pre-configured S2S Templates
const S2S_TEMPLATES = [
  {
    id: 'openai_realtime',
    name: 'OpenAI GPT-4o Realtime',
    description: 'Low-latency voice conversations with advanced reasoning',
    icon: '🤖',
    color: 'from-green-500 to-emerald-600',
    features: ['6 voice options', '10+ languages', 'WebSocket streaming'],
  },
  {
    id: 'gemini_live',
    name: 'Google Gemini 3.8 Live',
    description: 'Low-latency audio-to-audio model for real-time dialogue',
    icon: '✨',
    color: 'from-blue-500 to-cyan-600',
    features: ['Native audio output', 'Low-latency turn taking', 'Function calling support'],
  },
  {
    id: 'elevenlabs_conversational',
    name: 'ElevenLabs Conversational',
    description: 'Ultra-realistic voices with emotion',
    icon: '🎭',
    color: 'from-purple-500 to-pink-600',
    features: ['8+ voices', 'Voice cloning', 'Low latency'],
  },
  {
    id: 'hume_evi',
    name: 'Hume AI EVI',
    description: 'Emotionally intelligent voice interface',
    icon: '💜',
    color: 'from-violet-500 to-purple-600',
    features: ['Emotion detection', 'Adaptive responses', '6 voices'],
  },
  {
    id: 'vapi',
    name: 'Vapi Voice AI',
    description: 'Multi-LLM voice agent platform',
    icon: '📞',
    color: 'from-orange-500 to-red-600',
    features: ['Multiple LLMs', 'Multiple TTS', 'Telephony built-in'],
  },
  {
    id: 'retell',
    name: 'Retell AI',
    description: 'Production-ready voice agents',
    icon: '🚀',
    color: 'from-indigo-500 to-blue-600',
    features: ['Production-ready', 'Analytics', 'Call recording'],
  },
];

const Integrations = () => {
  const [activeTab, setActiveTab] = useState('s2s');
  const [integrations, setIntegrations] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingIntegration, setEditingIntegration] = useState(null);
  const [formData, setFormData] = useState({});
  const [confirmDialog, setConfirmDialog] = useState({ isOpen: false, onConfirm: null, title: '', message: '' });
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [templateApiKey, setTemplateApiKey] = useState('');
  const [templateCustomName, setTemplateCustomName] = useState('');
  const [creatingFromTemplate, setCreatingFromTemplate] = useState(false);

  useEffect(() => {
    fetchIntegrations();
  }, [activeTab]);

  const fetchIntegrations = async () => {
    try {
      setLoading(true);
      const response = await axios.get(`/integrations/type/${activeTab}`);
      setIntegrations(response.data.data);
    } catch (error) {
      console.error('Error fetching integrations:', error);
      toast.error(error.response?.data?.message || 'Failed to fetch integrations');
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = () => {
    setEditingIntegration(null);
    setFormData(getDefaultFormData());
    setShowForm(true);
  };

  const handleTemplateClick = (template) => {
    setSelectedTemplate(template);
    setTemplateApiKey('');
    setTemplateCustomName('');
    setShowTemplateModal(true);
  };

  const handleCreateFromTemplate = async () => {
    console.log('[Integrations] handleCreateFromTemplate called', {
      selectedTemplate: selectedTemplate?.id,
      hasApiKey: !!templateApiKey.trim()
    });

    if (!templateApiKey.trim()) {
      toast.error('Please enter your API key');
      return;
    }

    setCreatingFromTemplate(true);
    const toastId = toast.loading(`Setting up ${selectedTemplate.name}...`);

    try {
      const url = `/integrations/templates/s2s/${selectedTemplate.id}/create`;
      console.log('[Integrations] Making POST request to:', url);

      const response = await axios.post(url, {
        apiKey: templateApiKey,
        customName: templateCustomName || undefined,
      });

      console.log('[Integrations] Success response:', response.data);
      toast.success(`${selectedTemplate.name} integration created successfully!`, { id: toastId });
      setShowTemplateModal(false);
      setSelectedTemplate(null);
      setTemplateApiKey('');
      setTemplateCustomName('');

      // Switch to s2s tab to show the new integration
      setActiveTab('s2s');
    } catch (error) {
      console.error('[Integrations] Error creating from template:', error);
      console.error('[Integrations] Error response:', error.response?.data);
      toast.error(error.response?.data?.message || 'Failed to create integration', { id: toastId });
    } finally {
      setCreatingFromTemplate(false);
    }
  };

  const handleEdit = (integration) => {
    setEditingIntegration(integration);
    setFormData({
      name: integration.name,
      description: integration.description || '',
      baseUrl: integration.baseUrl,
      authType: integration.authType,
      requestMethod: integration.requestMethod,
      contentType: integration.contentType,
      requestBodyTemplate: integration.requestBodyTemplate || '',
      responseType: integration.responseType,
      resultPath: integration.responseMapping?.resultPath || '',
      errorPath: integration.responseMapping?.errorPath || '',
      usagePath: integration.responseMapping?.usagePath || '',
      timeout: integration.timeout,
      retryAttempts: integration.retryAttempts,
    });
    setShowForm(true);
  };

  const handleDelete = (id) => {
    setConfirmDialog({
      isOpen: true,
      title: 'Delete Integration',
      message: 'Are you sure you want to delete this integration? This action cannot be undone.',
      variant: 'danger',
      onConfirm: async () => {
        try {
          await axios.delete(`/integrations/${id}`);
          toast.success('Integration deleted successfully');
          fetchIntegrations();
        } catch (error) {
          toast.error(error.response?.data?.message || 'Failed to delete integration');
        }
      }
    });
  };

  const handleSetDefault = async (id) => {
    try {
      await axios.put(`/integrations/${id}/set-default`);
      toast.success('Default integration updated successfully');
      fetchIntegrations();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to set default integration');
    }
  };

  const handleTest = async (id) => {
    const toastId = toast.loading('Testing integration...');
    try {
      const response = await axios.post(`/integrations/${id}/test`);
      const data = response.data.data;

      if (data.success) {
        toast.success(
          data.latency
            ? `Integration test successful! Latency: ${data.latency}ms`
            : data.message || 'Integration test successful!',
          { id: toastId, duration: 4000 }
        );
      } else {
        toast.error(
          `Test failed: ${data.message || data.error}`,
          { id: toastId, duration: 5000 }
        );
      }
      fetchIntegrations();
    } catch (error) {
      toast.error(
        error.response?.data?.message || 'Test failed',
        { id: toastId }
      );
    }
  };

  // Find matching template for an integration (for S2S update from template)
  const findMatchingTemplate = (integration) => {
    if (integration.type !== 's2s') return null;
    const lowerName = (integration.name || '').toLowerCase();
    const lowerDesc = (integration.description || '').toLowerCase();
    const lowerBaseUrl = (integration.baseUrl || '').toLowerCase();
    return S2S_TEMPLATES.find(t =>
      lowerName.includes(t.id.replace(/_/g, ' ')) ||
      lowerName.includes(t.name.toLowerCase().split(' ')[0]) ||
      (t.id === 'gemini_live' && (lowerDesc.includes('gemini') || lowerBaseUrl.includes('generativelanguage'))) ||
      (t.id === 'openai_realtime' && (lowerDesc.includes('openai') || lowerBaseUrl.includes('openai.com')))
    );
  };

  const handleUpdateFromTemplate = async (integrationId, templateId) => {
    const toastId = toast.loading('Updating integration with latest template...');
    try {
      await axios.put(`/integrations/${integrationId}/update-from-template`, {
        templateId
      });
      toast.success('Integration updated with latest template configuration!', { id: toastId });
      fetchIntegrations();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to update integration', { id: toastId });
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    try {
      const payload = {
        name: formData.name,
        type: activeTab,
        description: formData.description,
        baseUrl: formData.baseUrl,
        authType: formData.authType,
        authConfig: {
          token: formData.authToken || undefined,
          headerName: formData.authHeaderName || undefined,
          headerValue: formData.authHeaderValue || undefined,
          username: formData.authUsername || undefined,
          password: formData.authPassword || undefined,
        },
        requestMethod: formData.requestMethod,
        contentType: formData.contentType,
        requestBodyTemplate: formData.requestBodyTemplate,
        responseType: formData.responseType,
        responseMapping: {
          resultPath: formData.resultPath,
          errorPath: formData.errorPath,
          usagePath: formData.usagePath,
        },
        timeout: parseInt(formData.timeout),
        retryAttempts: parseInt(formData.retryAttempts),
      };

      if (editingIntegration) {
        await axios.put(`/integrations/${editingIntegration._id}`, payload);
        toast.success('Integration updated successfully');
      } else {
        await axios.post('/integrations', payload);
        toast.success('Integration created successfully');
      }

      setShowForm(false);
      fetchIntegrations();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to save integration');
    }
  };

  const getDefaultFormData = () => {
    return {
      name: '',
      description: '',
      baseUrl: '',
      authType: 'bearer_token',
      authToken: '',
      authHeaderName: '',
      authHeaderValue: '',
      authUsername: '',
      authPassword: '',
      requestMethod: 'POST',
      contentType: 'application/json',
      requestBodyTemplate: '',
      responseType: 'json',
      resultPath: '',
      errorPath: '',
      usagePath: '',
      timeout: 30000,
      retryAttempts: 3,
    };
  };

  const getTemplateExample = () => {
    switch (activeTab) {
      case 's2s':
        return '{"input_audio": "{{inputAudio}}", "voice": "{{voiceId}}", "instructions": "{{systemPrompt}}", "conversation_history": {{{conversationHistory}}}}';
      default:
        return '{}';
    }
  };

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-4xl font-bold gradient-text mb-2">Custom Integrations</h1>
        <p className="text-gray-600">Configure integrations for Speech-to-Speech and Telephony providers</p>
      </div>

      {/* Tabs */}
      <div className="mb-8">
        <div className="glass rounded-2xl p-2 inline-flex space-x-2 shadow-lg flex-wrap">
          <button
            onClick={() => setActiveTab('s2s')}
            className={`px-6 py-3 rounded-xl font-semibold text-sm transition-all duration-200 ${
              activeTab === 's2s'
                ? 'bg-gradient-to-r from-purple-500 to-pink-600 text-white shadow-lg'
                : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            🎙️ Speech-to-Speech
          </button>
          <button
            onClick={() => setActiveTab('telephony')}
            className={`px-6 py-3 rounded-xl font-semibold text-sm transition-all duration-200 ${
              activeTab === 'telephony'
                ? 'bg-gradient-to-r from-blue-500 to-indigo-600 text-white shadow-lg'
                : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            📞 Telephony
          </button>
          {[
            ['stt', '🎧 STT'],
            ['llm', '🧠 LLM'],
            ['tts', '🔊 TTS'],
          ].map(([type, label]) => (
            <button
              key={type}
              onClick={() => setActiveTab(type)}
              className={`px-6 py-3 rounded-xl font-semibold text-sm transition-all duration-200 ${
                activeTab === type
                  ? 'bg-gradient-to-r from-emerald-500 to-teal-600 text-white shadow-lg'
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* S2S Info Banner and Quick Setup Templates */}
      {activeTab === 's2s' && (
        <>
          <div className="mb-6 p-4 bg-gradient-to-r from-purple-50 to-pink-50 border border-purple-200 rounded-xl">
            <div className="flex items-start">
              <div className="text-2xl mr-3">🎙️</div>
              <div>
                <h3 className="font-semibold text-purple-900">Speech-to-Speech Models</h3>
                <p className="text-sm text-purple-700 mt-1">
                  S2S models process voice input and generate voice output in a single step, enabling lower latency
                  and more natural conversations. Configure your S2S integrations here to use them with AI Callers.
                </p>
              </div>
            </div>
          </div>

          {/* Quick Setup Templates */}
          <div className="mb-8">
            <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center">
              <span className="mr-2">⚡</span>
              Quick Setup - Pre-configured Providers
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {S2S_TEMPLATES.map((template) => (
                <div
                  key={template.id}
                  onClick={() => handleTemplateClick(template)}
                  className="relative overflow-hidden rounded-xl border-2 border-gray-200 hover:border-purple-400 cursor-pointer transition-all duration-200 hover:shadow-lg group"
                >
                  <div className={`absolute inset-0 bg-gradient-to-br ${template.color} opacity-0 group-hover:opacity-10 transition-opacity`} />
                  <div className="p-4">
                    <div className="flex items-center mb-2">
                      <span className="text-2xl mr-2">{template.icon}</span>
                      <h4 className="font-bold text-gray-900">{template.name}</h4>
                    </div>
                    <p className="text-sm text-gray-600 mb-3">{template.description}</p>
                    <div className="flex flex-wrap gap-1">
                      {template.features.map((feature, idx) => (
                        <span
                          key={idx}
                          className="px-2 py-0.5 bg-gray-100 text-gray-600 text-xs rounded-full"
                        >
                          {feature}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className={`h-1 bg-gradient-to-r ${template.color}`} />
                </div>
              ))}
            </div>
          </div>

          <hr className="mb-6 border-gray-200" />
        </>
      )}

      {/* Add Integration Button */}
      <div className="mb-6">
        <button
          onClick={handleCreate}
          className="px-6 py-3 bg-gradient-to-r from-green-600 to-emerald-600 text-white rounded-xl hover:from-green-700 hover:to-emerald-700 transition-all duration-200 shadow-lg hover:shadow-xl transform hover:-translate-y-0.5 font-semibold flex items-center"
        >
          <svg className="w-5 h-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Add {activeTab.toUpperCase()} Integration
        </button>
      </div>

      {/* Integrations List */}
      {loading && integrations.length === 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <SkeletonLoader type="card" count={6} />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {integrations.map((integration) => (
            <div
              key={integration._id}
              className={`modern-card p-6 ${
                integration.isDefault ? 'ring-2 ring-blue-500 shadow-2xl' : ''
              }`}
            >
              <div className="flex justify-between items-start mb-4">
                <div>
                  <h3 className="text-lg font-bold text-gray-900">{integration.name}</h3>
                  <p className="text-sm text-gray-500 mt-1">{integration.description || 'No description'}</p>
                </div>
                {integration.isDefault && (
                  <span className="px-3 py-1 bg-gradient-to-r from-blue-500 to-indigo-600 text-white text-xs font-bold rounded-full shadow-lg">
                    Default
                  </span>
                )}
              </div>

              <div className="mb-4 space-y-2 text-sm">
                <div className="text-gray-700 flex items-center">
                  <svg className="w-4 h-4 mr-2 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  Method: <span className="font-semibold ml-1">{integration.requestMethod}</span>
                </div>
                <div className="text-gray-700 flex items-center truncate">
                  <svg className="w-4 h-4 mr-2 text-green-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                  </svg>
                  <span className="truncate">{integration.baseUrl}</span>
                </div>
                {integration.testStatus && (
                  <div
                    className={`flex items-center ${
                      integration.testStatus === 'success'
                        ? 'text-green-600'
                        : integration.testStatus === 'failed'
                        ? 'text-red-600'
                        : 'text-gray-600'
                    }`}
                  >
                    {integration.testStatus === 'success' ? (
                      <svg className="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    ) : (
                      <svg className="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    )}
                    Last Test: {integration.testStatus}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => handleTest(integration._id)}
                  className="px-3 py-2 bg-gradient-to-r from-green-500 to-emerald-600 text-white text-sm rounded-lg hover:from-green-600 hover:to-emerald-700 transition-all shadow-md hover:shadow-lg font-semibold"
                >
                  Test
                </button>
                {!integration.isDefault && (
                  <button
                    onClick={() => handleSetDefault(integration._id)}
                    className="px-3 py-2 bg-gradient-to-r from-blue-500 to-indigo-600 text-white text-sm rounded-lg hover:from-blue-600 hover:to-indigo-700 transition-all shadow-md hover:shadow-lg font-semibold"
                  >
                    Set Default
                  </button>
                )}
                <button
                  onClick={() => handleEdit(integration)}
                  className="px-3 py-2 bg-gradient-to-r from-gray-600 to-gray-700 text-white text-sm rounded-lg hover:from-gray-700 hover:to-gray-800 transition-all shadow-md hover:shadow-lg font-semibold"
                >
                  Edit
                </button>
                <button
                  onClick={() => handleDelete(integration._id)}
                  className="px-3 py-2 bg-gradient-to-r from-red-500 to-pink-600 text-white text-sm rounded-lg hover:from-red-600 hover:to-pink-700 transition-all shadow-md hover:shadow-lg font-semibold"
                >
                  Delete
                </button>
                {/* Update from Template button for S2S integrations */}
                {integration.type === 's2s' && findMatchingTemplate(integration) && (
                  <button
                    onClick={() => handleUpdateFromTemplate(integration._id, findMatchingTemplate(integration).id)}
                    className="col-span-2 px-3 py-2 bg-gradient-to-r from-purple-500 to-pink-600 text-white text-sm rounded-lg hover:from-purple-600 hover:to-pink-700 transition-all shadow-md hover:shadow-lg font-semibold flex items-center justify-center"
                    title="Update with latest template configuration (fixes and improvements)"
                  >
                    <svg className="w-4 h-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    Update from Template
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {integrations.length === 0 && !loading && (
        <div className="text-center py-16">
          <div className="glass rounded-3xl p-12 max-w-md mx-auto">
            <div className="text-6xl mb-4">⚙️</div>
            <h3 className="text-xl font-bold text-gray-900 mb-2">No Integrations Yet</h3>
            <p className="text-gray-500">
              No {activeTab.toUpperCase()} integrations configured. Add one to get started with custom providers.
            </p>
          </div>
        </div>
      )}

      {/* Form Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="modern-card max-w-4xl w-full max-h-[90vh] flex flex-col">
            <div className="px-6 py-5 border-b border-gray-200 flex justify-between items-center bg-white rounded-t-2xl flex-shrink-0">
              <h3 className="text-xl font-bold gradient-text">
                {editingIntegration ? 'Edit' : 'Add'} {activeTab.toUpperCase()} Integration
              </h3>
              <button
                onClick={() => setShowForm(false)}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-6 overflow-y-auto flex-1">
              {/* Basic Info */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Integration Name *</label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50/50"
                    placeholder="My Custom Integration"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Description</label>
                  <input
                    type="text"
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50/50"
                    placeholder="Optional description"
                  />
                </div>
              </div>

              {/* Connection */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Base URL *</label>
                <input
                  type="url"
                  value={formData.baseUrl}
                  onChange={(e) => setFormData({ ...formData, baseUrl: e.target.value })}
                  className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50/50"
                  placeholder="https://api.example.com/v1/endpoint"
                  required
                />
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Request Method</label>
                  <select
                    value={formData.requestMethod}
                    onChange={(e) => setFormData({ ...formData, requestMethod: e.target.value })}
                    className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50/50"
                  >
                    <option value="POST">POST</option>
                    <option value="GET">GET</option>
                    <option value="PUT">PUT</option>
                    <option value="PATCH">PATCH</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Content Type</label>
                  <select
                    value={formData.contentType}
                    onChange={(e) => setFormData({ ...formData, contentType: e.target.value })}
                    className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50/50"
                  >
                    <option value="application/json">JSON</option>
                    <option value="multipart/form-data">Multipart</option>
                    <option value="application/x-www-form-urlencoded">Form URL Encoded</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Response Type</label>
                  <select
                    value={formData.responseType}
                    onChange={(e) => setFormData({ ...formData, responseType: e.target.value })}
                    className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50/50"
                  >
                    <option value="json">JSON</option>
                    <option value="binary">Binary</option>
                    <option value="text">Text</option>
                  </select>
                </div>
              </div>

              {/* Authentication */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Authentication Type</label>
                <select
                  value={formData.authType}
                  onChange={(e) => setFormData({ ...formData, authType: e.target.value })}
                  className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50/50"
                >
                  <option value="none">None</option>
                  <option value="bearer_token">Bearer Token</option>
                  <option value="api_key_header">API Key Header</option>
                  <option value="basic_auth">Basic Auth</option>
                  <option value="custom_header">Custom Header</option>
                </select>
              </div>

              {formData.authType === 'bearer_token' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Bearer Token</label>
                  <input
                    type="password"
                    value={formData.authToken}
                    onChange={(e) => setFormData({ ...formData, authToken: e.target.value })}
                    className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50/50"
                    placeholder="Your API token"
                  />
                </div>
              )}

              {(formData.authType === 'api_key_header' || formData.authType === 'custom_header') && (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Header Name</label>
                    <input
                      type="text"
                      value={formData.authHeaderName}
                      onChange={(e) => setFormData({ ...formData, authHeaderName: e.target.value })}
                      className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50/50"
                      placeholder="X-API-Key"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Header Value</label>
                    <input
                      type="password"
                      value={formData.authHeaderValue}
                      onChange={(e) => setFormData({ ...formData, authHeaderValue: e.target.value })}
                      className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50/50"
                      placeholder="Your API key"
                    />
                  </div>
                </div>
              )}

              {formData.authType === 'basic_auth' && (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Username</label>
                    <input
                      type="text"
                      value={formData.authUsername}
                      onChange={(e) => setFormData({ ...formData, authUsername: e.target.value })}
                      className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50/50"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Password</label>
                    <input
                      type="password"
                      value={formData.authPassword}
                      onChange={(e) => setFormData({ ...formData, authPassword: e.target.value })}
                      className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50/50"
                    />
                  </div>
                </div>
              )}

              {/* Request Template */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Request Body Template (Handlebars)
                </label>
                <textarea
                  value={formData.requestBodyTemplate}
                  onChange={(e) => setFormData({ ...formData, requestBodyTemplate: e.target.value })}
                  className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50/50 font-mono text-sm"
                  rows="6"
                  placeholder={getTemplateExample()}
                />
                <p className="text-xs text-gray-500 mt-1">Example: {getTemplateExample()}</p>
              </div>

              {/* Response Mapping */}
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Result JSONPath</label>
                  <input
                    type="text"
                    value={formData.resultPath}
                    onChange={(e) => setFormData({ ...formData, resultPath: e.target.value })}
                    className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50/50 font-mono text-sm"
                    placeholder="$.data.result"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Error JSONPath</label>
                  <input
                    type="text"
                    value={formData.errorPath}
                    onChange={(e) => setFormData({ ...formData, errorPath: e.target.value })}
                    className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50/50 font-mono text-sm"
                    placeholder="$.error.message"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Usage JSONPath</label>
                  <input
                    type="text"
                    value={formData.usagePath}
                    onChange={(e) => setFormData({ ...formData, usagePath: e.target.value })}
                    className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50/50 font-mono text-sm"
                    placeholder="$.usage"
                  />
                </div>
              </div>

              {/* Settings */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Timeout (ms)</label>
                  <input
                    type="number"
                    value={formData.timeout}
                    onChange={(e) => setFormData({ ...formData, timeout: e.target.value })}
                    className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50/50"
                    min="1000"
                    max="300000"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Retry Attempts</label>
                  <input
                    type="number"
                    value={formData.retryAttempts}
                    onChange={(e) => setFormData({ ...formData, retryAttempts: e.target.value })}
                    className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50/50"
                    min="0"
                    max="10"
                  />
                </div>
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  type="submit"
                  className="flex-1 px-6 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-xl hover:from-blue-700 hover:to-indigo-700 transition-all shadow-lg hover:shadow-xl font-semibold"
                >
                  {editingIntegration ? 'Update' : 'Create'} Integration
                </button>
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="px-6 py-3 bg-gray-100 text-gray-700 rounded-xl hover:bg-gray-200 transition-all font-semibold"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Confirm Dialog */}
      <ConfirmDialog
        isOpen={confirmDialog.isOpen}
        onClose={() => setConfirmDialog({ ...confirmDialog, isOpen: false })}
        onConfirm={confirmDialog.onConfirm}
        title={confirmDialog.title}
        message={confirmDialog.message}
        variant={confirmDialog.variant}
      />

      {/* Template Setup Modal */}
      {showTemplateModal && selectedTemplate && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="modern-card max-w-lg w-full">
            <div className="px-6 py-5 border-b border-gray-200 flex justify-between items-center bg-white rounded-t-2xl">
              <div className="flex items-center">
                <span className="text-2xl mr-3">{selectedTemplate.icon}</span>
                <div>
                  <h3 className="text-xl font-bold gradient-text">Setup {selectedTemplate.name}</h3>
                  <p className="text-sm text-gray-500">{selectedTemplate.description}</p>
                </div>
              </div>
              <button
                onClick={() => {
                  setShowTemplateModal(false);
                  setSelectedTemplate(null);
                }}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
                <div className="flex items-start">
                  <svg className="w-5 h-5 text-blue-600 mr-2 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <div className="text-sm text-blue-800">
                    <p className="font-medium">Get your API key</p>
                    <p className="mt-1 text-blue-700">
                      {selectedTemplate.id === 'openai_realtime' && 'Visit platform.openai.com/api-keys'}
                      {selectedTemplate.id === 'gemini_live' && 'Visit aistudio.google.com/apikey'}
                      {selectedTemplate.id === 'elevenlabs_conversational' && 'Visit elevenlabs.io/app/settings/api-keys'}
                      {selectedTemplate.id === 'hume_evi' && 'Visit beta.hume.ai/settings/keys'}
                      {selectedTemplate.id === 'vapi' && 'Visit vapi.ai dashboard'}
                      {selectedTemplate.id === 'retell' && 'Visit retellai.com dashboard'}
                    </p>
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  API Key *
                </label>
                <input
                  type="password"
                  value={templateApiKey}
                  onChange={(e) => setTemplateApiKey(e.target.value)}
                  className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500 bg-gray-50/50"
                  placeholder="Enter your API key"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Custom Name (Optional)
                </label>
                <input
                  type="text"
                  value={templateCustomName}
                  onChange={(e) => setTemplateCustomName(e.target.value)}
                  className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500 bg-gray-50/50"
                  placeholder={selectedTemplate.name}
                />
              </div>

              <div className="flex flex-wrap gap-2 pt-2">
                {selectedTemplate.features.map((feature, idx) => (
                  <span
                    key={idx}
                    className="px-3 py-1 bg-purple-100 text-purple-700 text-sm rounded-full"
                  >
                    {feature}
                  </span>
                ))}
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  onClick={handleCreateFromTemplate}
                  disabled={creatingFromTemplate || !templateApiKey.trim()}
                  className={`flex-1 px-6 py-3 bg-gradient-to-r ${selectedTemplate.color} text-white rounded-xl transition-all shadow-lg hover:shadow-xl font-semibold disabled:opacity-50 disabled:cursor-not-allowed`}
                >
                  {creatingFromTemplate ? (
                    <span className="flex items-center justify-center">
                      <svg className="animate-spin -ml-1 mr-2 h-5 w-5 text-white" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      Creating...
                    </span>
                  ) : (
                    'Create Integration'
                  )}
                </button>
                <button
                  onClick={() => {
                    setShowTemplateModal(false);
                    setSelectedTemplate(null);
                  }}
                  className="px-6 py-3 bg-gray-100 text-gray-700 rounded-xl hover:bg-gray-200 transition-all font-semibold"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Integrations;
