import { useEffect, useState, useLayoutEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import {
  fetchCampaignSessions,
  setCampaignSessionsFilters,
  setCurrentCampaignId,
} from '../../store/slices/campaignSessionsSlice';
import { callOutcomeSeverity, getCallOutcomeBadge, CALL_OUTCOME_OPTIONS } from '../../utils/callOutcome';
import { formatAvailability, availabilityCloseness } from '../../utils/availability';
import DurationFilter from '../../components/calls/DurationFilter';
import MultiSelect from '../../components/calls/MultiSelect';
import axios from '../../utils/axios';

const CampaignSessions = () => {
  const { campaignId } = useParams();
  const navigate = useNavigate();
  const dispatch = useDispatch();

  const {
    sessions,
    loading: loadingSessions,
    loadingMore,
    hasMore,
    total,
    error: sessionsError,
    filters,
    currentCampaignId
  } = useSelector((state) => state.campaignSessions);
  
  const {
    status: statusFilter,
    callOutcome: outcomeFilter,
    interestLevel: interestFilter,
    extraction: extractionFilter,
    callbackRequested: callbackFilter,
    availabilityOn,
    hasAvailability,
    search: reduxSearch,
    sortBy,
    sortDir,
    durationOp,
    durationSeconds,
    durationSecondsTo,
  } = filters;

  const [search, setSearch] = useState(reduxSearch || '');
  const [campaignName, setCampaignName] = useState('');
  const [isExporting, setIsExporting] = useState(false);

  const formatDuration = (durationSeconds) => {
    const safeSeconds = Number(durationSeconds) || 0;
    if (safeSeconds <= 0) return '0s';
    const mins = Math.floor(safeSeconds / 60);
    const secs = safeSeconds % 60;
    return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
  };

  const getStatusClass = (status) => {
    const map = {
      completed: 'bg-green-100 text-green-800',
      connected: 'bg-blue-100 text-blue-800',
      initiated: 'bg-slate-100 text-slate-700',
      queued: 'bg-slate-100 text-slate-700',
      ringing: 'bg-indigo-100 text-indigo-800',
      scheduled: 'bg-purple-100 text-purple-800',
      no_answer: 'bg-yellow-100 text-yellow-800',
      busy: 'bg-orange-100 text-orange-800',
      failed: 'bg-red-100 text-red-800',
      canceled: 'bg-red-100 text-red-800',
      exhausted: 'bg-red-100 text-red-800',
      voicemail: 'bg-cyan-100 text-cyan-800',
    };
    return map[status] || 'bg-gray-100 text-gray-800';
  };

  const applyFilters = (updates) => {
    const newFilters = { ...filters, ...updates };
    dispatch(setCampaignSessionsFilters(updates));
    dispatch(fetchCampaignSessions({ ...newFilters, campaignId, limit: 100, offset: 0 }));
  };

  const handleLoadMore = () => {
    dispatch(
      fetchCampaignSessions({
        ...filters,
        campaignId,
        limit: 100,
        offset: sessions.length,
      })
    );
  };

  useEffect(() => {
    // Only fetch if we are loading a NEW campaign or have no sessions
    if (campaignId !== currentCampaignId || sessions.length === 0) {
      dispatch(setCurrentCampaignId(campaignId));
      dispatch(fetchCampaignSessions({ ...filters, campaignId, limit: 100, offset: 0 }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId, dispatch]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      if (search !== reduxSearch) {
        applyFilters({ search });
      }
    }, 300);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  // Restore scroll position synchronously before browser paint to prevent flashing
  useLayoutEffect(() => {
    if (sessions.length > 0) {
      const savedScroll = sessionStorage.getItem('campaignSessionsScrollPos');
      if (savedScroll) {
        const container = document.getElementById('main-scroll-container');
        if (container) {
          container.scrollTop = parseInt(savedScroll, 10);
        }
        sessionStorage.removeItem('campaignSessionsScrollPos');
      }
    }
  }, [sessions.length]);

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const queryParams = new URLSearchParams();
      if (statusFilter) queryParams.append('status', statusFilter);
      if (outcomeFilter) queryParams.append('callOutcome', outcomeFilter);
      if (interestFilter !== '') queryParams.append('interestLevel', interestFilter);
      if (extractionFilter) queryParams.append('extraction', extractionFilter);
      if (callbackFilter) queryParams.append('callbackRequested', callbackFilter);
      if (availabilityOn) queryParams.append('availabilityOn', availabilityOn);
      if (hasAvailability) queryParams.append('hasAvailability', hasAvailability);
      if (reduxSearch) queryParams.append('search', reduxSearch);
      if (sortBy) queryParams.append('sortBy', sortBy);
      if (sortDir) queryParams.append('sortDir', sortDir);
      if (durationOp) queryParams.append('durationOp', durationOp);
      if (durationSeconds !== '') queryParams.append('durationSeconds', durationSeconds);
      if (durationSecondsTo !== '') queryParams.append('durationSecondsTo', durationSecondsTo);
      const response = await axios.get(`/campaigns/${campaignId}/sessions/export?${queryParams.toString()}`, {
        responseType: 'blob',
      });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `campaign_${campaignId}_sessions.csv`);
      document.body.appendChild(link);
      link.click();
      link.parentNode.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error exporting sessions:', error);
      alert('Failed to export sessions. Please try again.');
    } finally {
      setIsExporting(false);
    }
  };

  const toggleSort = (field) => {
    const nextDir = sortBy === field && sortDir === 'desc' ? 'asc' : 'desc';
    if (field === 'availability') {
      applyFilters({ sortBy: field, sortDir: nextDir, hasAvailability: 'yes' });
      return;
    }
    applyFilters({ sortBy: field, sortDir: nextDir, hasAvailability: '' });
  };

  const freeTimeSort = sortBy === 'availability' ? (sortDir === 'asc' ? 'soonest' : 'latest') : '';

  const handleOpenSession = (session) => {
    const container = document.getElementById('main-scroll-container');
    if (container) {
      sessionStorage.setItem('campaignSessionsScrollPos', container.scrollTop.toString());
    }
    navigate(`/cm/campaigns/${campaignId}/sessions/${session._id}`);
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <button
            onClick={() => navigate(`/cm/campaigns/${campaignId}`)}
            className="text-sm text-blue-600 hover:text-blue-800 mb-2"
          >
            ← Back to Campaign Details
          </button>
          <h1 className="text-3xl font-bold text-gray-900">Campaign Call Sessions</h1>
          <p className="text-gray-600 mt-2">
            {campaignName || `Campaign ID: ${campaignId}`}
          </p>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow p-4 grid grid-cols-1 md:grid-cols-4 gap-4">
        <MultiSelect
          label="Call result"
          placeholder="All results"
          options={CALL_OUTCOME_OPTIONS.filter((option) => option.value)}
          value={outcomeFilter}
          onChange={(callOutcome) => applyFilters({ callOutcome })}
        />

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Progress</label>
          <select
            value={statusFilter}
            onChange={(e) => applyFilters({ status: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
          >
            <option value="">All calls</option>
            <option value="in_progress">Still calling</option>
            <option value="finished">Finished</option>
          </select>
        </div>

        <MultiSelect
          label="Interest score"
          placeholder="All scores"
          options={[
            { value: '0', label: '0 - Unknown' },
            ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((score) => ({ value: String(score), label: String(score) })),
          ]}
          value={interestFilter}
          onChange={(interestLevel) => applyFilters({ interestLevel })}
        />

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Post-call processing</label>
          <select
            value={extractionFilter || ''}
            onChange={(e) => applyFilters({ extraction: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
          >
            <option value="">All calls</option>
            <option value="processed">Interest generated</option>
            <option value="unprocessed">Not processed</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Callback requested</label>
          <select
            value={callbackFilter || ''}
            onChange={(e) => applyFilters({ callbackRequested: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
          >
            <option value="">All calls</option>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Free time</label>
          <select
            value={freeTimeSort}
            onChange={(e) => {
              if (e.target.value === 'soonest') {
                applyFilters({ hasAvailability: 'yes', sortBy: 'availability', sortDir: 'asc' });
                return;
              }
              if (e.target.value === 'latest') {
                applyFilters({ hasAvailability: 'yes', sortBy: 'availability', sortDir: 'desc' });
                return;
              }
              applyFilters({ hasAvailability: '', sortBy: 'createdAt', sortDir: 'desc' });
            }}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
          >
            <option value="">All calls</option>
            <option value="soonest">Soonest free time</option>
            <option value="latest">Latest free time</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Free on</label>
          <input
            type="date"
            value={availabilityOn || ''}
            onChange={(e) => applyFilters({ availabilityOn: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Sort</label>
          <select
            value={freeTimeSort ? '' : `${sortBy || 'createdAt'}:${sortDir || 'desc'}`}
            onChange={(e) => {
              const [nextSortBy, nextSortDir] = e.target.value.split(':');
              applyFilters({ sortBy: nextSortBy, sortDir: nextSortDir, hasAvailability: '' });
            }}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
          >
            {freeTimeSort ? <option value="">Using free time</option> : null}
            <option value="createdAt:desc">Newest first</option>
            <option value="createdAt:asc">Oldest first</option>
            <option value="duration:desc">Longest first</option>
            <option value="duration:asc">Shortest first</option>
            <option value="interest:desc">Interest high to low</option>
            <option value="interest:asc">Interest low to high</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Search</label>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Lead name, phone, summary..."
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
        </div>

        <DurationFilter
          op={durationOp || 'above'}
          totalSeconds={durationSeconds ?? ''}
          totalSecondsTo={durationSecondsTo ?? ''}
          onChange={(next) => applyFilters(next)}
        />
      </div>

      <div className="bg-white rounded-lg shadow overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-200 flex justify-between items-center">
          <h2 className="text-lg font-semibold text-gray-900">
            {total || 0} session{total === 1 ? '' : 's'} match these filters
          </h2>
          <div className="flex items-center gap-2">
            <button
              onClick={handleExport}
              disabled={isExporting}
              className="text-sm px-3 py-1.5 bg-blue-600 text-white hover:bg-blue-700 rounded-md transition-colors disabled:opacity-50"
            >
              {isExporting ? 'Exporting...' : 'Export filtered CSV'}
            </button>
            <button
              onClick={() => dispatch(fetchCampaignSessions({ ...filters, campaignId, limit: 100, offset: 0 }))}
              className="text-sm px-3 py-1.5 bg-gray-100 text-gray-700 hover:bg-gray-200 rounded-md transition-colors flex items-center gap-1"
            >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
            </svg>
            Refresh
          </button>
          </div>
        </div>

        {loadingSessions && sessions.length === 0 ? (
          <div className="p-8 text-center text-gray-500">Loading sessions...</div>
        ) : sessionsError ? (
          <div className="p-8 text-center text-red-600">{sessionsError}</div>
        ) : sessions.length === 0 ? (
          <div className="p-8 text-center text-gray-500">No sessions found.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Lead</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Call Status</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Attempt</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    <button type="button" onClick={() => toggleSort('interest')} className="uppercase">Interest</button>
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    <button type="button" onClick={() => toggleSort('availability')} className="uppercase">Free at</button>
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    <button type="button" onClick={() => toggleSort('duration')} className="uppercase">Duration</button>
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    <button type="button" onClick={() => toggleSort('createdAt')} className="uppercase">Created</button>
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Action</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {sessions.map((session) => (
                  <tr
                    key={session._id}
                    className={`hover:bg-gray-50`}
                  >
                    <td className="px-4 py-3 text-sm text-gray-900">
                      <div className="font-medium">{session.leadId?.name || 'Unknown Lead'}</div>
                      <div className="text-xs text-gray-500">
                        {session.leadId?.phoneNumber || session.leadId?.phone || 'N/A'}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {(() => {
                        const severity = callOutcomeSeverity(session);
                        const statusClass = severity === 'error'
                          ? 'bg-red-100 text-red-800'
                          : severity === 'warning'
                            ? 'bg-amber-100 text-amber-800'
                            : getStatusClass(session.status);
                        const label = severity === 'error'
                          ? 'failed'
                          : severity === 'warning'
                            ? 'warning'
                            : (session.status || 'unknown');
                        return (
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${statusClass}`}>
                            {label.replace('_', ' ')}
                          </span>
                        );
                      })()}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {(() => {
                        const badge = getCallOutcomeBadge(session);
                        if (!badge) return <span className="text-gray-400 text-xs">—</span>;
                        return (
                          <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold ${badge.color}`}>
                            <span className="text-[11px]">{badge.icon}</span>
                            {badge.label}
                          </span>
                        );
                      })()}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700">{session.attemptIndex || 1}</td>
                    <td className="px-4 py-3 text-sm text-gray-700">
                      {session.extractor?.success
                        ? (session.extracted?.interest_level === undefined || session.extracted?.interest_level === ''
                          ? '0'
                          : String(session.extracted.interest_level))
                        : 'Not processed'}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700">
                      {session.extractor?.success ? (
                        <div>
                          {availabilityCloseness(session.extracted?.availability) && (
                            <div className="text-xs font-semibold text-amber-800">
                              {availabilityCloseness(session.extracted?.availability)}
                            </div>
                          )}
                          <div>{formatAvailability(session.extracted?.availability) || session.extracted?.callback_time || '—'}</div>
                        </div>
                      ) : '—'}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700">
                      {formatDuration(session.durationSeconds)}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700">
                      {new Date(session.createdAt).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      <button
                        onClick={() => handleOpenSession(session)}
                        className="text-blue-600 hover:text-blue-800"
                      >
                        Open
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {hasMore && (
              <div className="flex justify-center p-4 border-t border-gray-200">
                <button
                  onClick={handleLoadMore}
                  disabled={loadingMore}
                  className="px-4 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50"
                >
                  {loadingMore ? 'Loading...' : 'Load More'}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default CampaignSessions;
