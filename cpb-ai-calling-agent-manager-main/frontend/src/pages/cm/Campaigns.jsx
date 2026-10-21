import { useState, useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import CampaignsList from '../../components/campaigns/CampaignsList';
import CampaignForm from '../../components/campaigns/CampaignForm';
import { fetchCampaigns } from '../../store/slices/campaignsSlice';
import { callOutcomeSeverity, getCallOutcomeBadge } from '../../utils/callOutcome';
import axios from '../../utils/axios';

const Campaigns = () => {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const { campaigns, loading, error } = useSelector((state) => state.campaigns);
  
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingCampaign, setEditingCampaign] = useState(null);
  const [viewStatsCampaign, setViewStatsCampaign] = useState(null);
  const [statsSessions, setStatsSessions] = useState([]);
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsError, setStatsError] = useState('');

  useEffect(() => {
    dispatch(fetchCampaigns());
  }, [dispatch]);

  useEffect(() => {
    if (!campaigns.some((campaign) => campaign.status === 'running')) return undefined;
    const timer = setInterval(() => {
      dispatch(fetchCampaigns());
    }, 15000);
    return () => clearInterval(timer);
  }, [campaigns, dispatch]);

  useEffect(() => {
    let cancelled = false;

    const loadSessions = async () => {
      if (!viewStatsCampaign?._id) {
        setStatsSessions([]);
        setStatsError('');
        setStatsLoading(false);
        return;
      }

      setStatsLoading(true);
      setStatsError('');
      try {
        const response = await axios.get(`/campaigns/${viewStatsCampaign._id}/sessions`, {
          params: { limit: 8, offset: 0 },
        });
        if (!cancelled) {
          setStatsSessions(response.data?.data || []);
        }
      } catch (err) {
        if (!cancelled) {
          setStatsSessions([]);
          setStatsError(err.response?.data?.message || 'Failed to load recent call sessions');
        }
      } finally {
        if (!cancelled) {
          setStatsLoading(false);
        }
      }
    };

    loadSessions();

    return () => {
      cancelled = true;
    };
  }, [viewStatsCampaign]);

  const handleCreate = () => setShowCreateForm(true);
  const handleEdit = (campaign) => setEditingCampaign(campaign);
  const handleOpenCampaign = (campaign) => navigate(`/cm/campaigns/${campaign._id}`);
  const handleViewStats = (campaign) => setViewStatsCampaign(campaign);

  const handleCloseForm = () => {
    setShowCreateForm(false);
    setEditingCampaign(null);
  };

  const handleCloseStats = () => {
    setViewStatsCampaign(null);
    setStatsSessions([]);
    setStatsError('');
    setStatsLoading(false);
  };

  const handleSuccess = () => dispatch(fetchCampaigns());

  // Calculate aggregate stats
  const totalCampaigns = campaigns.length;
  const activeCampaigns = campaigns.filter(c => c.status === 'running').length;
  const totalLeads = campaigns.reduce((sum, c) => {
    const stats = c.stats || c.statistics || {};
    return sum + (stats.totalLeads || 0);
  }, 0);
  const completedCalls = campaigns.reduce((sum, c) => {
    const stats = c.stats || c.statistics || {};
    return sum + (stats.completed || 0) + (stats.failed || 0);
  }, 0);

  const formatSessionDuration = (durationSeconds) => {
    const safeDuration = Number(durationSeconds) || 0;
    if (safeDuration <= 0) return '0s';
    const mins = Math.floor(safeDuration / 60);
    const secs = safeDuration % 60;
    return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
  };

  // Modernized badge styling using rings for a cleaner look
  const getSessionStatusClass = (status) => {
    const map = {
      completed: 'bg-green-50 text-green-700 ring-green-600/20',
      connected: 'bg-blue-50 text-blue-700 ring-blue-600/20',
      initiated: 'bg-slate-50 text-slate-700 ring-slate-500/20',
      queued:    'bg-slate-50 text-slate-700 ring-slate-500/20',
      ringing:   'bg-indigo-50 text-indigo-700 ring-indigo-600/20',
      scheduled: 'bg-purple-50 text-purple-700 ring-purple-600/20',
      no_answer: 'bg-yellow-50 text-yellow-800 ring-yellow-600/20',
      busy:      'bg-orange-50 text-orange-800 ring-orange-600/20',
      failed:    'bg-red-50 text-red-700 ring-red-600/10',
      canceled:  'bg-red-50 text-red-700 ring-red-600/10',
      exhausted: 'bg-red-50 text-red-700 ring-red-600/10',
      voicemail: 'bg-cyan-50 text-cyan-700 ring-cyan-600/20',
    };
    return map[status] || 'bg-gray-50 text-gray-700 ring-gray-500/20';
  };


  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header Area */}
      <div className="mb-8 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold text-gray-900 tracking-tight">Campaigns</h1>
          <p className="text-gray-500 mt-1 text-sm sm:text-base">
            Create, monitor, and manage your AI calling campaigns in real-time.
          </p>
        </div>
        <button
          onClick={handleCreate}
          className="inline-flex items-center justify-center px-5 py-2.5 bg-primary-600 text-white text-sm font-medium rounded-xl hover:bg-primary-700 hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
        >
          <svg className="w-5 h-5 mr-2 -ml-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
          </svg>
          Create Campaign
        </button>
      </div>

      {/* Modern Quick Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        {/* Total Campaigns */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm hover:shadow-md transition-shadow p-6">
          <div className="flex items-center">
            <div className="flex-shrink-0 bg-blue-50 text-blue-600 rounded-xl p-3">
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-500">Total Campaigns</p>
              <p className="text-2xl font-bold text-gray-900 mt-0.5">{totalCampaigns}</p>
            </div>
          </div>
        </div>

        {/* Active Campaigns */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm hover:shadow-md transition-shadow p-6">
          <div className="flex items-center">
            <div className="flex-shrink-0 bg-green-50 text-green-600 rounded-xl p-3">
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-500">Active Campaigns</p>
              <p className="text-2xl font-bold text-gray-900 mt-0.5">{activeCampaigns}</p>
            </div>
          </div>
        </div>

        {/* Total Leads */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm hover:shadow-md transition-shadow p-6">
          <div className="flex items-center">
            <div className="flex-shrink-0 bg-purple-50 text-purple-600 rounded-xl p-3">
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-500">Total Leads</p>
              <p className="text-2xl font-bold text-gray-900 mt-0.5">{totalLeads}</p>
            </div>
          </div>
        </div>

        {/* Completed Calls */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm hover:shadow-md transition-shadow p-6">
          <div className="flex items-center">
            <div className="flex-shrink-0 bg-orange-50 text-orange-600 rounded-xl p-3">
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
              </svg>
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-500">Calls Completed</p>
              <p className="text-2xl font-bold text-gray-900 mt-0.5">{completedCalls}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Error Alert */}
      {error && (
        <div className="mb-8 bg-red-50 border border-red-100 rounded-xl p-4 flex items-center justify-between">
          <div className="flex items-center text-red-800">
            <svg className="w-5 h-5 mr-3 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
            </svg>
            <span className="text-sm font-medium">{error}</span>
          </div>
          {error.includes('Unauthorized') && (
            <button
              onClick={() => window.location.href = '/login'}
              className="text-sm font-medium text-red-800 bg-red-100 hover:bg-red-200 px-3 py-1.5 rounded-lg transition-colors"
            >
              Go to Login
            </button>
          )}
        </div>
      )}

      {/* Main Content Area */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200/60 overflow-hidden">
        {loading && campaigns.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-80 space-y-4">
            <div className="relative">
              <div className="w-12 h-12 rounded-full border-4 border-gray-100"></div>
              <div className="w-12 h-12 rounded-full border-4 border-primary-600 border-t-transparent animate-spin absolute top-0 left-0"></div>
            </div>
            <p className="text-sm font-medium text-gray-500 animate-pulse">Fetching your campaigns...</p>
          </div>
        ) : (
          <CampaignsList
            onEdit={handleEdit}
            onViewStats={handleViewStats}
            onOpen={handleOpenCampaign}
          />
        )}
      </div>

      {/* Modals */}
      {(showCreateForm || editingCampaign) && (
        <CampaignForm
          campaign={editingCampaign}
          onClose={handleCloseForm}
          onSuccess={handleSuccess}
        />
      )}

      {/* Enhanced Stats Modal overlaying with Backdrop blur */}
      {viewStatsCampaign && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
          <div 
            className="absolute inset-0 bg-gray-900/40 backdrop-blur-sm transition-opacity" 
            onClick={handleCloseStats}
          ></div>
          
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            {/* Modal Header (Sticky) */}
            <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between bg-white z-10">
              <div>
                <h2 className="text-xl font-bold text-gray-900">Recent Call Sessions</h2>
                <p className="text-sm text-gray-500 mt-1">Campaign: <span className="font-medium text-gray-700">{viewStatsCampaign.name}</span></p>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => navigate(`/cm/campaigns/${viewStatsCampaign._id}/sessions`)}
                  className="px-4 py-2 text-sm font-medium bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100 transition-colors"
                >
                  View All Sessions
                </button>
                <button
                  onClick={handleCloseStats}
                  className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition-colors"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Modal Content (Scrollable) */}
            <div className="overflow-auto flex-1 bg-gray-50/30">
              {statsLoading ? (
                <div className="p-12 flex flex-col items-center justify-center space-y-4">
                  <div className="w-8 h-8 rounded-full border-3 border-primary-200 border-t-primary-600 animate-spin"></div>
                  <div className="text-gray-500 text-sm">Loading recent sessions...</div>
                </div>
              ) : statsError ? (
                <div className="p-12 text-center">
                  <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-red-100 mb-4">
                    <svg className="w-6 h-6 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                  </div>
                  <p className="text-red-600 font-medium">{statsError}</p>
                </div>
              ) : statsSessions.length === 0 ? (
                <div className="p-16 text-center">
                  <svg className="mx-auto h-12 w-12 text-gray-300 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                  </svg>
                  <h3 className="text-lg font-medium text-gray-900">No sessions found</h3>
                  <p className="text-gray-500 mt-1">There are no call sessions recorded for this campaign yet.</p>
                </div>
              ) : (
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-white sticky top-0 z-10 shadow-sm">
                    <tr>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Lead Information</th>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Status</th>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Call Status</th>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Duration</th>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Insights & Highlights</th>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Scheduled</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-100">
                    {statsSessions.map((session) => (
                      <tr key={session._id} className="hover:bg-gray-50/50 transition-colors">
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center">
                            <div className="h-8 w-8 rounded-full bg-primary-100 text-primary-700 flex items-center justify-center font-bold text-xs mr-3">
                              {(session.leadId?.name || 'U')[0].toUpperCase()}
                            </div>
                            <div>
                              <div className="text-sm font-medium text-gray-900">{session.leadId?.name || 'Unknown Lead'}</div>
                              <div className="text-xs text-gray-500">{session.leadId?.phoneNumber || session.leadId?.phone || 'N/A'}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          {(() => {
                            const severity = callOutcomeSeverity(session);
                            const statusClass = severity === 'error'
                              ? 'bg-red-50 text-red-700 ring-red-600/10'
                              : severity === 'warning'
                                ? 'bg-amber-50 text-amber-800 ring-amber-600/20'
                                : getSessionStatusClass(session.status);
                            const label = severity === 'error'
                              ? 'failed'
                              : severity === 'warning'
                                ? 'warning'
                                : (session.status || 'unknown');
                            return (
                              <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ring-1 ring-inset ${statusClass}`}>
                                {label.replace('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())}
                              </span>
                            );
                          })()}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          {(() => {
                            const badge = getCallOutcomeBadge(session);
                            if (!badge) return <span className="text-gray-400 text-sm">-</span>;
                            return (
                              <span className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-full ${badge.color}`}>
                                <span className="text-[11px]">{badge.icon}</span>
                                {badge.label}
                              </span>
                            );
                          })()}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600 font-medium">
                          {formatSessionDuration(session.durationSeconds)}
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-600 max-w-xs truncate">
                          {session.extracted?.interest_level ? (
                            <span className="inline-flex items-center gap-1.5">
                              <span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span>
                              Interest: {session.extracted.interest_level}
                            </span>
                          ) : (
                            <span className="text-gray-400 italic">
                              {session.summary || session.endReason || 'Pending insights...'}
                            </span>
                          )}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {session.scheduledFor ? (
                            <span className="flex items-center">
                              <svg className="w-4 h-4 mr-1.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                              </svg>
                              {new Date(session.scheduledFor).toLocaleDateString()}
                            </span>
                          ) : (
                            '-'
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            
            {/* Modal Footer (Sticky) */}
            {statsSessions.length > 0 && (
              <div className="px-6 py-4 border-t border-gray-100 bg-gray-50 flex justify-center z-10">
                <button
                  onClick={() => navigate(`/cm/campaigns/${viewStatsCampaign._id}/sessions`)}
                  className="text-sm font-medium text-primary-600 hover:text-primary-700 flex items-center transition-colors"
                >
                  View full session history
                  <svg className="w-4 h-4 ml-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default Campaigns;