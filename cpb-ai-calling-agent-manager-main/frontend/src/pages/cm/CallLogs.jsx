import { useState, useEffect, useLayoutEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import CallLogsList from '../../components/calls/CallLogsList';
import {
  fetchProviderCallLogs,
  fetchProviderCallLogsStats,
  setFilters,
} from '../../store/slices/callLogsSlice';
import { fetchCampaigns } from '../../store/slices/campaignsSlice';
import { CALL_OUTCOME_OPTIONS } from '../../utils/callOutcome';
import DurationFilter from '../../components/calls/DurationFilter';
import MultiSelect from '../../components/calls/MultiSelect';
import { formatAvailability, availabilityCloseness } from '../../utils/availability';
import axios from '../../utils/axios';

const CallLogs = () => {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const { logs, stats, pagination, loading, filters } = useSelector((state) => state.callLogs);
  const { campaigns } = useSelector((state) => state.campaigns);

  const { campaignId: selectedCampaign, search: searchQuery, interestLevel: selectedInterest, callOutcome: selectedOutcome, extraction: selectedExtraction, callbackRequested: selectedCallback, availabilityOn, hasAvailability, dateFrom, dateTo, sortBy, sortDir, durationOp, durationSeconds, durationSecondsTo } = filters;
  
  // Local state for the search input to avoid typing lag, applied on submit
  const [localSearch, setLocalSearch] = useState(searchQuery);
  const [isExporting, setIsExporting] = useState(false);

  useEffect(() => {
    dispatch(fetchCampaigns());
    // Only fetch if we don't already have logs, so when user hits 'Back' we preserve state
    if (logs.length === 0) {
      dispatch(fetchProviderCallLogs({ ...filters, limit: 50, offset: 0 }));
      dispatch(fetchProviderCallLogsStats(filters));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dispatch]);

  // Restore scroll position synchronously before browser paint to prevent flashing
  useLayoutEffect(() => {
    if (logs.length > 0) {
      const savedScroll = sessionStorage.getItem('callLogsScrollPos');
      if (savedScroll) {
        const container = document.getElementById('main-scroll-container');
        if (container) {
          container.scrollTop = parseInt(savedScroll, 10);
        }
        sessionStorage.removeItem('callLogsScrollPos');
      }
    }
  }, [logs.length]);

  const applyFilters = (updates) => {
    const newFilters = { ...filters, ...updates };
    dispatch(setFilters(updates));
    dispatch(fetchProviderCallLogs({ ...newFilters, limit: 50, offset: 0 }));
    dispatch(fetchProviderCallLogsStats(newFilters));
  };

  const handleLoadMore = () => {
    dispatch(
      fetchProviderCallLogs({
        ...filters,
        limit: 50,
        offset: logs.length,
      })
    );
  };

  const handleViewDetails = (log) => {
    if (!log?.callSid) return;
    const container = document.getElementById('main-scroll-container');
    if (container) {
      sessionStorage.setItem('callLogsScrollPos', container.scrollTop.toString());
    }
    navigate(`/cm/logs/${log.callSid}`);
  };



  const handleSearch = (e) => {
    e.preventDefault();
    applyFilters({ search: localSearch });
  };

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const queryParams = new URLSearchParams();
      if (selectedCampaign) queryParams.append('campaignId', selectedCampaign);
      if (selectedOutcome) queryParams.append('callOutcome', selectedOutcome);
      if (selectedInterest !== '') queryParams.append('interestLevel', selectedInterest);
      if (selectedExtraction) queryParams.append('extraction', selectedExtraction);
      if (selectedCallback) queryParams.append('callbackRequested', selectedCallback);
      if (availabilityOn) queryParams.append('availabilityOn', availabilityOn);
      if (hasAvailability) queryParams.append('hasAvailability', hasAvailability);
      if (dateFrom) queryParams.append('dateFrom', dateFrom);
      if (dateTo) queryParams.append('dateTo', dateTo);
      if (searchQuery) queryParams.append('search', searchQuery);
      if (sortBy) queryParams.append('sortBy', sortBy);
      if (sortDir) queryParams.append('sortDir', sortDir);
      if (durationOp) queryParams.append('durationOp', durationOp);
      if (durationSeconds !== '') queryParams.append('durationSeconds', durationSeconds);
      if (durationSecondsTo !== '') queryParams.append('durationSecondsTo', durationSecondsTo);

      const response = await axios.get(`/call-logs/provider/export?${queryParams.toString()}`, {
        responseType: 'blob',
      });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', 'call_logs_export.csv');
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

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-6 flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Call Logs</h1>
          <p className="text-gray-600 mt-2">View and manage all your call history</p>
        </div>
        <button
          onClick={handleExport}
          disabled={isExporting}
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-medium shadow-sm transition-colors disabled:opacity-50 flex items-center"
        >
          {isExporting ? (
            <span className="flex items-center">
              <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              Exporting...
            </span>
          ) : (
            'Export CSV'
          )}
        </button>
      </div>

      {/* Statistics */}
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-5 gap-6 mb-6">
          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center">
              <div className="flex-shrink-0 bg-blue-500 rounded-md p-3">
                <svg className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                </svg>
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-500">Total Calls</p>
                <p className="text-2xl font-semibold text-gray-900">{stats.total.totalCalls || 0}</p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center">
              <div className="flex-shrink-0 bg-green-500 rounded-md p-3">
                <svg className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-500">Finished</p>
                <p className="text-2xl font-semibold text-gray-900">{stats.byStatus.completed || 0}</p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center">
              <div className="flex-shrink-0 bg-red-500 rounded-md p-3">
                <svg className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-500">Failed</p>
                <p className="text-2xl font-semibold text-gray-900">{stats.byStatus.failed || 0}</p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center">
              <div className="flex-shrink-0 bg-yellow-500 rounded-md p-3">
                <svg className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-500">No answer</p>
                <p className="text-2xl font-semibold text-gray-900">{stats.byStatus.no_answer || 0}</p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center">
              <div className="flex-shrink-0 bg-purple-500 rounded-md p-3">
                <svg className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-500">Avg Duration</p>
                <p className="text-2xl font-semibold text-gray-900">
                  {Math.round(stats.total.avgDuration || 0)}s
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="bg-white rounded-lg shadow p-6 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          {/* Campaign Filter */}
          <MultiSelect
            label="Campaign"
            placeholder="All campaigns"
            options={campaigns.map((campaign) => ({ value: campaign._id, label: campaign.name }))}
            value={selectedCampaign}
            onChange={(campaignId) => applyFilters({ campaignId })}
          />

          {/* Start Date */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Start Date</label>
            <input
              type="date"
              value={dateFrom || ''}
              onChange={(e) => applyFilters({ dateFrom: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>

          {/* End Date */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">End Date</label>
            <input
              type="date"
              value={dateTo || ''}
              onChange={(e) => applyFilters({ dateTo: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>

          {/* Call result */}
          <MultiSelect
            label="Call result"
            placeholder="All results"
            options={CALL_OUTCOME_OPTIONS.filter((option) => option.value)}
            value={selectedOutcome}
            onChange={(callOutcome) => applyFilters({ callOutcome })}
          />

          {/* Interest Filter */}
          <MultiSelect
            label="Interest score"
            placeholder="All scores"
            options={[
              { value: '0', label: '0 - Unknown' },
              ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((score) => ({ value: String(score), label: String(score) })),
            ]}
            value={selectedInterest}
            onChange={(interestLevel) => applyFilters({ interestLevel })}
          />

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Post-call processing</label>
            <select
              value={selectedExtraction || ''}
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
              value={selectedCallback || ''}
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
              value={sortBy === 'availability' ? (sortDir === 'asc' ? 'soonest' : 'latest') : ''}
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
              value={sortBy === 'availability' ? '' : `${sortBy || 'createdAt'}:${sortDir || 'desc'}`}
              onChange={(e) => {
                const [nextSortBy, nextSortDir] = e.target.value.split(':');
                applyFilters({ sortBy: nextSortBy, sortDir: nextSortDir, hasAvailability: '' });
              }}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              {sortBy === 'availability' ? <option value="">Using free time</option> : null}
              <option value="createdAt:desc">Newest first</option>
              <option value="createdAt:asc">Oldest first</option>
              <option value="duration:desc">Longest first</option>
              <option value="duration:asc">Shortest first</option>
              <option value="interest:desc">Interest high to low</option>
              <option value="interest:asc">Interest low to high</option>
            </select>
          </div>

          <div className="md:col-span-2 min-w-0">
            <label className="block text-sm font-medium text-gray-700 mb-2">Search</label>
            <form onSubmit={handleSearch} className="flex gap-2">
              <input
                type="text"
                value={localSearch}
                onChange={(e) => setLocalSearch(e.target.value)}
                placeholder="Search by name or phone..."
                className="min-w-0 flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
              <button
                type="submit"
                className="shrink-0 px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700"
              >
                Search
              </button>
            </form>
          </div>

          <DurationFilter
            op={durationOp || 'above'}
            totalSeconds={durationSeconds ?? ''}
            totalSecondsTo={durationSecondsTo ?? ''}
            onChange={(next) => applyFilters(next)}
          />
        </div>
      </div>

      {/* Call Logs List */}
      <p className="text-sm text-gray-600 mb-3">
        {pagination.total || 0} call{pagination.total === 1 ? '' : 's'} match these filters. Export downloads this full set, not just the rows on screen.
      </p>
      {loading && logs.length === 0 ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
        </div>
      ) : (
        <CallLogsList
          logs={logs}
          onViewDetails={handleViewDetails}
          onLoadMore={handleLoadMore}
          hasMore={pagination.hasMore}
          loading={loading}
          total={pagination.total}
        />
      )}

    </div>
  );
};

export default CallLogs;
