import { useCallback, useEffect, useState } from 'react';
import axios from '../../utils/axios';
import { getCallOutcomeBadge } from '../../utils/callOutcome';

const BATCHES = [
  { id: '500', label: '500' },
  { id: '1000', label: '1,000' },
  { id: '5000', label: '5,000' },
  { id: '10000', label: '10,000' },
  { id: 'all', label: 'All eligible' },
];

const localDateInput = (daysAgo) => {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
};

const formatCount = (value) => Number(value || 0).toLocaleString();

const formatDuration = (seconds) => {
  const safe = Number(seconds) || 0;
  if (safe <= 0) return '0s';
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
};

const Stat = ({ label, value, detail, tone = 'slate' }) => {
  const tones = {
    slate: 'bg-slate-50 border-slate-200 text-slate-900',
    amber: 'bg-amber-50 border-amber-200 text-amber-950',
    emerald: 'bg-emerald-50 border-emerald-200 text-emerald-950',
    sky: 'bg-sky-50 border-sky-200 text-sky-950',
  };
  return (
    <div className={`rounded-xl border p-4 ${tones[tone]}`}>
      <div className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</div>
      <div className="mt-1 text-3xl font-semibold tracking-tight">
        {value === null || value === undefined ? '—' : formatCount(value)}
      </div>
      {detail ? <p className="mt-1 text-xs text-gray-600">{detail}</p> : null}
    </div>
  );
};

