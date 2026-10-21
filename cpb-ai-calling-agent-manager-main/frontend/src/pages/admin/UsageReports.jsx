import { useEffect, useState } from 'react';
import axios from '../../utils/axios';
import { format } from 'date-fns';

const UsageReports = () => {
  const [reports, setReports] = useState([]);
  const [totals, setTotals] = useState(null);
  const [platformStats, setPlatformStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedManager, setSelectedManager] = useState(null);
  const [managerDetails, setManagerDetails] = useState(null);

  useEffect(() => {
    fetchUsageReports();
    fetchPlatformStats();
  }, []);

  const fetchUsageReports = async () => {
    try {
      setLoading(true);
      const response = await axios.get('/admin/reports/usage');
      setReports(response.data.data.managers);
      setTotals(response.data.data.totals);
    } catch (error) {
      console.error('Error fetching usage reports:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchPlatformStats = async () => {
    try {
      const response = await axios.get('/admin/reports/platform');
      setPlatformStats(response.data.data);
    } catch (error) {
      console.error('Error fetching platform stats:', error);
    }
  };

  const fetchManagerDetails = async (managerId) => {
    try {
      const response = await axios.get(`/admin/reports/usage/${managerId}`);
      setManagerDetails(response.data.data);
      setSelectedManager(managerId);
    } catch (error) {
      console.error('Error fetching manager details:', error);
    }
  };

  const getUsageColor = (percent) => {
    if (percent >= 90) return 'text-red-600';
    if (percent >= 70) return 'text-yellow-600';
    return 'text-green-600';
  };

  const getProgressBarColor = (percent) => {
    if (percent >= 90) return 'bg-red-600';
    if (percent >= 70) return 'bg-yellow-600';
    return 'bg-green-600';
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Usage Reports</h1>
        <p className="text-gray-600 mt-1">Monitor platform usage and manager limits</p>
      </div>

      {/* Platform Statistics */}
      {platformStats && (
        <div className="mb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Platform Overview</h2>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="bg-white p-4 rounded-lg shadow">
              <div className="text-sm text-gray-600">Total Managers</div>
              <div className="text-2xl font-bold text-gray-900">
                {platformStats.overview.totalManagers}
              </div>
            </div>
            <div className="bg-white p-4 rounded-lg shadow">
              <div className="text-sm text-gray-600">Active Campaigns</div>
              <div className="text-2xl font-bold text-green-600">
                {platformStats.overview.activeCampaigns}
              </div>
            </div>
            <div className="bg-white p-4 rounded-lg shadow">
              <div className="text-sm text-gray-600">Total Calls</div>
              <div className="text-2xl font-bold text-blue-600">
                {platformStats.overview.totalCalls}
              </div>
            </div>
            <div className="bg-white p-4 rounded-lg shadow">
              <div className="text-sm text-gray-600">Total Minutes</div>
              <div className="text-2xl font-bold text-purple-600">
                {platformStats.overview.totalMinutes}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Organization Totals */}
      {totals && (
        <div className="mb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Organization Totals</h2>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="bg-gradient-to-br from-blue-500 to-blue-600 p-4 rounded-lg shadow text-white">
              <div className="text-sm opacity-90">Total Calls</div>
              <div className="text-3xl font-bold">{totals.totalCalls}</div>
            </div>
            <div className="bg-gradient-to-br from-purple-500 to-purple-600 p-4 rounded-lg shadow text-white">
              <div className="text-sm opacity-90">Total Minutes</div>
              <div className="text-3xl font-bold">{totals.totalMinutes}</div>
            </div>
            <div className="bg-gradient-to-br from-green-500 to-green-600 p-4 rounded-lg shadow text-white">
              <div className="text-sm opacity-90">Active Campaigns</div>
              <div className="text-3xl font-bold">{totals.activeCampaigns}</div>
            </div>
            <div className="bg-gradient-to-br from-orange-500 to-orange-600 p-4 rounded-lg shadow text-white">
              <div className="text-sm opacity-90">Total Campaigns</div>
              <div className="text-3xl font-bold">{totals.totalCampaigns}</div>
            </div>
          </div>
        </div>
      )}

      {/* Manager Usage Table */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Manager Usage</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Manager
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Calls Usage
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Minutes Usage
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Campaigns
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {reports.length === 0 ? (
                <tr>
                  <td colSpan="6" className="px-6 py-12 text-center text-gray-500">
                    No usage data available
                  </td>
                </tr>
              ) : (
                reports.map((report) => (
                  <tr key={report.managerId} className="hover:bg-gray-50">
                    <td className="px-6 py-4">
                      <div className="text-sm font-medium text-gray-900">
                        {report.managerName}
                      </div>
                      <div className="text-sm text-gray-500">{report.managerEmail}</div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-sm text-gray-900">
                        {report.usage.totalCalls} / {report.limits.calls}
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-2 mt-1">
                        <div
                          className={`h-2 rounded-full ${getProgressBarColor(
                            report.usagePercent.calls
                          )}`}
                          style={{
                            width: `${Math.min(report.usagePercent.calls, 100)}%`,
                          }}
                        ></div>
                      </div>
                      <div
                        className={`text-xs mt-1 ${getUsageColor(
                          report.usagePercent.calls
                        )}`}
                      >
                        {report.usagePercent.calls.toFixed(1)}%
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-sm text-gray-900">
                        {report.usage.totalMinutes} / {report.limits.minutes}
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-2 mt-1">
                        <div
                          className={`h-2 rounded-full ${getProgressBarColor(
                            report.usagePercent.minutes
                          )}`}
                          style={{
                            width: `${Math.min(report.usagePercent.minutes, 100)}%`,
                          }}
                        ></div>
                      </div>
                      <div
                        className={`text-xs mt-1 ${getUsageColor(
                          report.usagePercent.minutes
                        )}`}
                      >
                        {report.usagePercent.minutes.toFixed(1)}%
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-sm text-gray-900">
                        Active: {report.usage.activeCampaigns}
                      </div>
                      <div className="text-sm text-gray-500">
                        Total: {report.usage.totalCampaigns}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      {report.isOverLimit ? (
                        <span className="px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full bg-red-100 text-red-800">
                          Over Limit
                        </span>
                      ) : (
                        <span className="px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full bg-green-100 text-green-800">
                          Within Limit
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-sm">
                      <button
                        onClick={() => fetchManagerDetails(report.managerId)}
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

      {/* Manager Details Modal */}
      {managerDetails && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">
                  {managerDetails.manager.name} - Detailed Report
                </h3>
                <p className="text-sm text-gray-600">{managerDetails.manager.email}</p>
              </div>
              <button
                onClick={() => setSelectedManager(null)}
                className="text-gray-400 hover:text-gray-600"
              >
                <svg
                  className="h-6 w-6"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>

            <div className="p-6">
              {/* Summary */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                <div className="bg-blue-50 p-4 rounded-lg">
                  <div className="text-sm text-gray-600">Total Calls</div>
                  <div className="text-2xl font-bold text-blue-600">
                    {managerDetails.summary.totalCalls}
                  </div>
                  <div className="text-xs text-gray-500 mt-1">
                    Limit: {managerDetails.manager.limits.calls}
                  </div>
                </div>
                <div className="bg-purple-50 p-4 rounded-lg">
                  <div className="text-sm text-gray-600">Total Minutes</div>
                  <div className="text-2xl font-bold text-purple-600">
                    {managerDetails.summary.totalMinutes}
                  </div>
                  <div className="text-xs text-gray-500 mt-1">
                    Limit: {managerDetails.manager.limits.minutes}
                  </div>
                </div>
                <div className="bg-green-50 p-4 rounded-lg">
                  <div className="text-sm text-gray-600">Active Campaigns</div>
                  <div className="text-2xl font-bold text-green-600">
                    {managerDetails.summary.activeCampaigns}
                  </div>
                  <div className="text-xs text-gray-500 mt-1">
                    Total: {managerDetails.summary.totalCampaigns}
                  </div>
                </div>
              </div>

              {/* Campaign Details */}
              <h4 className="text-md font-semibold text-gray-900 mb-3">
                Campaign Breakdown
              </h4>
              <div className="space-y-3">
                {managerDetails.campaigns.map((campaign) => (
                  <div
                    key={campaign.campaignId}
                    className="border border-gray-200 rounded-lg p-4"
                  >
                    <div className="flex justify-between items-start mb-2">
                      <div>
                        <h5 className="font-medium text-gray-900">
                          {campaign.campaignName}
                        </h5>
                        <p className="text-sm text-gray-600">
                          AI Caller: {campaign.aiCaller}
                        </p>
                      </div>
                      <span
                        className={`px-2 py-1 text-xs font-semibold rounded-full ${
                          campaign.status === 'running'
                            ? 'bg-green-100 text-green-800'
                            : campaign.status === 'paused'
                            ? 'bg-yellow-100 text-yellow-800'
                            : 'bg-gray-100 text-gray-800'
                        }`}
                      >
                        {campaign.status}
                      </span>
                    </div>
                    <div className="grid grid-cols-4 gap-4 text-sm">
                      <div>
                        <span className="text-gray-600">Calls:</span>{' '}
                        <span className="font-medium">{campaign.stats.totalCalls}</span>
                      </div>
                      <div>
                        <span className="text-gray-600">Minutes:</span>{' '}
                        <span className="font-medium">
                          {campaign.stats.totalMinutes}
                        </span>
                      </div>
                      <div>
                        <span className="text-gray-600">Completed:</span>{' '}
                        <span className="font-medium">
                          {campaign.stats.completedCalls}
                        </span>
                      </div>
                      <div>
                        <span className="text-gray-600">Success Rate:</span>{' '}
                        <span className="font-medium">
                          {campaign.stats.successRate}%
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default UsageReports;
