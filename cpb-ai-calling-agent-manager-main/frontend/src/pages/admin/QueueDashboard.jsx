import { useCallback, useEffect, useMemo, useState } from 'react';
import axios from '../../utils/axios';
import { format } from 'date-fns';
import ExtractionBackfillPanel from '../../components/admin/ExtractionBackfillPanel';

const emptyMetrics = {
  queueStats: {
    totalJobs: 0,
    waitingCount: 0,
    claimedCount: 0,
    completedCount: 0,
    deadLetterCount: 0,
    avgAttempts: 0,
    maxAttempts: 0,
  },
  workerStats: {},
  successRate: 'N/A',
};

const QueueDashboard = () => {
  const [campaigns, setCampaigns] = useState([]);
  const [selectedCampaignId, setSelectedCampaignId] = useState('');
  const [globalMetrics, setGlobalMetrics] = useState(null);
  const [campaignMetrics, setCampaignMetrics] = useState(null);
  const [deadLetters, setDeadLetters] = useState([]);
  const [deadLetterTotal, setDeadLetterTotal] = useState(0);
  const [selectedJobIds, setSelectedJobIds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState('');

  const fetchCampaigns = useCallback(async () => {
    const response = await axios.get('/admin/campaigns');
    const list = response.data?.data || [];
    setCampaigns(list);
    if (!selectedCampaignId && list.length > 0) {
      setSelectedCampaignId(list[0]._id);
    }
  }, [selectedCampaignId]);

  const fetchGlobalMetrics = useCallback(async () => {
    const response = await axios.get('/admin/queue/global');
    setGlobalMetrics(response.data?.data || emptyMetrics);
  }, []);

  const fetchCampaignMetrics = useCallback(async (campaignId) => {
    if (!campaignId) {
      setCampaignMetrics(null);
      setDeadLetters([]);
      setDeadLetterTotal(0);
      return;
    }

    const [metricsResponse, deadLetterResponse] = await Promise.all([
      axios.get('/admin/queue/metrics', { params: { campaignId } }),
      axios.get('/admin/queue/dead-letter', { params: { campaignId, limit: 25, skip: 0 } }),
    ]);

    setCampaignMetrics(metricsResponse.data?.data || emptyMetrics);
    setDeadLetters(deadLetterResponse.data?.data?.deadLetterJobs || []);
    setDeadLetterTotal(deadLetterResponse.data?.data?.total || 0);
    setSelectedJobIds([]);
  }, []);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      await fetchCampaigns();
      await fetchGlobalMetrics();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load queue dashboard');
    } finally {
      setLoading(false);
    }
  }, [fetchCampaignMetrics, fetchCampaigns, fetchGlobalMetrics]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!selectedCampaignId) return;

    (async () => {
      try {
        setError('');
        await fetchCampaignMetrics(selectedCampaignId);
      } catch (err) {
        setError(err.response?.data?.message || 'Failed to load campaign queue metrics');
      }
    })();
  }, [fetchCampaignMetrics, selectedCampaignId]);

  const handleReplaySelected = async () => {
    if (!selectedCampaignId || selectedJobIds.length === 0) return;

    try {
      setActionLoading(true);
      await axios.post('/admin/queue/dead-letter/replay', {
        campaignId: selectedCampaignId,
        jobIds: selectedJobIds,
      });
      await fetchCampaignMetrics(selectedCampaignId);
      await fetchGlobalMetrics();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to replay selected jobs');
    } finally {
      setActionLoading(false);
    }
  };

  const handleReplayAllVisible = async () => {
    if (!selectedCampaignId || deadLetters.length === 0) return;

    try {
      setActionLoading(true);
      await axios.post('/admin/queue/dead-letter/replay', {
        campaignId: selectedCampaignId,
        jobIds: deadLetters.map((job) => job._id),
      });
      await fetchCampaignMetrics(selectedCampaignId);
      await fetchGlobalMetrics();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to replay dead-letter jobs');
    } finally {
      setActionLoading(false);
    }
  };

  const toggleJobSelection = (jobId) => {
    setSelectedJobIds((current) => (
      current.includes(jobId)
        ? current.filter((id) => id !== jobId)
        : [...current, jobId]
    ));
  };

  const queueStats = useMemo(() => {
    if (selectedCampaignId && campaignMetrics) {
      const status = campaignMetrics.statusBreakdown || {};
      const retryDistribution = campaignMetrics.retryDistribution || {};
      const retryEntriesForAverage = Object.entries(retryDistribution)
        .map(([key, value]) => [Number(key.replace('attempt_', '')), Number(value) || 0])
        .filter(([attempt]) => Number.isFinite(attempt) && attempt > 0);
      const retryTotal = retryEntriesForAverage.reduce((sum, [, count]) => sum + count, 0);
      const weightedAttempts = retryEntriesForAverage.reduce((sum, [attempt, count]) => sum + (attempt * count), 0);

      return {
        totalJobs: campaignMetrics.queueDepth || 0,
        waitingCount: status.waitingCount || 0,
        claimedCount: status.claimedCount || 0,
        completedCount: status.completedCount || 0,
        deadLetterCount: campaignMetrics.deadLetterCount || 0,
        avgAttempts: retryTotal > 0 ? weightedAttempts / retryTotal : 0,
        maxAttempts: retryEntriesForAverage.length > 0
          ? Math.max(...retryEntriesForAverage.map(([attempt]) => attempt))
          : 0,
      };
    }

    return globalMetrics?.queueStats || emptyMetrics.queueStats;
  }, [campaignMetrics, globalMetrics, selectedCampaignId]);

  const workerStats = selectedCampaignId ? (campaignMetrics?.workerStats || {}) : (globalMetrics?.workerStats || {});
  const healthScore = selectedCampaignId
    ? (campaignMetrics?.healthScore ?? 100)
    : (globalMetrics?.healthScore ?? 100);

  const retryEntries = useMemo(() => {
    const distribution = selectedCampaignId
      ? campaignMetrics?.retryDistribution
      : globalMetrics?.retryDistribution;

    if (!distribution) return [];

    return Object.entries(distribution)
      .filter(([key]) => key.startsWith('attempt_'))
      .sort((a, b) => Number(a[0].split('_')[1]) - Number(b[0].split('_')[1]));
  }, [campaignMetrics, globalMetrics, selectedCampaignId]);

  if (loading && !globalMetrics) {
    return (
      <div className="p-6 flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Queue Dashboard</h1>
          <p className="text-gray-600 mt-1">Monitor retry health, worker load, and dead-letter jobs</p>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
          <select
            value={selectedCampaignId}
            onChange={(e) => setSelectedCampaignId(e.target.value)}
            className="px-4 py-2 border border-gray-300 rounded-lg bg-white focus:ring-2 focus:ring-blue-500"
          >
            <option value="">Global metrics</option>
            {campaigns.map((campaign) => (
              <option key={campaign._id} value={campaign._id}>
                {campaign.name}
              </option>
            ))}
          </select>

          <button
            onClick={refresh}
            className="px-4 py-2 rounded-lg bg-gray-900 text-white hover:bg-gray-800 transition-colors"
          >
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <MetricCard title="Queue depth" value={queueStats.totalJobs || 0} accent="blue" />
        <MetricCard title="Waiting" value={queueStats.waitingCount || 0} accent="emerald" />
        <MetricCard title="Claimed" value={queueStats.claimedCount || 0} accent="amber" />
        <MetricCard title="Dead letters" value={queueStats.deadLetterCount || 0} accent="rose" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
          <div className="flex items-start justify-between gap-4 mb-6">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Health overview</h2>
              <p className="text-sm text-gray-500">Current queue health and worker capacity</p>
            </div>
            <span className="px-3 py-1 text-xs font-semibold rounded-full bg-blue-50 text-blue-700">
              Health {healthScore}/100
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <InfoBlock label="Completed" value={queueStats.completedCount || 0} />
            <InfoBlock label="Avg attempts" value={Number(queueStats.avgAttempts || 0).toFixed(2)} />
            <InfoBlock label="Max attempts" value={queueStats.maxAttempts || 0} />
            <InfoBlock label="Success rate" value={globalMetrics?.successRate || 'N/A'} />
            <InfoBlock label="Active campaigns" value={workerStats?.activeCampaigns || globalMetrics?.queueStats?.totalCampaigns?.length || 0} />
            <InfoBlock label="Global concurrency" value={`${workerStats?.globalConcurrency || 0}/${workerStats?.maxGlobalConcurrency || 2}`} />
          </div>

          <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="rounded-xl border border-gray-100 p-4">
              <div className="text-sm font-medium text-gray-700 mb-3">Worker stats</div>
              <dl className="space-y-2 text-sm">
                <StatRow label="Worker ID" value={workerStats.workerId || 'N/A'} />
                <StatRow label="Campaigns running" value={workerStats.activeCampaigns ?? 0} />
                <StatRow label="Concurrency in use" value={workerStats.globalConcurrency ?? 0} />
                <StatRow label="Max concurrency" value={workerStats.maxGlobalConcurrency ?? 2} />
              </dl>
            </div>

            <div className="rounded-xl border border-gray-100 p-4">
              <div className="text-sm font-medium text-gray-700 mb-3">Retry attempts</div>
              <div className="space-y-3">
                {retryEntries.length > 0 ? retryEntries.map(([key, value]) => {
                  const attempt = key.split('_')[1];
                  const maxVal = Math.max(...retryEntries.map(([, v]) => Number(v) || 0), 1);
                  const width = `${Math.min(100, ((Number(value) || 0) / maxVal) * 100)}%`;
                  return (
                    <div key={key}>
                      <div className="flex items-center justify-between text-xs text-gray-600 mb-1">
                        <span>Attempt {attempt}</span>
                        <span>{value}</span>
                      </div>
                      <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
                        <div className="h-2 rounded-full bg-indigo-500" style={{ width }} />
                      </div>
                    </div>
                  );
                }) : (
                  <p className="text-sm text-gray-500">No retry distribution data yet.</p>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Quick actions</h2>
          <div className="space-y-3 text-sm">
            <ActionChip label="Replay selected dead-letter jobs" />
            <ActionChip label="Track queue-tail retries" />
            <ActionChip label="Watch lease expiry recovery" />
            <ActionChip label="Use campaign selector for focused metrics" />
          </div>

          <div className="mt-6 rounded-xl bg-gray-50 p-4 border border-gray-100">
            <div className="text-sm font-medium text-gray-700 mb-2">Selected campaign</div>
            <div className="text-sm text-gray-600">{selectedCampaignId || 'Global view'}</div>
          </div>

          <div className="mt-4 rounded-xl bg-blue-50 p-4 border border-blue-100">
            <div className="text-sm font-medium text-blue-900 mb-1">Replay safety</div>
            <p className="text-sm text-blue-800">
              Replay only dead-letter jobs you want to reprocess. The queue remains idempotent.
            </p>
          </div>
        </div>
      </div>

      <ExtractionBackfillPanel campaigns={campaigns} />


      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Dead-letter jobs</h2>
            <p className="text-sm text-gray-500">Total {deadLetterTotal} jobs available for replay</p>
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              onClick={handleReplaySelected}
              disabled={!selectedJobIds.length || actionLoading || !selectedCampaignId}
              className="px-4 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Replay selected ({selectedJobIds.length})
            </button>
            <button
              onClick={handleReplayAllVisible}
              disabled={!deadLetters.length || actionLoading || !selectedCampaignId}
              className="px-4 py-2 rounded-lg bg-gray-900 text-white hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Replay visible ({deadLetters.length})
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Select</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Lead</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Attempt</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Reason</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Updated</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {!selectedCampaignId ? (
                <tr>
                  <td colSpan="6" className="px-4 py-12 text-center text-gray-500">
                    Select a campaign to inspect dead-letter jobs.
                  </td>
                </tr>
              ) : deadLetters.length === 0 ? (
                <tr>
                  <td colSpan="6" className="px-4 py-12 text-center text-gray-500">
                    No dead-letter jobs for this campaign.
                  </td>
                </tr>
              ) : (
                deadLetters.map((job) => (
                  <tr key={job._id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={selectedJobIds.includes(job._id)}
                        onChange={() => toggleJobSelection(job._id)}
                        className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-sm font-medium text-gray-900">{job.leadId?.name || 'Unknown lead'}</div>
                      <div className="text-xs text-gray-500">{job.leadId?.phoneNumber || job.leadId?.phone || 'N/A'}</div>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700">{job.attemptCount}</td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-1 rounded-full text-xs font-semibold bg-red-100 text-red-700">
                        {job.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700">
                      {job.lastError?.errorMessage || job.retryReason || 'N/A'}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-500">
                      {job.updatedAt ? format(new Date(job.updatedAt), 'MMM dd, yyyy HH:mm') : 'N/A'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

const MetricCard = ({ title, value, accent }) => {
  const accentClasses = {
    blue: 'from-blue-500 to-indigo-600',
    emerald: 'from-emerald-500 to-green-600',
    amber: 'from-amber-500 to-orange-600',
    rose: 'from-rose-500 to-pink-600',
  };

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
      <div className={`h-1.5 w-14 rounded-full bg-gradient-to-r ${accentClasses[accent] || accentClasses.blue} mb-4`} />
      <div className="text-sm text-gray-500">{title}</div>
      <div className="mt-2 text-3xl font-bold text-gray-900">{value}</div>
    </div>
  );
};

const InfoBlock = ({ label, value }) => (
  <div className="rounded-xl bg-gray-50 p-4 border border-gray-100">
    <div className="text-xs uppercase tracking-wide text-gray-500">{label}</div>
    <div className="mt-1 text-lg font-semibold text-gray-900 break-all">{value}</div>
  </div>
);

const StatRow = ({ label, value }) => (
  <div className="flex items-start justify-between gap-4">
    <dt className="text-gray-500">{label}</dt>
    <dd className="text-gray-900 font-medium text-right break-all">{value}</dd>
  </div>
);

const ActionChip = ({ label }) => (
  <div className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-gray-700">
    {label}
  </div>
);

export default QueueDashboard;