const ExtractionBackfillPanel = ({ campaigns = [] }) => {
  const [since, setSince] = useState(() => localDateInput(7));
  const [until, setUntil] = useState('');
  const [campaignId, setCampaignId] = useState('');
  const [batch, setBatch] = useState('500');
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const loadStats = useCallback(async () => {
    if (!since) {
      setStats(null);
      setLoading(false);
      return;
    }
    try {
      setError('');
      const params = { since };
      if (until) params.until = until;
      if (campaignId) params.campaignId = campaignId;
      const response = await axios.get('/admin/extraction/backfill', { params });
      setStats(response.data?.data || null);
    } catch (err) {
      setError(err.response?.data?.message || 'Could not load post-call processing stats');
    } finally {
      setLoading(false);
    }
  }, [since, until, campaignId]);

  useEffect(() => {
    setLoading(true);
    setConfirming(false);
    setNotice('');
    const timer = setTimeout(loadStats, 200);
    return () => clearTimeout(timer);
  }, [loadStats]);

  useEffect(() => {
    const pending = stats?.queue?.backfillPending || 0;
    const active = stats?.queue?.backfillRunning;
    if (!pending && !active) return undefined;

    const queueTimer = setInterval(async () => {
      try {
        const response = await axios.get('/admin/extraction/queue');
        const queue = response.data?.data;
        if (queue) {
          setStats((current) => (current ? { ...current, queue } : current));
        }
      } catch {
        // The next full refresh will surface a real error.
      }
    }, 4000);

    const statsTimer = setInterval(loadStats, 15000);
    return () => {
      clearInterval(queueTimer);
      clearInterval(statsTimer);
    };
  }, [loadStats, stats?.queue?.backfillPending, stats?.queue?.backfillRunning]);

  const ready = stats?.ready || 0;
  const cap = stats?.batchCap || 10000;
  const planned = batch === 'all' ? Math.min(ready, cap) : Math.min(Number(batch) || 0, ready);

  const runBatch = async () => {
    if (!since || planned < 1) return;
    try {
      setRunning(true);
      setError('');
      setNotice('');
      const response = await axios.post('/admin/extraction/backfill', {
        since,
        until: until || undefined,
        campaignId: campaignId || undefined,
        limit: batch === 'all' ? 'all' : Number(batch),
      });
      const data = response.data?.data;
      setNotice(response.data?.message || `Queued ${data?.enqueued || 0} calls.`);
      setConfirming(false);
      await loadStats();
    } catch (err) {
      setError(err.response?.data?.message || 'Could not queue post-call processing');
    } finally {
      setRunning(false);
    }
  };

  const queue = stats?.queue;
  const queueBusy = (queue?.backfillPending || 0) > 0 || queue?.backfillRunning;

  return (
    <section className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">Post-call processing</h2>
          <p className="mt-1 max-w-3xl text-sm text-gray-600">
            Counts update from the filters below. Only calls on or after the start date are included, so older test calls are not sent to Gemini. A call is eligible when it has a transcript and post-call processing has not succeeded.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => { setSince('2026-10-09'); setUntil(''); }} className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50">From Oct 9</button>
          <button type="button" onClick={() => { setSince(localDateInput(1)); setUntil(''); }} className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50">Since yesterday</button>
          <button type="button" onClick={() => { setSince(localDateInput(7)); setUntil(''); }} className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50">Past 7 days</button>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-4">
        <label className="block text-sm">
          <span className="mb-1.5 block font-medium text-gray-700">Process calls after</span>
          <input
            type="date"
            value={since}
            onChange={(event) => setSince(event.target.value)}
            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1.5 block font-medium text-gray-700">Through date</span>
          <input
            type="date"
            value={until}
            onChange={(event) => setUntil(event.target.value)}
            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
          />
        </label>
        <label className="block text-sm md:col-span-2">
          <span className="mb-1.5 block font-medium text-gray-700">Campaign</span>
          <select
            value={campaignId}
            onChange={(event) => setCampaignId(event.target.value)}
            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
          >
            <option value="">All campaigns</option>
            {campaigns.map((campaign) => (
              <option key={campaign._id} value={campaign._id}>{campaign.name}</option>
            ))}
          </select>
        </label>
      </div>

      {error ? (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      ) : null}

      <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Not processed"
          value={loading && !stats ? null : stats?.notProcessed}
          detail={stats?.notConnected
            ? `${formatCount(stats.notConnected)} have a transcript but the call never connected`
            : 'Finished calls in this window with no successful extraction'}
          tone="slate"
        />
        <Stat
          label="Eligible"
          value={loading && !stats ? null : stats?.eligible}
          detail={stats?.failedEarlier ? `${formatCount(stats.failedEarlier)} failed an earlier attempt` : 'Transcript exists and Gemini has not finished'}
          tone="amber"
        />
        <Stat
          label="No transcript"
          value={loading && !stats ? null : stats?.noTranscript}
          detail="Cannot be processed. These do not use credits"
          tone="sky"
        />
        <Stat
          label="Ready to queue"
          value={loading && !stats ? null : stats?.ready}
          detail={(stats?.alreadyQueued || stats?.alreadyInFlight)
            ? `${formatCount(stats.alreadyQueued)} waiting, ${formatCount(stats.alreadyInFlight)} running`
            : 'Eligible calls not already in the queue'}
          tone="emerald"
        />
      </div>

      <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700">
        {queueBusy ? (
          <span>
            Historical queue: <strong>{formatCount(queue?.backfillPending)}</strong> waiting
            {queue?.backfillRunning ? ', 1 running' : ''}.
            {' '}Live calls are processed first{queue?.priorityPending ? ` (${formatCount(queue.priorityPending)} waiting)` : ''}. Historical calls then run one at a time.
          </span>
        ) : (
          <span>Historical queue is empty. Live calls keep priority. A batch started here waits until those finish, then runs one call at a time.</span>
        )}
      </div>

      <div className="mt-6">
        <div className="mb-2 flex items-baseline justify-between gap-3">
          <h3 className="text-sm font-semibold text-gray-900">Eligible calls</h3>
          <p className="text-xs text-gray-500">
            {stats?.eligible
              ? `Newest ${Math.min(stats.sample?.length || 0, stats.sampleLimit || 12)} of ${formatCount(stats.eligible)}`
              : 'None in this window'}
          </p>
        </div>
        {!stats?.sample?.length ? (
          <div className="rounded-xl border border-dashed border-gray-200 px-4 py-8 text-center text-sm text-gray-500">
            {loading ? 'Loading eligible calls...' : 'No calls with a transcript are waiting for post-call processing in this window.'}
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-gray-200">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-3 py-2 font-medium">Lead</th>
                  <th className="px-3 py-2 font-medium">Campaign</th>
                  <th className="px-3 py-2 font-medium">Result</th>
                  <th className="px-3 py-2 font-medium">Duration</th>
                  <th className="px-3 py-2 font-medium">Created</th>
                  <th className="px-3 py-2 font-medium">Extraction</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {stats.sample.map((row) => {
                  const badge = getCallOutcomeBadge(row);
                  return (
                    <tr key={row.id}>
                      <td className="px-3 py-2">
                        <div className="font-medium text-gray-900">{row.leadName}</div>
                        <div className="text-xs text-gray-500">{row.phone || 'No phone'}</div>
                      </td>
                      <td className="px-3 py-2 text-gray-700">{row.campaignName}</td>
                      <td className="px-3 py-2">
                        {badge ? (
                          <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${badge.color}`}>{badge.label}</span>
                        ) : (
                          <span className="text-gray-400">{row.status || '—'}</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-gray-700">{formatDuration(row.durationSeconds)}</td>
                      <td className="px-3 py-2 text-gray-700">{row.createdAt ? new Date(row.createdAt).toLocaleString() : '—'}</td>
                      <td className="px-3 py-2 text-gray-700">{row.failedEarlier ? 'Failed earlier' : 'Not run'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="mt-6 border-t border-gray-100 pt-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="text-sm font-medium text-gray-700">Batch size</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {BATCHES.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => { setBatch(option.id); setConfirming(false); }}
                  className={`rounded-lg px-3 py-1.5 text-sm font-medium ${batch === option.id ? 'bg-gray-900 text-white' : 'border border-gray-200 bg-white text-gray-700 hover:bg-gray-50'}`}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-gray-500">
              {batch === 'all' && ready > cap
                ? `All eligible is larger than one batch. This run queues the oldest ${formatCount(cap)} and leaves ${formatCount(ready - cap)} for the next run.`
                : `This run queues ${formatCount(planned)} call${planned === 1 ? '' : 's'}. The largest single batch is ${formatCount(cap)}.`}
            </p>
          </div>

          {!confirming ? (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              disabled={running || loading || planned < 1}
              className="rounded-lg bg-gray-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Process {formatCount(planned)} call{planned === 1 ? '' : 's'}
            </button>
          ) : (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
              <p className="text-sm text-amber-950">
                Send {formatCount(planned)} transcript{planned === 1 ? '' : 's'} to Gemini? Calls before {since} stay untouched.
              </p>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={runBatch}
                  disabled={running}
                  className="rounded-lg bg-gray-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                >
                  {running ? 'Queuing...' : 'Queue this batch'}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  disabled={running}
                  className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
        {notice ? <p className="mt-3 text-sm text-emerald-700">{notice}</p> : null}
      </div>
    </section>
  );
};

export default ExtractionBackfillPanel;
