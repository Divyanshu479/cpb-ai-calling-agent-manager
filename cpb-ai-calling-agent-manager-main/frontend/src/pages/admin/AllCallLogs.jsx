import { useEffect, useState } from 'react';
import axios from '../../utils/axios';
import { format } from 'date-fns';
import { useNavigate } from 'react-router-dom';
import { callOutcomeSeverity, getCallOutcomeBadge } from '../../utils/callOutcome';

const AllCallLogs = () => {
  const navigate = useNavigate();
  const [logs, setLogs] = useState([]);
  const [managers, setManagers] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [selectedManager, setSelectedManager] = useState('');
  const [pagination, setPagination] = useState({
    total: 0,
    limit: 50,
    offset: 0,
    hasMore: false,
  });

  useEffect(() => {
    fetchManagers();
  }, []);

  useEffect(() => {
    fetchLogs();
    fetchStats();
  }, [statusFilter, selectedManager]);

  const fetchManagers = async () => {
    try {
      const response = await axios.get('/admin/managers');
      setManagers(response.data?.data || []);
    } catch (error) {
      console.error('Error fetching managers:', error);
    }
  };

  const fetchLogs = async (offset = 0) => {
    try {
      setLoading(true);
      const params = {
        limit: 50,
        offset,
      };

      if (statusFilter) params.status = statusFilter;
      if (searchQuery) params.search = searchQuery;
      if (selectedManager) params.managerId = selectedManager;

      const response = await axios.get('/admin/provider-call-logs', { params });

      if (offset === 0) {
        setLogs(response.data.data);
      } else {
        setLogs((prev) => [...prev, ...response.data.data]);
      }

      setPagination(response.data.pagination);
    } catch (error) {
      console.error('Error fetching logs:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchStats = async () => {
    try {
      const response = await axios.get('/admin/provider-call-logs/stats', {
        params: {
          status: statusFilter || undefined,
          search: searchQuery || undefined,
          managerId: selectedManager || undefined,
        },
      });
      setStats(response.data.data);
    } catch (error) {
      console.error('Error fetching stats:', error);
    }
  };

  const handleSearch = () => {
    fetchLogs(0);
    fetchStats();
  };

  const handleLoadMore = () => {
    fetchLogs(pagination.offset + pagination.limit);
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'completed':
        return 'bg-green-100 text-green-800';
      case 'failed':
        return 'bg-red-100 text-red-800';
      case 'no_answer':
        return 'bg-yellow-100 text-yellow-800';
      case 'busy':
        return 'bg-orange-100 text-orange-800';
      case 'voicemail':
        return 'bg-blue-100 text-blue-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  if (loading && logs.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">All Call Logs</h1>
        <p className="text-gray-600 mt-1">View all call logs across organization</p>
      </div>

      {/* Statistics */}
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-6 gap-4 mb-6">
          <div className="bg-white p-4 rounded-lg shadow">
            <div className="text-sm text-gray-600">Total Calls</div>
            <div className="text-2xl font-bold text-gray-900">
              {stats.total.totalCalls || 0}
            </div>
          </div>
          <div className="bg-white p-4 rounded-lg shadow">
            <div className="text-sm text-gray-600">Completed</div>
            <div className="text-2xl font-bold text-green-600">
              {stats.byStatus.completed || 0}
            </div>
          </div>
          <div className="bg-white p-4 rounded-lg shadow">
            <div className="text-sm text-gray-600">Failed</div>
            <div className="text-2xl font-bold text-red-600">
              {stats.byStatus.failed || 0}
            </div>
          </div>
          <div className="bg-white p-4 rounded-lg shadow">
            <div className="text-sm text-gray-600">No Answer</div>
            <div className="text-2xl font-bold text-yellow-600">
              {stats.byStatus.no_answer || 0}
            </div>
          </div>
          <div className="bg-white p-4 rounded-lg shadow">
            <div className="text-sm text-gray-600">Busy</div>
            <div className="text-2xl font-bold text-orange-600">
              {stats.byStatus.busy || 0}
            </div>
          </div>
          <div className="bg-white p-4 rounded-lg shadow">
            <div className="text-sm text-gray-600">Avg Duration</div>
            <div className="text-2xl font-bold text-blue-600">
              {stats.total.avgDuration
                ? `${Math.round(stats.total.avgDuration)}s`
                : '0s'}
            </div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="bg-white p-4 rounded-lg shadow mb-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Search
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Search by lead name or phone..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <button
                onClick={handleSearch}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                Search
              </button>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Status
            </label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="">All Statuses</option>
              <option value="completed">Completed</option>
              <option value="failed">Failed</option>
              <option value="no_answer">No Answer</option>
              <option value="busy">Busy</option>
              <option value="voicemail">Voicemail</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Manager</label>
            <select
              value={selectedManager}
              onChange={(e) => setSelectedManager(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="">All Managers</option>
              {managers.map((manager) => (
                <option key={manager._id} value={manager._id}>
                  {manager.name} ({manager.email})
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Call Logs Table */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Lead
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Campaign
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Manager
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Call Status
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Duration
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Date
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {logs.length === 0 ? (
                <tr>
                  <td colSpan="7" className="px-6 py-12 text-center text-gray-500">
                    No call logs found
                  </td>
                </tr>
              ) : (
                logs.map((log) => (
                  <tr key={log._id || log.id || log.callSid} className="hover:bg-gray-50">
                    <td className="px-6 py-4">
                      <div className="text-sm font-medium text-gray-900">
                        {log.lead?.name || 'N/A'}
                      </div>
                      <div className="text-sm text-gray-500">
                        {log.lead?.phoneNumber || 'N/A'}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-900">
                      {log.campaignId?.name || 'N/A'}
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-sm font-medium text-gray-900">
                        {log.campaignId?.createdBy?.name || 'N/A'}
                      </div>
                      <div className="text-sm text-gray-500">
                        {log.campaignId?.createdBy?.email || 'N/A'}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      {(() => {
                        const severity = callOutcomeSeverity(log);
                        const statusClass = severity === 'error'
                          ? 'bg-red-100 text-red-800'
                          : severity === 'warning'
                            ? 'bg-amber-100 text-amber-800'
                            : getStatusColor(log.status);
                        const label = severity === 'error'
                          ? 'failed'
                          : severity === 'warning'
                            ? 'warning'
                            : String(log.status || 'unknown');
                        return (
                          <span className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${statusClass}`}>
                            {label.replace('_', ' ')}
                          </span>
                        );
                      })()}
                    </td>
                    <td className="px-6 py-4">
                      {(() => {
                        const badge = getCallOutcomeBadge(log);
                        if (!badge) return <span className="text-gray-400 text-sm">-</span>;
                        return (
                          <span className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-full ${badge.color}`}>
                            <span className="text-[11px]">{badge.icon}</span>
                            {badge.label}
                          </span>
                        );
                      })()}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-900">
                      {log.duration ? `${Math.round(log.duration)}s` : 'N/A'}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500">
                      {log.createdAt
                        ? format(new Date(log.createdAt), 'MMM dd, yyyy HH:mm')
                        : 'N/A'}
                    </td>
                    <td className="px-6 py-4 text-sm">
                      <button
                        onClick={() => log.callSid && navigate(`/admin/logs/${log.callSid}`)}
                        className="text-blue-600 hover:text-blue-800"
                      >
                        View Details
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Load More */}
      {pagination.hasMore && (
        <div className="mt-4 text-center">
          <button
            onClick={handleLoadMore}
            disabled={loading}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? 'Loading...' : 'Load More'}
          </button>
        </div>
      )}

      {/* Summary */}
      {logs.length > 0 && (
        <div className="mt-4 text-sm text-gray-600">
          Showing {logs.length} of {pagination.total} call logs
        </div>
      )}
    </div>
  );
};

export default AllCallLogs;
