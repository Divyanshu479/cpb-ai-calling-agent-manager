import { format } from 'date-fns';
import { mergeTranscriptTurnsBySpeaker } from '../../utils/transcript';

const CallDetailModal = ({ log, onClose }) => {
  if (!log) return null;

  const mergedConversationLog = mergeTranscriptTurnsBySpeaker(
    (log.conversationLog || []).map((entry) => ({
      ...entry,
      text: entry?.message || '',
    }))
  );

  const formatDuration = (seconds) => {
    if (!seconds) return '0s';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
  };

  const getStatusColor = (status) => {
    const colors = {
      completed: 'text-green-600',
      failed: 'text-red-600',
      no_answer: 'text-yellow-600',
      busy: 'text-orange-600',
      voicemail: 'text-blue-600',
    };
    return colors[status] || 'text-gray-600';
  };

  return (
    <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">Call Details</h2>
            <p className="text-sm text-gray-500 mt-1">
              {log.lead?.name} • {log.lead?.phoneNumber}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-500"
          >
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
            <div className="bg-gray-50 rounded-lg p-4">
              <div className="text-xs text-gray-500 uppercase mb-1">Status</div>
              <div className={`text-lg font-semibold ${getStatusColor(log.status)} capitalize`}>
                {log.status.replace('_', ' ')}
              </div>
            </div>
            <div className="bg-gray-50 rounded-lg p-4">
              <div className="text-xs text-gray-500 uppercase mb-1">Duration</div>
              <div className="text-lg font-semibold text-gray-900">
                {formatDuration(log.duration)}
              </div>
            </div>
            <div className="bg-gray-50 rounded-lg p-4">
              <div className="text-xs text-gray-500 uppercase mb-1">Date & Time</div>
              <div className="text-sm font-medium text-gray-900">
                {format(new Date(log.createdAt), 'MMM d, yyyy')}
              </div>
              <div className="text-xs text-gray-600">
                {format(new Date(log.createdAt), 'h:mm a')}
              </div>
            </div>
            <div className="bg-gray-50 rounded-lg p-4">
              <div className="text-xs text-gray-500 uppercase mb-1">Campaign</div>
              <div className="text-sm font-medium text-gray-900 truncate">
                {log.campaignId?.name || 'Unknown'}
              </div>
            </div>
          </div>

          {/* AI Summary */}
          {log.summary && (
            <div className="mb-6">
              <h3 className="text-sm font-semibold text-gray-900 mb-2">AI Summary</h3>
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <p className="text-sm text-gray-700">{log.summary}</p>
              </div>
            </div>
          )}

          {/* Tags */}
          {log.tags && log.tags.length > 0 && (
            <div className="mb-6">
              <h3 className="text-sm font-semibold text-gray-900 mb-2">Tags</h3>
              <div className="flex flex-wrap gap-2">
                {log.tags.map((tag, index) => (
                  <span
                    key={index}
                    className="px-3 py-1 bg-blue-100 text-blue-700 text-sm rounded-full"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Conversation Transcript */}
          {mergedConversationLog.length > 0 && (
            <div className="mb-6">
              <h3 className="text-sm font-semibold text-gray-900 mb-3">Conversation Transcript</h3>
              <div className="bg-gray-50 rounded-lg p-4 space-y-3 max-h-96 overflow-y-auto">
                {mergedConversationLog.map((entry, index) => (
                  <div key={index} className="flex items-start space-x-3">
                    <div className="flex-shrink-0">
                      {entry.speaker === 'ai' ? (
                        <div className="h-8 w-8 rounded-full bg-blue-100 flex items-center justify-center">
                          <svg className="h-4 w-4 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                          </svg>
                        </div>
                      ) : (
                        <div className="h-8 w-8 rounded-full bg-green-100 flex items-center justify-center">
                          <svg className="h-4 w-4 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                          </svg>
                        </div>
                      )}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center space-x-2 mb-1">
                        <span className="text-xs font-semibold text-gray-900 uppercase">
                          {entry.speaker === 'ai' ? 'AI Caller' : 'Customer'}
                        </span>
                        {entry.timestamp && (
                          <span className="text-xs text-gray-500">
                            {format(new Date(entry.timestamp), 'h:mm:ss a')}
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-gray-700">{entry.text}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Recording */}
          {log.recordingUrl && (
            <div className="mb-6">
              <h3 className="text-sm font-semibold text-gray-900 mb-2">Call Recording</h3>
              <div className="bg-gray-50 rounded-lg p-4">
                <audio controls className="w-full">
                  <source src={log.recordingUrl} type="audio/mpeg" />
                  Your browser does not support the audio element.
                </audio>
                <div className="mt-2 text-right">
                  <a
                    href={log.recordingUrl}
                    download
                    className="text-sm text-blue-600 hover:text-blue-800"
                  >
                    Download Recording
                  </a>
                </div>
              </div>
            </div>
          )}

          {/* Lead Information */}
          <div className="mb-6">
            <h3 className="text-sm font-semibold text-gray-900 mb-2">Lead Information</h3>
            <div className="bg-gray-50 rounded-lg p-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-xs text-gray-500 uppercase mb-1">Name</div>
                  <div className="text-sm font-medium text-gray-900">{log.lead?.name || 'N/A'}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-500 uppercase mb-1">Phone Number</div>
                  <div className="text-sm font-medium text-gray-900">{log.lead?.phoneNumber || 'N/A'}</div>
                </div>
                {log.lead?.email && (
                  <div>
                    <div className="text-xs text-gray-500 uppercase mb-1">Email</div>
                    <div className="text-sm font-medium text-gray-900">{log.lead.email}</div>
                  </div>
                )}
                {log.lead?.customFields && Object.keys(log.lead.customFields).length > 0 && (
                  <div className="col-span-2">
                    <div className="text-xs text-gray-500 uppercase mb-2">Custom Fields</div>
                    <div className="grid grid-cols-2 gap-2">
                      {Object.entries(log.lead.customFields).map(([key, value]) => (
                        <div key={key} className="text-sm">
                          <span className="text-gray-600">{key}:</span>
                          <span className="ml-2 text-gray-900">{value}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default CallDetailModal;
