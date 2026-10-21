import { formatDistanceToNow } from 'date-fns';
import { callOutcomeSeverity, getCallOutcomeBadge } from '../../utils/callOutcome';
import { formatAvailability, availabilityCloseness } from '../../utils/availability';

const CallLogsList = ({ logs, onViewDetails, onLoadMore, hasMore, loading }) => {
  const getStatusBadge = (log) => {
    const status = log?.status;
    const badges = {
      completed: { bg: 'bg-green-100', text: 'text-green-800', label: 'Completed' },
      failed: { bg: 'bg-red-100', text: 'text-red-800', label: 'Failed' },
      no_answer: { bg: 'bg-yellow-100', text: 'text-yellow-800', label: 'No Answer' },
      busy: { bg: 'bg-orange-100', text: 'text-orange-800', label: 'Busy' },
      voicemail: { bg: 'bg-blue-100', text: 'text-blue-800', label: 'Voicemail' },
      queued: { bg: 'bg-slate-100', text: 'text-slate-700', label: 'Queued' },
      initiated: { bg: 'bg-slate-100', text: 'text-slate-700', label: 'Initiated' },
      ringing: { bg: 'bg-indigo-100', text: 'text-indigo-800', label: 'Ringing' },
      connected: { bg: 'bg-cyan-100', text: 'text-cyan-800', label: 'Connected' },
      canceled: { bg: 'bg-gray-100', text: 'text-gray-800', label: 'Canceled' },
    };

    const severity = callOutcomeSeverity(log);
    const badge = { ...(badges[status] || { bg: 'bg-gray-100', text: 'text-gray-800', label: status }) };
    if (severity === 'error') {
      badge.bg = 'bg-red-100';
      badge.text = 'text-red-800';
      badge.label = 'Failed';
    } else if (severity === 'warning') {
      badge.bg = 'bg-amber-100';
      badge.text = 'text-amber-800';
      badge.label = 'Warning';
    }

    return (
      <span className={`px-2 py-1 text-xs font-semibold rounded-full ${badge.bg} ${badge.text}`}>
        {badge.label}
      </span>
    );
  };


  const formatDuration = (seconds) => {
    if (!seconds) return '0s';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
  };

  if (logs.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow p-12 text-center">
        <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
        </svg>
        <h3 className="mt-2 text-sm font-medium text-gray-900">No calls match these filters</h3>
        <p className="mt-1 text-sm text-gray-500">Try clearing a filter or choosing a wider date range.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {logs.map((log) => (
        <div
          key={log._id || log.id || log.callSid}
          className="bg-white rounded-lg shadow hover:shadow-md transition-shadow border border-gray-200"
        >
          <div className="p-6">
            {/* Header */}
            <div className="flex items-start justify-between mb-4">
              <div className="flex-1">
                <div className="flex items-center space-x-3 mb-2">
                  <h3 className="text-lg font-semibold text-gray-900">
                    {log.lead?.name || 'Unknown'}
                  </h3>
                  {getStatusBadge(log)}
                  {(() => {
                    const badge = getCallOutcomeBadge(log);
                    if (!badge) return null;
                    return (
                      <span className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-full ${badge.color}`}>
                        <span className="text-[11px]">{badge.icon}</span>
                        {badge.label}
                      </span>
                    );
                  })()}
                </div>
                <div className="flex items-center space-x-4 text-sm text-gray-600">
                  <div className="flex items-center">
                    <svg className="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                    </svg>
                    {log.lead?.phoneNumber || log.to || 'N/A'}
                  </div>
                  <div className="flex items-center">
                    <svg className="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    {formatDistanceToNow(new Date(log.createdAt), { addSuffix: true })}
                  </div>
                </div>
              </div>
              <div className="text-right">
                <div className="text-2xl font-bold text-gray-900">{formatDuration(log.duration)}</div>
                <div className="text-xs text-gray-500">Duration</div>
              </div>
            </div>

            {/* Campaign & Caller Info */}
            <div className="flex items-center space-x-6 mb-4 text-sm flex-wrap gap-y-2">
              <div>
                <span className="text-gray-500">Campaign:</span>
                <span className="ml-2 font-medium text-gray-900">
                  {log.campaignId?.name || 'Unknown'}
                </span>
              </div>
              <div>
                <span className="text-gray-500">AI Caller:</span>
                <span className="ml-2 font-medium text-gray-900">
                  {log.callerId?.name || 'Unknown'}
                </span>
              </div>
              {log.extractionProcessed ? (
                <div>
                  <span className="text-gray-500">Interest:</span>
                  <span className="ml-2 font-medium text-gray-900">
                    {log.extracted?.interest_level === undefined || log.extracted?.interest_level === ''
                      ? '0'
                      : String(log.extracted.interest_level).replace('_', ' ')}
                  </span>
                </div>
              ) : (
                <div>
                  <span className="text-gray-500">Post-call:</span>
                  <span className="ml-2 font-medium text-gray-500">Not processed</span>
                </div>
              )}
              <div>
                <span className="text-gray-500">Call Status:</span>
                <span className="ml-2 font-medium text-gray-900">
                  {(() => {
                    const badge = getCallOutcomeBadge(log);
                    if (!badge) return <span className="text-gray-400">Pending</span>;
                    return (
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-semibold rounded-full ${badge.color}`}>
                        <span className="text-[11px]">{badge.icon}</span>
                        {badge.label}
                      </span>
                    );
                  })()}
                </span>
              </div>
              {log.extractionProcessed && (
                <div>
                  <span className="text-gray-500">Callback:</span>
                  <span className="ml-2 font-medium text-gray-900">
                    {log.extracted?.callback_requested ? 'Yes' : 'No'}
                  </span>
                </div>
              )}
              {formatAvailability(log.extracted?.availability) && (
                <div>
                  <span className="text-gray-500">Free at:</span>
                  <span className="ml-2 font-medium text-gray-900">
                    {availabilityCloseness(log.extracted?.availability)
                      ? `${availabilityCloseness(log.extracted.availability)} · ${formatAvailability(log.extracted.availability)}`
                      : formatAvailability(log.extracted.availability)}
                  </span>
                </div>
              )}
              {log.extracted?.intent && (
                <div>
                  <span className="text-gray-500">Intent:</span>
                  <span className="ml-2 font-medium text-gray-900 capitalize">
                    {log.extracted.intent}
                  </span>
                </div>
              )}
            </div>

            {/* Summary */}
            {(log.summary || log.aiSummary) && (
              <div className="mb-4 p-3 bg-gray-50 rounded-md border border-gray-200">
                <div className="text-xs font-medium text-gray-500 uppercase mb-1">AI Summary</div>
                <p className="text-sm text-gray-700">{log.summary || log.aiSummary}</p>
              </div>
            )}

            {/* Tags */}
            {log.tags && log.tags.length > 0 && (
              <div className="mb-4">
                <div className="flex flex-wrap gap-2">
                  {log.tags.map((tag, index) => (
                    <span
                      key={index}
                      className="px-2 py-1 bg-blue-100 text-blue-700 text-xs rounded-full"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center justify-between pt-4 border-t border-gray-200">
              <button
                onClick={() => onViewDetails(log)}
                className="text-sm text-blue-600 hover:text-blue-800 font-medium flex items-center"
              >
                <svg className="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </svg>
                View Details
              </button>
              <div className="flex items-center space-x-3">
                {log.recordingUrl && (
                  <a
                    href={log.recordingUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-gray-600 hover:text-gray-900 flex items-center"
                  >
                    <svg className="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    Recording
                  </a>
                )}
                {/* Deleted legacy delete button */}
              </div>
            </div>
          </div>
        </div>
      ))}

      {/* Load More */}
      {hasMore && (
        <div className="text-center py-4">
          <button
            onClick={onLoadMore}
            disabled={loading}
            className="px-6 py-2 bg-white border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {loading ? 'Loading...' : 'Load More'}
          </button>
        </div>
      )}
    </div>
  );
};

export default CallLogsList;
