import { useDispatch, useSelector } from 'react-redux';
import { deleteCampaign, startCampaign, pauseCampaign } from '../../store/slices/campaignsSlice';
import CampaignFailureAlert from './CampaignFailureAlert';

const CampaignsList = ({ onEdit, onViewStats, onOpen }) => {
  const dispatch = useDispatch();
  const { campaigns } = useSelector((state) => state.campaigns);

  const handleDelete = async (id) => {
    if (window.confirm('Are you sure you want to delete this campaign? This action cannot be undone.')) {
      try {
        await dispatch(deleteCampaign(id)).unwrap();
      } catch (error) {
        alert('Failed to delete campaign: ' + error.message);
      }
    }
  };

  const handleStart = async (id) => {
    try {
      await dispatch(startCampaign(id)).unwrap();
    } catch (error) {
      const msg = typeof error === 'string' ? error : error?.message || 'Unknown error';
      alert('Failed to start campaign: ' + msg);
    }
  };

  const handlePause = async (id) => {
    try {
      await dispatch(pauseCampaign(id)).unwrap();
    } catch (error) {
      const msg = typeof error === 'string' ? error : error?.message || 'Unknown error';
      alert('Failed to pause campaign: ' + msg);
    }
  };

  // Modernized ring-based badge styling
  const getStatusColor = (status) => {
    const s = status?.toLowerCase();
    const colors = {
      draft: 'bg-slate-50 text-slate-700 ring-slate-500/20',
      running: 'bg-green-50 text-green-700 ring-green-600/20',
      paused: 'bg-yellow-50 text-yellow-800 ring-yellow-600/20',
      completed: 'bg-blue-50 text-blue-700 ring-blue-600/20',
      stopped: 'bg-red-50 text-red-700 ring-red-600/10',
    };
    return colors[s] || 'bg-gray-50 text-gray-700 ring-gray-500/20';
  };

  const getStatusIcon = (status) => {
    switch (status?.toLowerCase()) {
      case 'running':
        return (
          <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-8.707l-3-3a1 1 0 00-1.414 1.414L10.586 9H7a1 1 0 100 2h3.586l-1.293 1.293a1 1 0 101.414 1.414l3-3a1 1 0 000-1.414z" clipRule="evenodd" />
          </svg>
        );
      case 'paused':
        return (
          <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM7 8a1 1 0 012 0v4a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v4a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
        );
      case 'completed':
        return (
          <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
          </svg>
        );
      case 'stopped':
        return (
          <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8 7a1 1 0 00-1 1v4a1 1 0 001 1h4a1 1 0 001-1V8a1 1 0 00-1-1H8z" clipRule="evenodd" />
          </svg>
        );
      default:
        return (
          <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
          </svg>
        );
    }
  };

  const formatDate = (date) => {
    return new Date(date).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const calculateProgress = (campaign) => {
    const stats = campaign.stats || campaign.statistics || {};
    const total = stats.totalLeads || 0;
    const completed = (stats.completed || 0) + (stats.failed || 0);
    return total > 0 ? Math.round((completed / total) * 100) : 0;
  };

  if (campaigns.length === 0) {
    return (
      <div className="bg-white rounded-2xl">
        <div className="text-center py-16 px-4">
          <div className="mx-auto h-16 w-16 bg-gray-50 rounded-full flex items-center justify-center mb-4 border border-gray-100">
            <svg className="h-8 w-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
          </div>
          <h3 className="text-base font-semibold text-gray-900">No campaigns found</h3>
          <p className="mt-1 text-sm text-gray-500">Get started by creating your first AI calling campaign.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50/80">
            <tr>
              <th scope="col" className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                Campaign
              </th>
              <th scope="col" className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                AI Caller
              </th>
              <th scope="col" className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider relative group">
                <div className="flex items-center cursor-help w-max">
                  Status
                  <svg className="w-4 h-4 ml-1.5 text-gray-400 hover:text-gray-600 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  {/* Tooltip */}
                  <div className="absolute left-6 top-full mt-1 w-64 bg-gray-900 text-white text-xs rounded-xl shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-50 p-4 border border-gray-700 font-normal normal-case tracking-normal">
                    <div className="font-semibold mb-2.5 text-gray-200 uppercase tracking-wider border-b border-gray-700 pb-1.5 text-[10px]">Campaign Statuses</div>
                    <ul className="space-y-2.5">
                      <li className="flex items-start"><span className="w-2 h-2 mt-1 mr-2.5 rounded-full bg-slate-400 flex-shrink-0 shadow-[0_0_4px_rgba(148,163,184,0.5)]"></span><span className="leading-snug"><span className="font-semibold text-slate-300">Draft:</span> Created but not started yet.</span></li>
                      <li className="flex items-start"><span className="w-2 h-2 mt-1 mr-2.5 rounded-full bg-green-400 flex-shrink-0 shadow-[0_0_4px_rgba(74,222,128,0.5)]"></span><span className="leading-snug"><span className="font-semibold text-green-300">Running:</span> Actively making calls to leads.</span></li>
                      <li className="flex items-start"><span className="w-2 h-2 mt-1 mr-2.5 rounded-full bg-yellow-400 flex-shrink-0 shadow-[0_0_4px_rgba(250,204,21,0.5)]"></span><span className="leading-snug"><span className="font-semibold text-yellow-300">Paused:</span> Temporarily halted (can resume).</span></li>
                      <li className="flex items-start"><span className="w-2 h-2 mt-1 mr-2.5 rounded-full bg-blue-400 flex-shrink-0 shadow-[0_0_4px_rgba(96,165,250,0.5)]"></span><span className="leading-snug"><span className="font-semibold text-blue-300">Completed:</span> All leads processed successfully.</span></li>
                      <li className="flex items-start"><span className="w-2 h-2 mt-1 mr-2.5 rounded-full bg-red-400 flex-shrink-0 shadow-[0_0_4px_rgba(248,113,113,0.5)]"></span><span className="leading-snug"><span className="font-semibold text-red-300">Stopped:</span> Manually halted and finalized.</span></li>
                    </ul>
                  </div>
                </div>
              </th>
              <th scope="col" className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider min-w-[200px]">
                Progress
              </th>
              <th scope="col" className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                Stats
              </th>
              <th scope="col" className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                Created
              </th>
              <th scope="col" className="px-6 py-4 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider relative group">
                <div className="flex items-center justify-end cursor-help w-full">
                  Actions
                  <svg className="w-4 h-4 ml-1.5 text-gray-400 hover:text-gray-600 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  {/* Tooltip */}
                  <div className="absolute right-6 top-full mt-1 w-56 bg-gray-900 text-white text-xs rounded-xl shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-50 p-4 border border-gray-700 font-normal normal-case tracking-normal text-left">
                    <div className="font-semibold mb-2.5 text-gray-200 uppercase tracking-wider border-b border-gray-700 pb-1.5 text-[10px]">Available Actions</div>
                    <ul className="space-y-2.5">
                      <li className="flex items-start gap-2.5">
                        <div className="mt-0.5 px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded text-[9px] font-semibold tracking-wide uppercase shadow-sm border border-gray-200">Open</div>
                        <span className="leading-snug">View and control the campaign.</span>
                      </li>
                      <li className="flex items-start gap-2.5">
                        <svg className="w-4 h-4 text-blue-400 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>
                        <span className="leading-snug">View detailed call metrics.</span>
                      </li>
                      <li className="flex items-start gap-2.5">
                        <svg className="w-4 h-4 text-gray-400 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                        <span className="leading-snug">Modify campaign settings.</span>
                      </li>
                      <li className="flex items-start gap-2.5">
                        <svg className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                        <span className="leading-snug">Remove the campaign entirely.</span>
                      </li>
                      <li className="flex items-start gap-2.5">
                        <svg className="w-4 h-4 text-green-400 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                        <span className="leading-snug">Start or resume a campaign.</span>
                      </li>
                      <li className="flex items-start gap-2.5">
                        <svg className="w-4 h-4 text-yellow-400 mt-0.5 flex-shrink-0" fill="none" viewBox="0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                        <span className="leading-snug">Pause an active campaign.</span>
                      </li>
                    </ul>
                  </div>
                </div>
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-100">
            {campaigns.map((campaign) => {
              const progress = calculateProgress(campaign);
              const stats = campaign.stats || campaign.statistics || {};
              const campaignStatus = campaign.status?.toLowerCase();
              const isRunning = campaignStatus === 'running';

              return (
                <tr key={campaign._id} className="hover:bg-gray-50/50 transition-colors duration-150 group">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center">
                      <div>
                        <div className="text-sm font-semibold text-gray-900">{campaign.name}</div>
                        {campaign.description && (
                          <div className="text-xs text-gray-500 mt-0.5 truncate max-w-[200px]" title={campaign.description}>
                            {campaign.description}
                          </div>
                        )}
                        {campaign.runtimeAlert?.active && (
                          <div className="mt-2 max-w-sm">
                            <CampaignFailureAlert campaign={campaign} />
                          </div>
                        )}
                      </div>
                    </div>
                  </td>

                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="inline-flex items-center text-sm text-gray-700 bg-gray-50 px-2.5 py-1 rounded-md border border-gray-100">
                      <svg className="w-4 h-4 mr-1.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                      </svg>
                      {campaign.aiCallerId?.name || 'Not assigned'}
                    </div>
                  </td>

                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ring-1 ring-inset ${getStatusColor(campaign.status)}`}>
                      <span className="mr-1.5">{getStatusIcon(campaign.status)}</span>
                      <span className="capitalize">{campaign.status?.toLowerCase()}</span>
                    </span>
                  </td>

                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="w-full max-w-[200px]">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-xs font-medium text-gray-700">{progress}%</span>
                        <span className="text-xs text-gray-500 font-medium">
                          {(stats.completed || 0) + (stats.failed || 0)} <span className="text-gray-400">/</span> {stats.totalLeads || 0}
                        </span>
                      </div>
                      <div className="w-full bg-gray-100 rounded-full h-2 shadow-inner">
                        <div
                          className="bg-primary-500 h-2 rounded-full transition-all duration-500 ease-out"
                          style={{ width: `${progress}%` }}
                        ></div>
                      </div>
                    </div>
                  </td>

                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-xs space-y-1.5 font-medium">
                      <div className="flex items-center text-green-700 bg-green-50/50 px-2 py-0.5 rounded w-fit">
                        <svg className="w-3.5 h-3.5 mr-1.5" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                        </svg>
                        Interested: {stats.interested || 0}
                      </div>
                      <div className="flex items-center text-yellow-700 bg-yellow-50/50 px-2 py-0.5 rounded w-fit">
                        <svg className="w-3.5 h-3.5 mr-1.5" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
                        </svg>
                        Callback: {stats.callback || 0}
                      </div>
                      <div className="flex items-center text-red-700 bg-red-50/50 px-2 py-0.5 rounded w-fit">
                        <svg className="w-3.5 h-3.5 mr-1.5" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                        </svg>
                        Not Interested: {stats.notInterested || 0}
                      </div>
                    </div>
                  </td>

                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 font-medium">
                    {formatDate(campaign.createdAt)}
                  </td>

                  <td className="px-6 py-4 whitespace-nowrap text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => onOpen && onOpen(campaign)}
                        className="inline-flex items-center px-3 py-1.5 text-xs font-medium rounded-lg bg-white border border-gray-200 text-gray-700 shadow-sm hover:bg-gray-50 hover:text-primary-600 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-primary-500 transition-all"
                        title="Open Campaign Details"
                      >
                        Open
                      </button>

                      <div className="flex items-center border-l border-gray-200 pl-2 ml-1 gap-1">
                        {['draft', 'paused', 'stopped', 'completed'].includes(campaignStatus) && (
                          <button
                            onClick={() => handleStart(campaign._id)}
                            className="p-1.5 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded-lg transition-colors"
                            title={['stopped', 'completed'].includes(campaignStatus) ? 'Reopen & Start Campaign' : 'Start Campaign'}
                          >
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                          </button>
                        )}
                        
                        {campaignStatus === 'running' && (
                          <button
                            onClick={() => handlePause(campaign._id)}
                            className="p-1.5 text-gray-400 hover:text-yellow-600 hover:bg-yellow-50 rounded-lg transition-colors"
                            title="Pause Campaign"
                          >
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                          </button>
                        )}

                        <div className="w-px h-5 bg-gray-200 mx-1"></div>

                        <button
                          onClick={() => onViewStats && onViewStats(campaign)}
                          className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                          title="View Statistics"
                        >
                          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                          </svg>
                        </button>

                        <button
                          onClick={() => onEdit && onEdit(campaign)}
                          className={`p-1.5 rounded-lg transition-colors ${
                            isRunning 
                              ? 'text-gray-300 cursor-not-allowed' 
                              : 'text-gray-400 hover:text-gray-900 hover:bg-gray-100'
                          }`}
                          title={isRunning ? "Cannot edit a running campaign" : "Edit Campaign"}
                          disabled={isRunning}
                        >
                          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                          </svg>
                        </button>

                        <button
                          onClick={() => handleDelete(campaign._id)}
                          className={`p-1.5 rounded-lg transition-colors ${
                            isRunning 
                              ? 'text-red-200 cursor-not-allowed' 
                              : 'text-gray-400 hover:text-red-600 hover:bg-red-50'
                          }`}
                          title={isRunning ? "Cannot delete a running campaign" : "Delete Campaign"}
                          disabled={isRunning}
                        >
                          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default CampaignsList;