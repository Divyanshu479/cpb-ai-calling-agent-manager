import { useEffect, useMemo, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { fetchCurrentUser } from '../../store/slices/authSlice';
import { fetchCallers } from '../../store/slices/callersSlice';
import { fetchCampaigns } from '../../store/slices/campaignsSlice';
import {
  fetchProviderCallLogs,
  fetchProviderCallLogsStats,
} from '../../store/slices/callLogsSlice';

// --- Custom Vector Icons ---
const Icons = {
  Phone: () => (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
    </svg>
  ),
  Clock: () => (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
  Success: () => (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
  Heart: () => (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
    </svg>
  ),
  Lightning: () => (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
    </svg>
  ),
  Users: () => (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
    </svg>
  ),
  ArrowRight: () => (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
    </svg>
  ),
  EmptyState: () => (
    <svg className="mx-auto h-10 w-10 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
    </svg>
  ),
  UserIcon: () => (
    <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
    </svg>
  )
};

const CMDashboard = () => {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  
  const [isAnimateProgress, setIsAnimateProgress] = useState(false);

  const { user } = useSelector((state) => state.auth);
  const { campaigns } = useSelector((state) => state.campaigns);
  const { logs: recentLogs, stats: callStats, loading: callLogsLoading } = useSelector((state) => state.callLogs);

  useEffect(() => {
    dispatch(fetchCurrentUser());
    dispatch(fetchCampaigns());
    dispatch(fetchCallers());
    dispatch(fetchProviderCallLogsStats({}));
    dispatch(fetchProviderCallLogs({ limit: 5, offset: 0 }));

    // Delay bar transition to enable CSS ease interaction on screen load
    const timer = setTimeout(() => setIsAnimateProgress(true), 150);
    return () => clearTimeout(timer);
  }, [dispatch]);

  const campaignAggregates = useMemo(() => {
    let totalLeads = 0;
    let activeCampaigns = 0;
    
    if (campaigns && campaigns.length > 0) {
      for (const c of campaigns) {
        totalLeads += c.stats?.totalLeads || 0;
        if (c.status === 'running') activeCampaigns += 1;
      }
    }

    return { 
      totalLeads, 
      activeCampaigns,
      interested: callStats?.extracted?.interested || 0,
      callbacks: callStats?.extracted?.callback || 0,
    };
  }, [campaigns, callStats]);

  const connectedCallsCount = (callStats?.byStatus?.completed || 0) + (callStats?.byStatus?.connected || 0);
  const actualCallsUsed = connectedCallsCount; 
  const actualMinutesUsed = callStats?.total?.totalDuration ? Math.ceil(callStats.total.totalDuration / 60) : 0; 

  const usagePercentage = {
    calls: user?.limits?.maxCalls > 0 ? (actualCallsUsed / user.limits.maxCalls) * 100 : 0,
    minutes: user?.limits?.maxMinutes > 0 ? (actualMinutesUsed / user.limits.maxMinutes) * 100 : 0,
  };

  const totalCalls = callStats?.total?.totalCalls || 0;
  const connectedCalls = connectedCallsCount;
  const avgDuration = callStats?.total?.avgDuration || 0;

  const formatDuration = (seconds) => {
    const secs = Math.round(seconds);
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const formatTime = (dateStr) => {
    if (!dateStr) return '—';
    const d = new Date(dateStr);
    const now = new Date();
    const diffMs = now - d;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return d.toLocaleDateString();
  };

  const getStatusConfig = (status) => {
    const configs = {
      completed: { bg: 'bg-emerald-50 text-emerald-700 border-emerald-200/60', dot: 'bg-emerald-500' },
      connected: { bg: 'bg-blue-50 text-blue-700 border-blue-200/60', dot: 'bg-blue-500' },
      failed: { bg: 'bg-rose-50 text-rose-700 border-rose-200/60', dot: 'bg-rose-500' },
      no_answer: { bg: 'bg-amber-50 text-amber-700 border-amber-200/60', dot: 'bg-amber-500' },
      busy: { bg: 'bg-orange-50 text-orange-700 border-orange-200/60', dot: 'bg-orange-500' },
      ringing: { bg: 'bg-purple-50 text-purple-700 border-purple-200/60', dot: 'bg-purple-500' },
      queued: { bg: 'bg-slate-100 text-slate-600 border-slate-200/60', dot: 'bg-slate-400' },
      initiated: { bg: 'bg-indigo-50 text-indigo-700 border-indigo-200/60', dot: 'bg-indigo-500' },
      canceled: { bg: 'bg-slate-100 text-slate-500 border-slate-200/60', dot: 'bg-slate-400' },
    };
    return configs[status] || { bg: 'bg-slate-100 text-slate-600 border-slate-200/60', dot: 'bg-slate-400' };
  };

  const StatSkeleton = () => (
    <div className="bg-white rounded-xl border border-slate-200/60 p-5 animate-pulse">
      <div className="h-3.5 bg-slate-200 rounded w-20 mb-3" />
      <div className="h-7 bg-slate-200 rounded w-14" />
    </div>
  );

  const isLoading = callLogsLoading && !callStats;

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-8 font-sans">
      
      {/* Structural Header Area */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between border-b border-slate-200 pb-6 gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">Dashboard</h1>
          <p className="text-sm text-slate-500 mt-1">Welcome back, {user?.name || 'Manager'}. Here is your overview for today.</p>
        </div>
      </div>

      {/* Primary Trackers: Limits and Thresholds */}
      <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Calls Block */}
        <div className="bg-white rounded-2xl border border-slate-200/80 p-6 shadow-[0_2px_8px_rgba(0,0,0,0.01)] transition-all">
          <div className="flex items-center justify-between mb-4">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">Calls Usage</span>
            <div className="h-9 w-9 rounded-xl bg-blue-500/10 text-blue-600 flex items-center justify-center">
              <Icons.Phone />
            </div>
          </div>
          <div className="flex items-baseline justify-between mb-2">
            <span className="text-3xl font-bold tracking-tight text-slate-900">{actualCallsUsed}</span>
            <span className="text-xs font-medium text-slate-400">Limit: {user?.limits?.maxCalls || 0} calls</span>
          </div>
          <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-1000 cubic-bezier(0.4, 0, 0.2, 1) ${
                usagePercentage.calls > 90 ? 'bg-rose-500' : usagePercentage.calls > 70 ? 'bg-amber-500' : 'bg-blue-600'
              }`}
              style={{ width: isAnimateProgress ? `${Math.min(usagePercentage.calls, 100)}%` : '0%' }}
            />
          </div>
          <div className="flex items-center justify-between mt-2.5">
            <span className="text-xs font-semibold text-slate-500">{usagePercentage.calls.toFixed(1)}% of call limit used</span>
          </div>
        </div>

        {/* Minutes Block */}
        <div className="bg-white rounded-2xl border border-slate-200/80 p-6 shadow-[0_2px_8px_rgba(0,0,0,0.01)] transition-all">
          <div className="flex items-center justify-between mb-4">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">Minutes Usage</span>
            <div className="h-9 w-9 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
              <Icons.Clock />
            </div>
          </div>
          <div className="flex items-baseline justify-between mb-2">
            <span className="text-3xl font-bold tracking-tight text-slate-900">{actualMinutesUsed} <span className="text-sm font-normal text-slate-500">mins</span></span>
            <span className="text-xs font-medium text-slate-400">Limit: {user?.limits?.maxMinutes || 0} minutes</span>
          </div>
          <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-1000 cubic-bezier(0.4, 0, 0.2, 1) ${
                usagePercentage.minutes > 90 ? 'bg-rose-500' : usagePercentage.minutes > 70 ? 'bg-amber-500' : 'bg-indigo-600'
              }`}
              style={{ width: isAnimateProgress ? `${Math.min(usagePercentage.minutes, 100)}%` : '0%' }}
            />
          </div>
          <div className="flex items-center justify-between mt-2.5">
            <span className="text-xs font-semibold text-slate-500">{usagePercentage.minutes.toFixed(1)}% of minute limit used</span>
          </div>
        </div>
      </section>

      {/* Grid Data Metrics */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {isLoading ? (
          <>
            <StatSkeleton /><StatSkeleton /><StatSkeleton /><StatSkeleton />
            <StatSkeleton /><StatSkeleton /><StatSkeleton /><StatSkeleton />
          </>
        ) : (
          <>
            <div className="bg-white rounded-xl border border-slate-200/70 p-5 hover:-translate-y-0.5 hover:shadow-md hover:border-slate-300 transition-all duration-300">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Total Calls</span>
                <div className="h-7 w-7 rounded-lg bg-slate-50 border border-slate-100 text-slate-500 flex items-center justify-center"><Icons.Phone /></div>
              </div>
              <p className="text-xl font-bold text-slate-900 tracking-tight">{totalCalls}</p>
            </div>

            <div className="bg-white rounded-xl border border-slate-200/70 p-5 hover:-translate-y-0.5 hover:shadow-md hover:border-slate-300 transition-all duration-300">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Connected Calls</span>
                <div className="h-7 w-7 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center"><Icons.Success /></div>
              </div>
              <p className="text-xl font-bold text-slate-900 tracking-tight">{connectedCalls}</p>
            </div>

            <div className="bg-white rounded-xl border border-slate-200/70 p-5 hover:-translate-y-0.5 hover:shadow-md hover:border-slate-300 transition-all duration-300">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Interested Leads</span>
                <div className="h-7 w-7 rounded-lg bg-rose-50 text-rose-600 flex items-center justify-center"><Icons.Heart /></div>
              </div>
              <p className="text-xl font-bold text-slate-900 tracking-tight">{campaignAggregates.interested}</p>
            </div>

            <div className="bg-white rounded-xl border border-slate-200/70 p-5 hover:-translate-y-0.5 hover:shadow-md hover:border-slate-300 transition-all duration-300">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Callbacks Needed</span>
                <div className="h-7 w-7 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center"><Icons.Clock /></div>
              </div>
              <p className="text-xl font-bold text-slate-900 tracking-tight">{campaignAggregates.callbacks}</p>
            </div>

            <div className="bg-white rounded-xl border border-slate-200/70 p-5 hover:-translate-y-0.5 hover:shadow-md hover:border-slate-300 transition-all duration-300">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Active Campaigns</span>
                <div className="h-7 w-7 rounded-lg bg-sky-50 text-sky-600 flex items-center justify-center"><Icons.Lightning /></div>
              </div>
              <p className="text-xl font-bold text-slate-900 tracking-tight">{campaignAggregates.activeCampaigns}</p>
              <span className="text-[10px] text-slate-400 font-medium block mt-0.5">{campaigns?.length || 0} total campaigns</span>
            </div>

            <div className="bg-white rounded-xl border border-slate-200/70 p-5 hover:-translate-y-0.5 hover:shadow-md hover:border-slate-300 transition-all duration-300">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Total Leads</span>
                <div className="h-7 w-7 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center"><Icons.Users /></div>
              </div>
              <p className="text-xl font-bold text-slate-900 tracking-tight">{campaignAggregates.totalLeads}</p>
            </div>

            <div className="bg-white rounded-xl border border-slate-200/70 p-5 hover:-translate-y-0.5 hover:shadow-md hover:border-slate-300 transition-all duration-300">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Average Call Time</span>
                <div className="h-7 w-7 rounded-lg bg-teal-50 text-teal-600 flex items-center justify-center"><Icons.Clock /></div>
              </div>
              <p className="text-xl font-bold text-slate-900 tracking-tight">{formatDuration(avgDuration)}</p>
              <span className="text-[10px] text-slate-400 font-medium block mt-0.5">Shown in minutes and seconds</span>
            </div>
          </>
        )}
      </section>

      {/* Dual Data/Workflow Grid layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        
        {/* Activity Stream */}
        <section className="lg:col-span-2 bg-white rounded-xl border border-slate-200/80 p-6 space-y-6">
          <div className="flex items-center justify-between border-b border-slate-100 pb-4">
            <div>
              <h2 className="text-base font-bold text-slate-900">Recent Calls</h2>
              <p className="text-xs text-slate-400">Your most recently completed calls</p>
            </div>
            <button
              onClick={() => navigate('/cm/logs')}
              className="group text-xs text-blue-600 hover:text-blue-700 font-bold flex items-center space-x-1 transition-colors"
            >
              <span>View all call logs</span>
              <div className="transform group-hover:translate-x-0.5 transition-transform"><Icons.ArrowRight /></div>
            </button>
          </div>

          {callLogsLoading && recentLogs.length === 0 ? (
            <div className="space-y-4">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="animate-pulse flex items-center space-x-4 py-3 border-b border-slate-50">
                  <div className="h-9 w-9 bg-slate-200 rounded-full" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3.5 bg-slate-200 rounded w-1/4" />
                    <div className="h-3 bg-slate-200 rounded w-1/2" />
                  </div>
                  <div className="h-6 bg-slate-200 rounded w-16" />
                </div>
              ))}
            </div>
          ) : recentLogs.length === 0 ? (
            <div className="text-center py-16 border border-dashed border-slate-200 rounded-xl bg-slate-50/50">
              <Icons.EmptyState />
              <p className="mt-3 text-sm font-semibold text-slate-600">No calls yet</p>
              <p className="text-xs text-slate-400 mt-0.5 max-w-xs mx-auto">Once you start a campaign, your recent calls will appear here.</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {recentLogs.slice(0, 5).map((log) => {
                const statusConfig = getStatusConfig(log.status);
                return (
                  <div
                    key={log.id || log._id}
                    onClick={() => navigate(`/cm/logs/${log.callSid || log.id || log._id}`)}
                    className="flex items-center justify-between py-3.5 hover:bg-slate-50/80 px-3 -mx-3 rounded-xl cursor-pointer group transition-all duration-200"
                  >
                    <div className="flex items-center space-x-3.5 min-w-0">
                      <div className="flex-shrink-0 h-9 w-9 rounded-xl bg-slate-800 flex items-center justify-center text-white text-xs font-bold border border-slate-700">
                        <Icons.UserIcon />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-900 group-hover:text-blue-600 transition-colors truncate">
                          {log.lead?.name || log.to || 'Unknown Contact'}
                        </p>
                        <p className="text-xs text-slate-400 mt-0.5 truncate font-medium">
                          {log.campaignName || log.campaignId?.name || 'Unassigned Campaign'} • {formatDuration(log.duration || 0)} duration
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center space-x-4 flex-shrink-0 ml-4">
                      <span className={`inline-flex items-center text-[11px] font-bold tracking-wide px-2.5 py-1 rounded-md border ${statusConfig.bg}`}>
                        <span className={`w-1.5 h-1.5 rounded-full mr-1.5 ${statusConfig.dot}`} />
                        {(log.status || 'unknown').toUpperCase().replace(/_/g, ' ')}
                      </span>
                      <span className="text-xs font-medium text-slate-400 whitespace-nowrap">
                        {formatTime(log.createdAt)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Guided Onboarding */}
        <aside className="bg-white rounded-xl border border-slate-200/80 p-6 space-y-6">
          <div>
            <h2 className="text-base font-bold text-slate-900">How It Works</h2>
            <p className="text-xs text-slate-400">A quick guide to getting started</p>
          </div>

          <div className="relative pl-6 space-y-6 before:absolute before:left-2 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-100">
            <div className="relative group">
              <div className="absolute -left-6 mt-0.5 h-4 w-4 rounded-full bg-blue-100 ring-4 ring-white flex items-center justify-center text-[10px] font-bold text-blue-600">1</div>
              <div>
                <p className="text-xs font-bold text-slate-800 tracking-wide uppercase">Create an AI Caller</p>
                <p className="text-xs text-slate-400 mt-0.5">Choose a voice, language, and settings for your AI.</p>
              </div>
            </div>
            <div className="relative group">
              <div className="absolute -left-6 mt-0.5 h-4 w-4 rounded-full bg-indigo-100 ring-4 ring-white flex items-center justify-center text-[10px] font-bold text-indigo-600">2</div>
              <div>
                <p className="text-xs font-bold text-slate-800 tracking-wide uppercase">Build a Script</p>
                <p className="text-xs text-slate-400 mt-0.5">Write the script and responses your AI will use.</p>
              </div>
            </div>
            <div className="relative group">
              <div className="absolute -left-6 mt-0.5 h-4 w-4 rounded-full bg-purple-100 ring-4 ring-white flex items-center justify-center text-[10px] font-bold text-purple-600">3</div>
              <div>
                <p className="text-xs font-bold text-slate-800 tracking-wide uppercase">Create a Campaign</p>
                <p className="text-xs text-slate-400 mt-0.5">Upload your contacts and link them to your AI caller.</p>
              </div>
            </div>
            <div className="relative group">
              <div className="absolute -left-6 mt-0.5 h-4 w-4 rounded-full bg-emerald-100 ring-4 ring-white flex items-center justify-center text-[10px] font-bold text-emerald-600">4</div>
              <div>
                <p className="text-xs font-bold text-slate-800 tracking-wide uppercase">Start Calling</p>
                <p className="text-xs text-slate-400 mt-0.5">Launch your campaign and watch the results in real-time.</p>
              </div>
            </div>
          </div>

          {/* Quick Links */}
          <div className="pt-4 border-t border-slate-100 space-y-2">
            <button
              onClick={() => navigate('/cm/callers')}
              className="w-full text-left px-3 py-2.5 text-xs font-semibold text-slate-600 hover:text-blue-600 hover:bg-blue-50/50 rounded-lg transition-all flex items-center justify-between group border border-transparent hover:border-blue-100"
            >
              <span>Manage AI Callers</span>
              <div className="text-slate-400 group-hover:text-blue-500 transform group-hover:translate-x-0.5 transition-all"><Icons.ArrowRight /></div>
            </button>
            <button
              onClick={() => navigate('/cm/campaigns')}
              className="w-full text-left px-3 py-2.5 text-xs font-semibold text-slate-600 hover:text-blue-600 hover:bg-blue-50/50 rounded-lg transition-all flex items-center justify-between group border border-transparent hover:border-blue-100"
            >
              <span>View Campaigns</span>
              <div className="text-slate-400 group-hover:text-blue-500 transform group-hover:translate-x-0.5 transition-all"><Icons.ArrowRight /></div>
            </button>
            <button
              onClick={() => navigate('/cm/logs')}
              className="w-full text-left px-3 py-2.5 text-xs font-semibold text-slate-600 hover:text-blue-600 hover:bg-blue-50/50 rounded-lg transition-all flex items-center justify-between group border border-transparent hover:border-blue-100"
            >
              <span>View Call Logs</span>
              <div className="text-slate-400 group-hover:text-blue-500 transform group-hover:translate-x-0.5 transition-all"><Icons.ArrowRight /></div>
            </button>
          </div>
        </aside>

      </div>
    </div>
  );
};

export default CMDashboard;