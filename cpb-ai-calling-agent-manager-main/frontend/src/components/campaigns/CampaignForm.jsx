import { useState, useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { createCampaign, updateCampaign } from '../../store/slices/campaignsSlice';
import { fetchCallers } from '../../store/slices/callersSlice';


const CampaignForm = ({ campaign = null, onClose, onSuccess }) => {
  console.log('[CampaignForm] Component rendered', { campaign: campaign?._id, onClose: !!onClose, onSuccess: !!onSuccess });

  const dispatch = useDispatch();
  const { callers } = useSelector((state) => state.callers);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [formData, setFormData] = useState({
    name: '',
    description: '',
    callerId: '',
    settings: {
      maxConcurrentCalls: 6,
      retryAttempts: 3,
      retryGapMinutes: 60,
      callTimeoutSeconds: 300,
      callingWindow: {
        enabled: true,
        startHour: 9,
        endHour: 18,
        timezone: 'Asia/Kolkata',
        daysOfWeek: [1, 2, 3, 4, 5], // Monday to Friday
      },
    },
    customFields: [],
  });

  useEffect(() => {
    dispatch(fetchCallers())
      .unwrap()
      .then((callers) => {
        console.log('[CampaignForm] Callers loaded:', callers);
      })
      .catch((error) => {
        console.error('[CampaignForm] Failed to load callers:', error);
      });
  }, [dispatch]);

  useEffect(() => {
    if (campaign) {
      // Map backend field names to frontend format
      const backendSettings = campaign.settings || {};
      const backendCallingWindow = backendSettings.callingWindow || {};

      setFormData({
        name: campaign.name || '',
        description: campaign.description || '',
        callerId: campaign.aiCallerId?._id || campaign.aiCallerId || '',
        settings: {
          maxConcurrentCalls: backendSettings.concurrencyLimit ?? 6,
          retryAttempts: backendSettings.maxRetries !== undefined ? backendSettings.maxRetries : 3,
          retryGapMinutes: backendSettings.retryGap !== undefined ? backendSettings.retryGap : 60,
          callTimeoutSeconds: backendSettings.maxCallDuration ?? 300,
          callingWindow: {
            enabled: true,
            startHour: backendCallingWindow.startTime ? parseInt(backendCallingWindow.startTime.split(':')[0]) : 9,
            endHour: backendCallingWindow.endTime ? parseInt(backendCallingWindow.endTime.split(':')[0]) : 18,
            timezone: backendCallingWindow.timezone || 'Asia/Kolkata',
            daysOfWeek: backendCallingWindow.daysOfWeek || [1, 2, 3, 4, 5],
          },
        },
        customFields: campaign.customFields || [],
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaign]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    console.log('[CampaignForm] Submit clicked');
    console.log('[CampaignForm] Form data:', formData);

    // Validation
    if (!formData.name.trim()) {
      console.log('[CampaignForm] Validation failed: name is empty');
      setError('Campaign name is required');
      return;
    }

    if (!formData.callerId) {
      console.log('[CampaignForm] Validation failed: callerId is empty');
      setError('Please select an AI caller');
      return;
    }

    if (formData.settings.maxConcurrentCalls < 1 || formData.settings.maxConcurrentCalls > 100) {
      console.log('[CampaignForm] Validation failed: invalid maxConcurrentCalls');
      setError('Max concurrent calls must be between 1 and 100');
      return;
    }

    console.log('[CampaignForm] Validation passed, setting loading true');
    setLoading(true);

    try {
      // Map frontend field names to backend schema
      const backendData = {
        name: formData.name,
        description: formData.description,
        aiCallerId: formData.callerId, // Map callerId to aiCallerId
        settings: {
          concurrencyLimit: formData.settings.maxConcurrentCalls,
          maxCallDuration: formData.settings.callTimeoutSeconds,
          retryGap: Number(formData.settings.retryAttempts) === 0 ? 0 : Number(formData.settings.retryGapMinutes || 60),
          maxRetries: Number(formData.settings.retryAttempts ?? 0),
          callingWindow: {
            startTime: `${String(formData.settings.callingWindow.startHour).padStart(2, '0')}:00`,
            endTime: `${String(formData.settings.callingWindow.endHour).padStart(2, '0')}:00`,
            timezone: formData.settings.callingWindow.timezone,
            daysOfWeek: formData.settings.callingWindow.daysOfWeek
          }
        },
        customFields: formData.customFields
      };

      console.log('[CampaignForm] Mapped backend data:', backendData);
      console.log('[CampaignForm] Dispatching action...');
      if (campaign) {
        await dispatch(updateCampaign({ id: campaign._id, data: backendData })).unwrap();
        console.log('[CampaignForm] Update successful');
      } else {
        const result = await dispatch(createCampaign(backendData)).unwrap();
        console.log('[CampaignForm] Create successful:', result);
      }

      if (onSuccess) onSuccess();
      if (onClose) onClose();
    } catch (err) {
      console.error('[CampaignForm] Error:', err);
      setError(err.message || 'Failed to save campaign');
    } finally {
      setLoading(false);
    }
  };

  const toggleDay = (day) => {
    const currentDays = formData.settings.callingWindow.daysOfWeek;
    const newDays = currentDays.includes(day)
      ? currentDays.filter(d => d !== day)
      : [...currentDays, day].sort();

    setFormData({
      ...formData,
      settings: {
        ...formData.settings,
        callingWindow: {
          ...formData.settings.callingWindow,
          daysOfWeek: newDays,
        },
      },
    });
  };

  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-3xl my-8 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">
              {campaign ? 'Edit Campaign' : 'Create Campaign'}
            </h2>
            <p className="text-sm text-gray-600 mt-1">
              Configure campaign settings and assign an AI caller
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6">
          {error && (
            <div className="mb-6 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
              {error}
            </div>
          )}

          <div className="space-y-6">
            {/* Basic Information */}
            <div className="bg-gray-50 p-4 rounded-lg">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Basic Information</h3>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Campaign Name *
                  </label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="Summer Sales Campaign 2026"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Description
                  </label>
                  <textarea
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    placeholder="Describe the purpose of this campaign"
                    rows="3"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    AI Caller *
                  </label>
                  <select
                    value={formData.callerId}
                    onChange={(e) => setFormData({ ...formData, callerId: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                    required
                  >
                    <option value="">Select an AI caller</option>
                    {callers.filter(c => c.isActive).map((caller) => (
                      <option key={caller._id} value={caller._id}>
                        {caller.name} (S2S)
                      </option>
                    ))}
                  </select>
                  {callers.length === 0 && (
                    <p className="mt-1 text-xs text-red-600">
                      No AI callers available. Please create one first.
                    </p>
                  )}

                  {/* Show calling mechanism info for selected caller */}
                  {formData.callerId && (() => {
                    const selectedCaller = callers.find(c => c._id === formData.callerId);
                    if (!selectedCaller) return null;

                    return (
                      <div className="mt-3 p-3 rounded-lg bg-purple-50 border border-purple-200">
                        <div className="flex items-center">
                          <span className="text-xl mr-2">🎙️</span>
                          <div>
                            <p className="text-sm font-medium text-purple-800">
                              Speech-to-Speech (S2S)
                            </p>
                            <p className="text-xs text-purple-600">
                              This caller uses Speech-to-Speech for lower latency
                            </p>
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </div>
            </div>

            {/* Call Settings */}
            <div className="bg-gray-50 p-4 rounded-lg">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Call Settings</h3>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Max Concurrent Calls
                  </label>
                  <input
                    type="number"
                    value={formData.settings.maxConcurrentCalls}
                    onChange={(e) => setFormData({
                      ...formData,
                      settings: { ...formData.settings, maxConcurrentCalls: parseInt(e.target.value) }
                    })}
                    min="1"
                    max="100"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                  <p className="mt-1 text-xs text-gray-500">How many calls to make simultaneously</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Call Timeout (seconds)
                  </label>
                  <input
                    type="number"
                    value={formData.settings.callTimeoutSeconds}
                    onChange={(e) => setFormData({
                      ...formData,
                      settings: { ...formData.settings, callTimeoutSeconds: parseInt(e.target.value) }
                    })}
                    min="30"
                    max="3600"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                  <p className="mt-1 text-xs text-gray-500">Maximum duration for each call</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Retry Attempts
                  </label>
                  <input
                    type="number"
                    value={formData.settings.retryAttempts}
                    onChange={(e) => {
                      const val = Math.max(0, parseInt(e.target.value, 10) || 0);
                      setFormData({
                        ...formData,
                        settings: {
                          ...formData.settings,
                          retryAttempts: val,
                          ...(val === 0 ? { retryGapMinutes: 0 } : (formData.settings.retryGapMinutes === 0 ? { retryGapMinutes: 60 } : {}))
                        }
                      });
                    }}
                    min="0"
                    max="10"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                  <p className="mt-1 text-xs text-gray-500">Number of retry attempts for failed calls (0 = no retries)</p>
                </div>

                {formData.settings.retryAttempts > 0 && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Retry Gap (minutes)
                    </label>
                    <input
                      type="number"
                      value={formData.settings.retryGapMinutes}
                      onChange={(e) => setFormData({
                        ...formData,
                        settings: { ...formData.settings, retryGapMinutes: Math.max(1, parseInt(e.target.value, 10) || 0) }
                      })}
                      min="1"
                      max="1440"
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                    />
                    <p className="mt-1 text-xs text-gray-500">Time between retry attempts</p>
                  </div>
                )}
              </div>
            </div>

            {/* Calling Window */}
            <div className="bg-gray-50 p-4 rounded-lg">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-900">Calling Window</h3>
                <label className="flex items-center">
                  <input
                    type="checkbox"
                    checked={formData.settings.callingWindow.enabled}
                    onChange={(e) => setFormData({
                      ...formData,
                      settings: {
                        ...formData.settings,
                        callingWindow: { ...formData.settings.callingWindow, enabled: e.target.checked }
                      }
                    })}
                    className="w-4 h-4 text-primary-600 border-gray-300 rounded focus:ring-primary-500"
                  />
                  <span className="ml-2 text-sm text-gray-700">Enable calling window</span>
                </label>
              </div>

              {formData.settings.callingWindow.enabled && (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Start Hour
                      </label>
                      <select
                        value={formData.settings.callingWindow.startHour}
                        onChange={(e) => setFormData({
                          ...formData,
                          settings: {
                            ...formData.settings,
                            callingWindow: { ...formData.settings.callingWindow, startHour: parseInt(e.target.value) }
                          }
                        })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                      >
                        {Array.from({ length: 24 }, (_, i) => (
                          <option key={i} value={i}>{i}:00</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        End Hour
                      </label>
                      <select
                        value={formData.settings.callingWindow.endHour}
                        onChange={(e) => setFormData({
                          ...formData,
                          settings: {
                            ...formData.settings,
                            callingWindow: { ...formData.settings.callingWindow, endHour: parseInt(e.target.value) }
                          }
                        })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                      >
                        {Array.from({ length: 24 }, (_, i) => (
                          <option key={i} value={i}>{i}:00</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Timezone
                      </label>
                      <select
                        value={formData.settings.callingWindow.timezone}
                        onChange={(e) => setFormData({
                          ...formData,
                          settings: {
                            ...formData.settings,
                            callingWindow: { ...formData.settings.callingWindow, timezone: e.target.value }
                          }
                        })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                      >
                        <option value="Asia/Kolkata">India Standard Time (IST)</option>
                        <option value="UTC">UTC</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Days of Week
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {dayNames.map((day, index) => (
                        <button
                          key={index}
                          type="button"
                          onClick={() => toggleDay(index)}
                          className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                            formData.settings.callingWindow.daysOfWeek.includes(index)
                              ? 'bg-primary-600 text-white'
                              : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                          }`}
                        >
                          {day}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-end space-x-3 mt-6 pt-6 border-t border-gray-200">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || callers.length === 0}
              className="px-4 py-2 text-sm font-medium text-white bg-primary-600 border border-transparent rounded-md hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <span className="flex items-center">
                  <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Saving...
                </span>
              ) : (
                campaign ? 'Update Campaign' : 'Create Campaign'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default CampaignForm;
