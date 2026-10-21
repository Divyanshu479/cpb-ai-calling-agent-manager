import { useEffect, useMemo, useState, useLayoutEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Link, useNavigate, useParams } from 'react-router-dom';
import LeadUpload from '../../components/leads/LeadUpload';
import LeadForm from '../../components/leads/LeadForm';
import LeadsList from '../../components/leads/LeadsList';
import {
  fetchCampaign,
  fetchCampaigns,
  pauseCampaign,
  startCampaign,
  stopCampaign,
} from '../../store/slices/campaignsSlice';
import { fetchLeadStats, fetchLeads } from '../../store/slices/leadsSlice';
import CampaignFailureAlert from '../../components/campaigns/CampaignFailureAlert';

const CampaignDetail = () => {
  const { campaignId } = useParams();
  const dispatch = useDispatch();
  const navigate = useNavigate();

  const { currentCampaign, loading: campaignsLoading, error: campaignsError } = useSelector(
    (state) => state.campaigns
  );
  const { stats, loading: leadsLoading, error: leadsError, leads, currentCampaignId } = useSelector((state) => state.leads);

  const [showUpload, setShowUpload] = useState(false);
  const [showManualForm, setShowManualForm] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState('');

  useEffect(() => {
    if (!campaignId) return;
    dispatch(fetchCampaign(campaignId));
    dispatch(fetchLeadStats(campaignId));
    if (leads.length === 0 || currentCampaignId !== campaignId) {
      dispatch(fetchLeads({ campaignId }));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dispatch, campaignId]);

  useEffect(() => {
    if (!campaignId || currentCampaign?.status !== 'running') return undefined;
    const timer = setInterval(() => {
      dispatch(fetchCampaign(campaignId));
    }, 8000);
    return () => clearInterval(timer);
  }, [campaignId, currentCampaign?.status, dispatch]);

  useLayoutEffect(() => {
    if (leads.length > 0 || currentCampaign) {
      const savedScroll = sessionStorage.getItem('campaignDetailScrollPos');
      if (savedScroll) {
        const container = document.getElementById('main-scroll-container');
        if (container) {
          container.scrollTop = parseInt(savedScroll, 10);
        }
        sessionStorage.removeItem('campaignDetailScrollPos');
      }
    }
  }, [leads.length, currentCampaign]);

  const refreshCampaignData = () => {
    if (!campaignId) return;
    dispatch(fetchCampaign(campaignId));
    dispatch(fetchLeadStats(campaignId));
    dispatch(fetchLeads({ campaignId }));
    dispatch(fetchCampaigns());
  };

  const handleStart = async () => {
    if (!campaignId) return;
    setActionError('');
    setActionLoading(true);
    try {
      await dispatch(startCampaign(campaignId)).unwrap();
      refreshCampaignData();
    } catch (error) {
      const msg = typeof error === 'string' ? error : error?.message || 'Failed to start campaign';
      setActionError(msg);
    } finally {
      setActionLoading(false);
    }
  };

  const handlePause = async () => {
    if (!campaignId) return;
    setActionError('');
    setActionLoading(true);
    try {
      await dispatch(pauseCampaign(campaignId)).unwrap();
      refreshCampaignData();
    } catch (error) {
      const msg = typeof error === 'string' ? error : error?.message || 'Failed to pause campaign';
      setActionError(msg);
    } finally {
      setActionLoading(false);
    }
  };

  const handleStop = async () => {
    if (!campaignId) return;
    if (!window.confirm('Are you sure you want to stop this campaign?')) return;
    setActionError('');
    setActionLoading(true);
    try {
      await dispatch(stopCampaign(campaignId)).unwrap();
      refreshCampaignData();
    } catch (error) {
      const msg = typeof error === 'string' ? error : error?.message || 'Failed to stop campaign';
      setActionError(msg);
    } finally {
      setActionLoading(false);
    }
  };

  const getCampaignStat = (key) => {
    if (!currentCampaign) return 0;
    return currentCampaign.stats?.[key] ?? currentCampaign.statistics?.[key] ?? 0;
  };

  const totalLeads = getCampaignStat('totalLeads');

  const completedCalls =
    getCampaignStat('completed') +
    getCampaignStat('failed') +
    getCampaignStat('notInterested') +
    getCampaignStat('interested');

  const progressPercent = useMemo(() => {
    if (!totalLeads) return 0;
    return Math.min(100, Math.round((completedCalls / totalLeads) * 100));
  }, [completedCalls, totalLeads]);

  const statusColorMap = {
    draft: 'bg-gray-100 text-gray-700',
    running: 'bg-green-100 text-green-700',
    paused: 'bg-yellow-100 text-yellow-700',
    stopped: 'bg-red-100 text-red-700',
    completed: 'bg-blue-100 text-blue-700',
  };

  const statusPillClass = statusColorMap[currentCampaign?.status] || 'bg-gray-100 text-gray-700';

  if (campaignsLoading && !currentCampaign) {
    return (
      <div className="p-6">
        <div className="text-sm text-gray-600">Loading campaign...</div>
      </div>
    );
  }

  if (!campaignsLoading && !currentCampaign) {
    return (
      <div className="p-6">
        <button
          onClick={() => navigate('/cm/campaigns')}
          className="text-sm text-blue-600 hover:text-blue-800 mb-3"
        >
          ← Back to Campaigns
        </button>
        <div className="bg-white rounded-lg shadow p-8 text-center">
          <h2 className="text-xl font-semibold text-gray-900">Campaign not found</h2>
          <p className="text-gray-600 mt-2">
            {campaignsError || 'This campaign may have been removed or you may not have access.'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <button
            onClick={() => navigate('/cm/campaigns')}
            className="text-sm text-blue-600 hover:text-blue-800 mb-2"
          >
            ← Back to Campaigns
          </button>
          <h1 className="text-3xl font-bold text-gray-900">{currentCampaign?.name}</h1>
          <p className="text-gray-600 mt-2">{currentCampaign?.description || 'No description'}</p>
          <div className="mt-3">
            <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${statusPillClass}`}>
              {(currentCampaign?.status || 'draft').toUpperCase()}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {['draft', 'paused', 'stopped', 'completed'].includes(currentCampaign?.status) && (
            <button
              onClick={handleStart}
              disabled={actionLoading}
              className="px-4 py-2 rounded-md bg-green-600 text-white hover:bg-green-700 disabled:opacity-60"
            >
              {['stopped', 'completed'].includes(currentCampaign?.status) ? 'Reopen & Start' : 'Start Campaign'}
            </button>
          )}

          {currentCampaign?.status === 'running' && (
            <button
              onClick={handlePause}
              disabled={actionLoading}
              className="px-4 py-2 rounded-md bg-yellow-600 text-white hover:bg-yellow-700 disabled:opacity-60"
            >
              Pause Campaign
            </button>
          )}

          {(currentCampaign?.status === 'running' || currentCampaign?.status === 'paused') && (
            <button
              onClick={handleStop}
              disabled={actionLoading}
              className="px-4 py-2 rounded-md bg-red-600 text-white hover:bg-red-700 disabled:opacity-60"
            >
              Stop Campaign
            </button>
          )}

          <Link
            to={`/cm/campaigns/${campaignId}/sessions`}
            onClick={() => {
              const container = document.getElementById('main-scroll-container');
              if (container) {
                sessionStorage.setItem('campaignDetailScrollPos', container.scrollTop.toString());
              }
            }}
            className="px-4 py-2 rounded-md bg-blue-600 text-white hover:bg-blue-700"
          >
            View Sessions
          </Link>
        </div>
      </div>

      <CampaignFailureAlert campaign={currentCampaign} />

      {actionError && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
          {actionError}
        </div>
      )}

      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-gray-900">Campaign Progress</h2>
          <span className="text-sm text-gray-600">{progressPercent}%</span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-3 mb-4">
          <div className="bg-primary-600 h-3 rounded-full" style={{ width: `${progressPercent}%` }} />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="p-4 rounded-lg bg-gray-50">
            <p className="text-xs text-gray-500">Total Leads</p>
            <p className="text-2xl font-semibold text-gray-900">{totalLeads}</p>
          </div>
          <div className="p-4 rounded-lg bg-green-50">
            <p className="text-xs text-green-700">Interested</p>
            <p className="text-2xl font-semibold text-green-700">{getCampaignStat('interested')}</p>
          </div>
          <div className="p-4 rounded-lg bg-red-50">
            <p className="text-xs text-red-700">Not Interested</p>
            <p className="text-2xl font-semibold text-red-700">{getCampaignStat('notInterested')}</p>
          </div>
          <div className="p-4 rounded-lg bg-yellow-50">
            <p className="text-xs text-yellow-700">Callbacks</p>
            <p className="text-2xl font-semibold text-yellow-700">{getCampaignStat('callback')}</p>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Leads</h2>
            <p className="text-sm text-gray-600 mt-1">Manage leads for this campaign only</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowManualForm(true)}
              className="px-4 py-2 rounded-md bg-green-600 text-white hover:bg-green-700"
            >
              Add Lead
            </button>
            <button
              onClick={() => setShowUpload(true)}
              className="px-4 py-2 rounded-md bg-primary-600 text-white hover:bg-primary-700"
            >
              Upload CSV
            </button>
          </div>
        </div>

        {leadsError && (
          <div className="mb-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
            {leadsError}
          </div>
        )}

        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
            <div className="p-3 rounded bg-gray-50 text-center">
              <p className="text-xs text-gray-500">Pending</p>
              <p className="text-lg font-semibold text-gray-800">{stats.pending || 0}</p>
            </div>
            <div className="p-3 rounded bg-blue-50 text-center">
              <p className="text-xs text-blue-600">Calling</p>
              <p className="text-lg font-semibold text-blue-700">{stats.calling || 0}</p>
            </div>
            <div className="p-3 rounded bg-green-50 text-center">
              <p className="text-xs text-green-600">Completed</p>
              <p className="text-lg font-semibold text-green-700">{stats.completed || 0}</p>
            </div>
            <div className="p-3 rounded bg-red-50 text-center">
              <p className="text-xs text-red-600">Failed</p>
              <p className="text-lg font-semibold text-red-700">{stats.failed || 0}</p>
            </div>
            <div className="p-3 rounded bg-yellow-50 text-center">
              <p className="text-xs text-yellow-600">Scheduled</p>
              <p className="text-lg font-semibold text-yellow-700">{stats.scheduled || 0}</p>
            </div>
          </div>
        )}

        {leadsLoading && !stats ? (
          <div className="text-sm text-gray-600">Loading lead stats...</div>
        ) : null}

        <LeadsList campaignId={campaignId} />
      </div>

      {showUpload && (
        <LeadUpload
          campaignId={campaignId}
          onClose={() => setShowUpload(false)}
          onSuccess={refreshCampaignData}
        />
      )}

      {showManualForm && (
        <LeadForm
          campaignId={campaignId}
          campaign={currentCampaign}
          onClose={() => setShowManualForm(false)}
          onSuccess={refreshCampaignData}
        />
      )}
    </div>
  );
};

export default CampaignDetail;
