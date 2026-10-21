import { useState } from 'react';
import { useDispatch } from 'react-redux';
import { startCampaign, pauseCampaign, stopCampaign } from '../../store/slices/campaignsSlice';
import CampaignFailureAlert from './CampaignFailureAlert';

const CampaignControls = ({ campaign, onClose, onSuccess }) => {
  const dispatch = useDispatch();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleStart = async () => {
    setError('');
    setLoading(true);

    try {
      await dispatch(startCampaign(campaign._id)).unwrap();
      if (onSuccess) onSuccess();
      if (onClose) onClose();
    } catch (err) {
      const msg = typeof err === 'string' ? err : err?.message || 'Unknown error';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handlePause = async () => {
    setError('');
    setLoading(true);

    try {
      await dispatch(pauseCampaign(campaign._id)).unwrap();
      if (onSuccess) onSuccess();
      if (onClose) onClose();
    } catch (err) {
      const msg = typeof err === 'string' ? err : err?.message || 'Unknown error';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleStop = async () => {
    if (!window.confirm('Are you sure you want to stop this campaign?')) return;
    
    setError('');
    setLoading(true);

    try {
      await dispatch(stopCampaign(campaign._id)).unwrap();
      if (onSuccess) onSuccess();
      if (onClose) onClose();
    } catch (err) {
      const msg = typeof err === 'string' ? err : err?.message || 'Unknown error';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const getStatusBadgeClass = (status) => {
    const classes = {
      draft: 'bg-slate-50 text-slate-700 ring-slate-500/20',
      running: 'bg-green-50 text-green-700 ring-green-600/20',
      paused: 'bg-yellow-50 text-yellow-800 ring-yellow-600/20',
      completed: 'bg-blue-50 text-blue-700 ring-blue-600/20',
      stopped: 'bg-red-50 text-red-700 ring-red-600/10',
    };
    return classes[status] || 'bg-gray-50 text-gray-700 ring-gray-500/20';
  };

  const stats = campaign.statistics || {};
  const totalLeads = stats.totalLeads || 0;
  const completedCalls = (stats.completed || 0) + (stats.failed || 0);
  const progress = totalLeads > 0 ? Math.round((completedCalls / totalLeads) * 100) : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-gray-900/40 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      ></div>
      
      {/* Modal Container */}
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100 bg-white z-10">
          <div>
            <h2 className="text-xl font-bold text-gray-900">Campaign Controls</h2>
            <p className="text-sm text-gray-500 mt-1 font-medium">{campaign.name}</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="p-6 overflow-y-auto bg-gray-50/30 flex-1">
          {campaign.runtimeAlert?.active && (
            <div className="mb-4">
              <CampaignFailureAlert campaign={campaign} />
            </div>
          )}
          {error && (
            <div className="mb-6 bg-red-50 border border-red-100 text-red-700 px-4 py-3 rounded-xl flex items-center shadow-sm">
              <svg className="w-5 h-5 mr-3 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
              </svg>
              <span className="text-sm font-medium">{error}</span>
            </div>
          )}

          {/* Core Status & Progress Dashboard */}
          <div className="mb-6 bg-white border border-gray-100 rounded-2xl p-5 shadow-sm">
            <div className="flex items-center justify-between mb-5">
              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Current Status</p>
                <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold ring-1 ring-inset ${getStatusBadgeClass(campaign.status)}`}>
                  {/* Status indicator dot */}
                  <span className={`w-1.5 h-1.5 rounded-full mr-2 ${campaign.status === 'running' ? 'bg-green-500 animate-pulse' : 'bg-current'}`}></span>
                  <span className="capitalize">{campaign.status}</span>
                </span>
              </div>
              <div className="text-right">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Progress</p>
                <p className="text-3xl font-extrabold text-gray-900">{progress}%</p>
              </div>
            </div>

            {/* Progress Bar */}
            <div className="mb-6">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-gray-600">Calls Completed</span>
                <span className="text-sm font-bold text-gray-900">
                  {completedCalls} <span className="text-gray-400 font-medium">/ {totalLeads}</span>
                </span>
              </div>
              <div className="w-full bg-gray-100 rounded-full h-2.5 shadow-inner">
                <div
                  className="bg-primary-500 h-2.5 rounded-full transition-all duration-700 ease-out"
                  style={{ width: `${progress}%` }}
                ></div>
              </div>
            </div>

            {/* Statistics Grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="bg-green-50/50 border border-green-100 p-3 rounded-xl text-center">
                <p className="text-xs font-medium text-green-700 mb-1">Interested</p>
                <p className="text-xl font-bold text-green-700">{stats.interested || 0}</p>
              </div>
              <div className="bg-red-50/50 border border-red-100 p-3 rounded-xl text-center">
                <p className="text-xs font-medium text-red-700 mb-1">Not Interested</p>
                <p className="text-xl font-bold text-red-700">{stats.notInterested || 0}</p>
              </div>
              <div className="bg-yellow-50/50 border border-yellow-100 p-3 rounded-xl text-center">
                <p className="text-xs font-medium text-yellow-800 mb-1">Callback</p>
                <p className="text-xl font-bold text-yellow-700">{stats.callback || 0}</p>
              </div>
              <div className="bg-gray-50 border border-gray-100 p-3 rounded-xl text-center">
                <p className="text-xs font-medium text-gray-600 mb-1">Failed</p>
                <p className="text-xl font-bold text-gray-700">{stats.failed || 0}</p>
              </div>
            </div>
          </div>

          {/* Campaign Configuration Summary */}
          <div className="mb-6 bg-white border border-gray-100 rounded-2xl p-5 shadow-sm">
            <h3 className="text-sm font-bold text-gray-900 mb-4">Configuration Details</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="flex flex-col">
                <span className="text-xs text-gray-500 font-medium mb-1">AI Caller</span>
                <span className="text-sm font-semibold text-gray-900 flex items-center">
                  <svg className="w-4 h-4 mr-1.5 text-primary-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                  </svg>
                  {campaign.callerId?.name || 'Not assigned'}
                </span>
              </div>
              <div className="flex flex-col">
                <span className="text-xs text-gray-500 font-medium mb-1">Max Concurrent Calls</span>
                <span className="text-sm font-semibold text-gray-900">
                  {campaign.settings?.concurrencyLimit ?? campaign.settings?.maxConcurrentCalls ?? 0}
                </span>
              </div>
              <div className="flex flex-col">
                <span className="text-xs text-gray-500 font-medium mb-1">Retry Attempts</span>
                <span className="text-sm font-semibold text-gray-900">
                  {campaign.settings?.maxRetries ?? campaign.settings?.retryAttempts ?? 0}
                </span>
              </div>
              <div className="flex flex-col">
                <span className="text-xs text-gray-500 font-medium mb-1">Calling Window</span>
                <span className="text-sm font-semibold text-gray-900">
                  {campaign.settings?.callingWindow?.enabled
                    ? `${campaign.settings.callingWindow.startHour}:00 - ${campaign.settings.callingWindow.endHour}:00`
                    : 'Disabled'}
                </span>
              </div>
            </div>
          </div>

          {/* Contextual Warnings */}
          {totalLeads === 0 && (
            <div className="mb-6 p-4 bg-yellow-50 border border-yellow-100 rounded-xl flex items-start">
              <svg className="w-5 h-5 text-yellow-600 mr-3 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <p className="text-sm text-yellow-800">
                <span className="font-bold block mb-0.5">Missing Leads</span>
                This campaign has no leads. Please upload leads before starting.
              </p>
            </div>
          )}

          {campaign.status === 'completed' && (
            <div className="mb-6 p-4 bg-blue-50 border border-blue-100 rounded-xl flex items-start">
              <svg className="w-5 h-5 text-blue-600 mr-3 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-sm text-blue-800">
                <span className="font-bold block mb-0.5">Campaign Completed</span>
                All calls have been successfully processed for this campaign.
              </p>
            </div>
          )}
          
          {/* Main Action Buttons */}
          <div className="flex flex-col sm:flex-row justify-center gap-3">
            {['draft', 'paused', 'stopped', 'completed'].includes(campaign.status) ? (
              <button
                onClick={handleStart}
                disabled={loading || totalLeads === 0}
                className="w-full sm:w-auto flex items-center justify-center px-8 py-3 bg-green-600 text-white text-sm font-semibold rounded-xl hover:bg-green-700 hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:shadow-none disabled:hover:translate-y-0"
              >
                {loading ? (
                  <svg className="animate-spin w-5 h-5 mr-2" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                ) : (
                  <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
                  </svg>
                )}
                {['stopped', 'completed'].includes(campaign.status) ? 'Reopen & Start Campaign' : 'Start Campaign'}
              </button>
            ) : null}

            {campaign.status === 'running' ? (
              <button
                onClick={handlePause}
                disabled={loading}
                className="w-full sm:w-auto flex items-center justify-center px-8 py-3 bg-yellow-500 text-white text-sm font-semibold rounded-xl hover:bg-yellow-600 hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:shadow-none disabled:hover:translate-y-0"
              >
                {loading ? (
                  <svg className="animate-spin w-5 h-5 mr-2" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                ) : (
                  <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM7 8a1 1 0 012 0v4a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v4a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                  </svg>
                )}
                Pause Campaign
              </button>
            ) : null}

            {(campaign.status === 'running' || campaign.status === 'paused') ? (
              <button
                onClick={handleStop}
                disabled={loading}
                className="w-full sm:w-auto flex items-center justify-center px-8 py-3 bg-red-500 text-white text-sm font-semibold rounded-xl hover:bg-red-600 hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:shadow-none disabled:hover:translate-y-0"
              >
                {loading ? (
                  <svg className="animate-spin w-5 h-5 mr-2" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                ) : (
                  <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8 7a1 1 0 00-1 1v4a1 1 0 001 1h4a1 1 0 001-1V8a1 1 0 00-1-1H8z" clipRule="evenodd" />
                  </svg>
                )}
                Stop Campaign
              </button>
            ) : null}
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end px-6 py-4 border-t border-gray-100 bg-gray-50 z-10">
          <button
            onClick={onClose}
            className="px-5 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-xl hover:bg-gray-50 hover:text-gray-900 transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-200"
          >
            Close Window
          </button>
        </div>
      </div>
    </div>
  );
};

export default CampaignControls;