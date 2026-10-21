import { useState, useEffect, useCallback } from 'react';
import axios from '../../utils/axios';
import toast from 'react-hot-toast';
import ConfirmDialog from '../../components/common/ConfirmDialog';

const TelephonySettings = () => {
  const [integrations, setIntegrations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingIntegration, setEditingIntegration] = useState(null);
  
  // Test states
  const [testingId, setTestingId] = useState(null);
  const [testPhoneNumber, setTestPhoneNumber] = useState('');
  const [showTestFormId, setShowTestFormId] = useState(null);

  // Form states
  const [name, setName] = useState('');
  const [provider, setProvider] = useState('twilio');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [apiBaseUrl, setApiBaseUrl] = useState('');
  const [streamWsUrl, setStreamWsUrl] = useState('');
  const [callerIds, setCallerIds] = useState(['']);
  const [recordCalls, setRecordCalls] = useState(true);
  const [transcribeCalls, setTranscribeCalls] = useState(false);
  const [isDefault, setIsDefault] = useState(false);
  const [isActive, setIsActive] = useState(true);
  const [saving, setSaving] = useState(false);

  // Confirm dialog state
  const [confirmDialog, setConfirmDialog] = useState({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: null,
  });

  const fetchIntegrations = useCallback(async () => {
    try {
      setLoading(true);
      const response = await axios.get('/integrations/type/telephony');
      setIntegrations(response.data.data);
    } catch (error) {
      console.error('Error fetching telephony integrations:', error);
      toast.error(error.response?.data?.message || 'Failed to load telephony integrations');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchIntegrations();
  }, [fetchIntegrations]);

  const handleOpenCreate = () => {
    setEditingIntegration(null);
    setName('');
    setProvider('twilio');
    setUsername('');
    setPassword('');
    setApiBaseUrl('');
    setStreamWsUrl('');
    setCallerIds(['']);
    setRecordCalls(true);
    setTranscribeCalls(false);
    setIsDefault(integrations.length === 0);
    setIsActive(true);
    setShowForm(true);
  };

  const handleOpenEdit = (integration) => {
    setEditingIntegration(integration);
    setName(integration.name || '');
    const meta = integration.metadata instanceof Map ? Object.fromEntries(integration.metadata) : (integration.metadata || {});
    setProvider(meta.provider || 'twilio');
    setUsername(integration.authConfig?.username || '');
    setPassword(integration.authConfig?.password || '');
    setApiBaseUrl(meta.apiBaseUrl || '');
    setStreamWsUrl(meta.streamWsUrl || '');
    setCallerIds(meta.callerIds && meta.callerIds.length > 0 ? meta.callerIds : ['']);
    setRecordCalls(meta.settings?.recordCalls ?? true);
    setTranscribeCalls(meta.settings?.transcribeCalls ?? false);
    setIsDefault(integration.isDefault || false);
    setIsActive(integration.isActive ?? true);
    setShowForm(true);
  };

  const handleDeleteClick = (integration) => {
    setConfirmDialog({
      isOpen: true,
      title: 'Delete Telephony Account',
      message: `Are you sure you want to delete "${integration.name}"? This action cannot be undone.`,
      onConfirm: () => handleDelete(integration._id),
    });
  };

  const handleDelete = async (id) => {
    try {
      await axios.delete(`/integrations/${id}`);
      toast.success('Telephony integration deleted successfully');
      fetchIntegrations();
    } catch (error) {
      console.error('Error deleting integration:', error);
      toast.error(error.response?.data?.message || 'Failed to delete integration');
    } finally {
      setConfirmDialog((prev) => ({ ...prev, isOpen: false }));
    }
  };

  const handleSetDefault = async (id) => {
    try {
      await axios.patch(`/integrations/${id}/default`);
      toast.success('Default telephony integration updated');
      fetchIntegrations();
    } catch (error) {
      console.error('Error setting default:', error);
      toast.error(error.response?.data?.message || 'Failed to update default integration');
    }
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!name.trim()) {
      toast.error('Please enter an account name');
      return;
    }
    if (!username.trim() || !password.trim()) {
      toast.error('Credentials fields are required');
      return;
    }

    const filteredCallerIds = callerIds.map(c => c.trim()).filter(Boolean);
    if (filteredCallerIds.length === 0) {
      toast.error('Please provide at least one Caller ID');
      return;
    }

    const payload = {
      name,
      type: 'telephony',
      baseUrl: provider === 'twilio' ? 'https://api.twilio.com' : (apiBaseUrl || 'https://api.vobiz.ai'),
      authType: provider === 'twilio' ? 'basic_auth' : 'custom_header',
      authConfig: {
        username: username.trim(),
        password: password.trim(),
      },
      metadata: {
        provider,
        callerIds: filteredCallerIds,
        settings: {
          recordCalls,
          transcribeCalls,
        },
        apiBaseUrl: apiBaseUrl.trim(),
        streamWsUrl: streamWsUrl.trim(),
      },
      isDefault,
      isActive,
    };

    try {
      setSaving(true);
      if (editingIntegration) {
        await axios.put(`/integrations/${editingIntegration._id}`, payload);
        toast.success('Telephony account updated successfully');
      } else {
        await axios.post('/integrations', payload);
        toast.success('Telephony account created successfully');
      }
      setShowForm(false);
      fetchIntegrations();
    } catch (error) {
      console.error('Error saving integration:', error);
      toast.error(error.response?.data?.message || 'Failed to save telephony account');
    } finally {
      setSaving(false);
    }
  };

  const handleTestCall = async (integrationId) => {
    if (!testPhoneNumber.trim()) {
      toast.error('Please enter a phone number to test');
      return;
    }

    try {
      setTestingId(integrationId);
      const response = await axios.post(`/telephony/test-integration/${integrationId}`, {
        phoneNumber: testPhoneNumber.trim(),
      });
      
      const resData = response.data?.data;
      if (resData?.message) {
        toast.success(resData.message);
      } else {
        toast.success('Test call initiated successfully!');
      }
      setTestPhoneNumber('');
      setShowTestFormId(null);
    } catch (error) {
      console.error('Test call error:', error);
      toast.error(error.response?.data?.message || 'Test call failed');
    } finally {
      setTestingId(null);
    }
  };

  const addCallerIdField = () => {
    setCallerIds([...callerIds, '']);
  };

  const removeCallerIdField = (index) => {
    const updated = callerIds.filter((_, i) => i !== index);
    setCallerIds(updated.length > 0 ? updated : ['']);
  };

  const updateCallerId = (index, value) => {
    const updated = [...callerIds];
    updated[index] = value;
    setCallerIds(updated);
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold text-gray-900 tracking-tight">Telephony Configurations</h1>
          <p className="text-gray-500 mt-1">Configure and manage multiple SIP/PSTN carriers for campaign voice operations.</p>
        </div>
        <button
          onClick={handleOpenCreate}
          className="inline-flex items-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-lg text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors"
        >
          <svg className="-ml-1 mr-2 h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Add Carrier Account
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center items-center py-20">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
        </div>
      ) : integrations.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-2xl shadow-sm border border-gray-100">
          <div className="mx-auto h-12 w-12 text-gray-400">
            <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.94.725l.548 2.2a1 1 0 00.996.86h3.181a1 1 0 00.996-.86l.548-2.2a1 1 0 01.94-.725H21a2 2 0 012 2v11a2 2 0 01-2 2H3a2 2 0 01-2-2V5z" />
            </svg>
          </div>
          <h3 className="mt-2 text-sm font-medium text-gray-900">No Carrier Accounts</h3>
          <p className="mt-1 text-sm text-gray-500">Get started by creating a new Twilio or Vobiz telephony integration.</p>
          <div className="mt-6">
            <button
              onClick={handleOpenCreate}
              className="inline-flex items-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700"
            >
              Add Carrier Account
            </button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {integrations.map((item) => {
            const meta = item.metadata instanceof Map ? Object.fromEntries(item.metadata) : (item.metadata || {});
            const isTwilio = meta.provider === 'twilio';
            const isActive = item.isActive;
            const callerList = meta.callerIds || [];

            return (
              <div
                key={item._id}
                className={`relative flex flex-col justify-between bg-white rounded-2xl border transition-all duration-200 ${
                  item.isDefault
                    ? 'border-yellow-400 ring-2 ring-yellow-400 ring-opacity-20 shadow-md'
                    : 'border-gray-100 shadow-sm hover:shadow-md'
                }`}
              >
                {/* Default Badge */}
                {item.isDefault && (
                  <span className="absolute top-0 right-0 transform translate-x-2 -translate-y-2 bg-yellow-400 text-yellow-950 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full shadow-sm">
                    Default
                  </span>
                )}

                <div className="p-6 space-y-4">
                  {/* Account Name & Provider Info */}
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="text-lg font-bold text-gray-900 leading-snug">{item.name}</h3>
                      <div className="flex items-center space-x-2 mt-1">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold uppercase tracking-wider ${
                            isTwilio
                              ? 'bg-orange-50 text-orange-600 border border-orange-100'
                              : 'bg-indigo-50 text-indigo-600 border border-indigo-100'
                          }`}
                        >
                          {meta.provider}
                        </span>
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                            isActive ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
                          }`}
                        >
                          {isActive ? 'Active' : 'Inactive'}
                        </span>
                      </div>
                    </div>
                    {/* Carrier Logo / Icon */}
                    <div
                      className={`p-3 rounded-xl ${
                        isTwilio ? 'bg-orange-50 text-orange-500' : 'bg-indigo-50 text-indigo-500'
                      }`}
                    >
                      <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.94.725l.548 2.2a1 1 0 00.996.86h3.181a1 1 0 00.996-.86l.548-2.2a1 1 0 01.94-.725H21a2 2 0 012 2v11a2 2 0 01-2 2H3a2 2 0 01-2-2V5z" />
                      </svg>
                    </div>
                  </div>

                  {/* Caller IDs list */}
                  <div className="space-y-1">
                    <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider block">Caller IDs</span>
                    {callerList.length === 0 ? (
                      <span className="text-sm text-gray-400 italic">None configured</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {callerList.map((cid, i) => (
                          <span
                            key={i}
                            className="inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-medium bg-gray-100 text-gray-800 border border-gray-200"
                          >
                            {cid}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Card Actions Footer */}
                <div className="px-6 py-4 bg-gray-50 rounded-b-2xl border-t border-gray-100 flex flex-col space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    {/* Set Default Button */}
                    {!item.isDefault ? (
                      <button
                        onClick={() => handleSetDefault(item._id)}
                        className="text-xs font-semibold text-gray-500 hover:text-yellow-600 transition-colors flex items-center"
                      >
                        <svg className="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.907c.961 0 1.36 1.238.58 1.81l-3.97 2.883a1 1 0 00-.364 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.971-2.883a1 1 0 00-1.17 0l-3.97 2.883c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.364-1.118L2.98 8.72c-.78-.572-.38-1.81.58-1.81h4.908a1 1 0 00.95-.69l1.519-4.674z" />
                        </svg>
                        Make Default
                      </button>
                    ) : (
                      <span className="text-xs font-semibold text-yellow-600 flex items-center">
                        <svg className="h-4 w-4 mr-1 fill-current" viewBox="0 0 20 20">
                          <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                        </svg>
                        Default Account
                      </span>
                    )}

                    <div className="flex items-center space-x-2">
                      <button
                        onClick={() => setShowTestFormId(showTestFormId === item._id ? null : item._id)}
                        className="p-1 text-gray-500 hover:text-blue-600 rounded-md hover:bg-gray-150 transition-all"
                        title="Test Configuration"
                      >
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                      </button>
                      <button
                        onClick={() => handleOpenEdit(item)}
                        className="p-1 text-gray-500 hover:text-blue-600 rounded-md hover:bg-gray-150 transition-all"
                        title="Edit Account"
                      >
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                      </button>
                      <button
                        onClick={() => handleDeleteClick(item)}
                        className="p-1 text-gray-500 hover:text-red-600 rounded-md hover:bg-gray-150 transition-all"
                        title="Delete Account"
                      >
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  </div>

                  {/* Inline Test Panel */}
                  {showTestFormId === item._id && (
                    <div className="pt-3 border-t border-gray-250 mt-2 space-y-2">
                      <label className="block text-xs font-semibold text-gray-600">Place Test Call</label>
                      <div className="flex gap-2">
                        <input
                          type="tel"
                          placeholder="e.g. +1234567890"
                          value={testPhoneNumber}
                          onChange={(e) => setTestPhoneNumber(e.target.value)}
                          className="flex-1 min-w-0 px-3 py-1.5 text-xs border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                        />
                        <button
                          onClick={() => handleTestCall(item._id)}
                          disabled={testingId === item._id}
                          className="px-3 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-md disabled:opacity-50 transition-all flex items-center"
                        >
                          {testingId === item._id ? 'Calling...' : 'Dial'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Account Form Modal */}
      {showForm && (
        <div className="fixed inset-0 z-[9999] overflow-y-auto">
          {/* Backdrop blur overlay */}
          <div className="fixed inset-0 bg-black/60 backdrop-blur-md transition-opacity" onClick={() => setShowForm(false)} />

          {/* Centering container */}
          <div className="flex min-h-full items-center justify-center p-4 text-center">
            <div className="relative bg-white rounded-2xl shadow-2xl border border-gray-100 w-full max-w-xl my-8 text-left transform transition-all">
              {/* Modal Header */}
            <div className="flex items-center justify-between p-6 border-b border-gray-150">
              <h3 className="text-xl font-bold text-gray-900">
                {editingIntegration ? 'Edit Telephony Carrier' : 'Add Telephony Carrier'}
              </h3>
              <button
                onClick={() => setShowForm(false)}
                className="text-gray-400 hover:text-gray-600 p-1.5 rounded-lg hover:bg-gray-100 transition-all"
              >
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Modal Body */}
            <form onSubmit={handleSave} className="p-6 space-y-5">
              {/* Account Name */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Account Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Twilio US Secondary Account"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm transition-all"
                />
              </div>

              {/* Provider Selection */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Provider *</label>
                <select
                  value={provider}
                  onChange={(e) => setProvider(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm transition-all bg-white"
                >
                  <option value="twilio">Twilio</option>
                  <option value="vobiz">Vobiz.ai</option>
                </select>
              </div>

              {/* Credentials Fields */}
              <div className="p-4 bg-gray-50 rounded-xl space-y-4 border border-gray-150">
                <span className="text-xs font-bold text-gray-400 uppercase tracking-wider block">API Authentication</span>
                
                {provider === 'twilio' ? (
                  <>
                    <div>
                      <label className="block text-xs font-semibold text-gray-700 mb-1">Account SID *</label>
                      <input
                        type="text"
                        required
                        placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        className="w-full px-3.5 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-700 mb-1">Auth Token *</label>
                      <input
                        type="password"
                        required
                        placeholder="Your Twilio Authentication Token"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="w-full px-3.5 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                      />
                    </div>
                  </>
                ) : (
                  <>
                    <div>
                      <label className="block text-xs font-semibold text-gray-700 mb-1">Auth ID *</label>
                      <input
                        type="text"
                        required
                        placeholder="Vobiz User ID or Account ID"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        className="w-full px-3.5 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-700 mb-1">Auth Token *</label>
                      <input
                        type="password"
                        required
                        placeholder="Vobiz API Key/Secret Token"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="w-full px-3.5 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-700 mb-1">Stream WebSocket URL</label>
                      <input
                        type="url"
                        placeholder="wss://api.vobiz.ai/v1/voice/stream"
                        value={streamWsUrl}
                        onChange={(e) => setStreamWsUrl(e.target.value)}
                        className="w-full px-3.5 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-700 mb-1">API Base URL</label>
                      <input
                        type="url"
                        placeholder="https://api.vobiz.ai"
                        value={apiBaseUrl}
                        onChange={(e) => setApiBaseUrl(e.target.value)}
                        className="w-full px-3.5 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                      />
                    </div>
                  </>
                )}
              </div>

              {/* Caller IDs */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-sm font-semibold text-gray-700">Outbound Caller IDs *</label>
                  <button
                    type="button"
                    onClick={addCallerIdField}
                    className="text-xs font-bold text-blue-600 hover:text-blue-800 flex items-center transition-colors"
                  >
                    + Add New ID
                  </button>
                </div>
                <div className="space-y-2">
                  {callerIds.map((cid, index) => (
                    <div key={index} className="flex items-center gap-2">
                      <input
                        type="tel"
                        required
                        placeholder="e.g. +14155552671"
                        value={cid}
                        onChange={(e) => updateCallerId(index, e.target.value)}
                        className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm transition-all"
                      />
                      {callerIds.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeCallerIdField(index)}
                          className="p-2 text-gray-400 hover:text-red-650 rounded-lg hover:bg-gray-100 transition-colors"
                        >
                          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7" />
                          </svg>
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Call Settings */}
              <div className="space-y-3 pt-2">
                <span className="text-sm font-semibold text-gray-700 block">Features & Global Fallback</span>
                
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-600">Record all outbound calls</span>
                  <input
                    type="checkbox"
                    checked={recordCalls}
                    onChange={(e) => setRecordCalls(e.target.checked)}
                    className="rounded text-blue-600 focus:ring-blue-500 h-4 w-4"
                  />
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-600">Auto-transcribe conversations</span>
                  <input
                    type="checkbox"
                    checked={transcribeCalls}
                    onChange={(e) => setTranscribeCalls(e.target.checked)}
                    className="rounded text-blue-600 focus:ring-blue-500 h-4 w-4"
                  />
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-600">Set as default account</span>
                  <input
                    type="checkbox"
                    checked={isDefault}
                    onChange={(e) => setIsDefault(e.target.checked)}
                    className="rounded text-blue-600 focus:ring-blue-500 h-4 w-4"
                  />
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-600">Account status active</span>
                  <input
                    type="checkbox"
                    checked={isActive}
                    onChange={(e) => setIsActive(e.target.checked)}
                    className="rounded text-blue-600 focus:ring-blue-500 h-4 w-4"
                  />
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex justify-end space-x-3 pt-4 border-t border-gray-150">
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="px-5 py-2 border border-gray-300 rounded-lg text-sm font-semibold text-gray-700 hover:bg-gray-50 focus:outline-none transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-sm font-semibold text-white rounded-lg disabled:opacity-50 focus:outline-none transition-colors"
                >
                  {saving ? 'Saving...' : 'Save Account'}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    )}

      {/* Confirmation Deletion Dialog */}
      <ConfirmDialog
        isOpen={confirmDialog.isOpen}
        title={confirmDialog.title}
        message={confirmDialog.message}
        onConfirm={confirmDialog.onConfirm}
        onClose={() => setConfirmDialog((prev) => ({ ...prev, isOpen: false }))}
      />
    </div>
  );
};

export default TelephonySettings;
