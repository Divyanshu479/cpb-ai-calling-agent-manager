import { useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigate, useParams } from 'react-router-dom';
import { fetchProviderCallLog, clearCurrentLog } from '../../store/slices/callLogsSlice';
import { mergeTranscriptTurnsBySpeaker, transcriptTextToTurns } from '../../utils/transcript';
import { getCallOutcomeBadge } from '../../utils/callOutcome';
import { formatAvailability } from '../../utils/availability';

const formatDuration = (seconds) => {
  const safe = Number(seconds) || 0;
  if (safe <= 0) return '0s';
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
};

const CallLogDetail = () => {
  const { callId } = useParams();
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const { currentLog, loading, error } = useSelector((state) => state.callLogs);

  useEffect(() => {
    if (!callId) return;
    dispatch(fetchProviderCallLog(callId));
    return () => {
      dispatch(clearCurrentLog());
    };
  }, [dispatch, callId]);

  if (loading && !currentLog) {
    return <div className="p-6 text-gray-600">Loading call details...</div>;
  }

  if (error && !currentLog) {
    return (
      <div className="p-6">
        <button
          onClick={() => navigate('/cm/logs')}
          className="text-sm text-blue-600 hover:text-blue-800 mb-3"
        >
          ← Back to Call Logs
        </button>
        <div className="bg-white rounded-lg shadow p-6 text-red-600">{error}</div>
      </div>
    );
  }

  if (!currentLog) {
    return null;
  }

  const transcriptTurns = (currentLog.transcriptTurns || []).length > 0
    ? mergeTranscriptTurnsBySpeaker(currentLog.transcriptTurns)
    : transcriptTextToTurns(currentLog.transcriptText);

  return (
    <div className="p-6 space-y-6">
      <div>
        <button
          onClick={() => navigate('/cm/logs')}
          className="text-sm text-blue-600 hover:text-blue-800 mb-2"
        >
          ← Back to Call Logs
        </button>
        <h1 className="text-3xl font-bold text-gray-900">Call Detail</h1>
        <p className="text-gray-600 mt-2 font-mono text-xs">{currentLog.callSid}</p>
      </div>

      <div className="bg-white rounded-lg shadow p-6 grid grid-cols-1 md:grid-cols-5 gap-4">
        <div>
          <p className="text-xs text-gray-500 uppercase">Status</p>
          <p className="text-lg font-semibold text-gray-900 capitalize">{(currentLog.status || 'unknown').replace('_', ' ')}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500 uppercase">Call Status</p>
          <div className="mt-1">
            {(() => {
              const badge = getCallOutcomeBadge(currentLog);
              if (!badge) return <span className="text-gray-400">—</span>;
              return (
                <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold ${badge.color}`}>
                  <span className="text-[11px]">{badge.icon}</span>
                  {badge.label}
                </span>
              );
            })()}
          </div>
        </div>
        <div>
          <p className="text-xs text-gray-500 uppercase">Duration</p>
          <p className="text-lg font-semibold text-gray-900">{formatDuration(currentLog.duration)}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500 uppercase">From</p>
          <p className="text-sm font-medium text-gray-900">{currentLog.from || 'N/A'}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500 uppercase">To</p>
          <p className="text-sm font-medium text-gray-900">{currentLog.to || 'N/A'}</p>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow p-6 space-y-4">
        <h2 className="text-lg font-semibold text-gray-900">Context</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-gray-500">Campaign:</span>{' '}
            <span className="font-medium text-gray-900">{currentLog.campaignId?.name || 'N/A'}</span>
          </div>
          <div>
            <span className="text-gray-500">Lead:</span>{' '}
            <span className="font-medium text-gray-900">{currentLog.lead?.name || 'N/A'}</span>
          </div>
          <div>
            <span className="text-gray-500">Lead Phone:</span>{' '}
            <span className="font-medium text-gray-900">{currentLog.lead?.phoneNumber || 'N/A'}</span>
          </div>
          <div>
            <span className="text-gray-500">Created At:</span>{' '}
            <span className="font-medium text-gray-900">
              {currentLog.createdAt ? new Date(currentLog.createdAt).toLocaleString() : 'N/A'}
            </span>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow p-6 space-y-3">
        <h3 className="text-lg font-semibold text-gray-900 mb-2">Summary and End Reason</h3>
        <div className="bg-gray-50 rounded-md p-3 space-y-2">
          <div className="text-sm text-gray-700">
            <span className="font-medium">Summary:</span> {currentLog.summary || currentLog.aiSummary || 'N/A'}
          </div>
          <div className="text-sm text-gray-700">
            <span className="font-medium">End Reason:</span> {currentLog.endReason || 'N/A'}
          </div>
          <div className="text-sm text-gray-700">
            <span className="font-medium">Tool End Reason:</span>{' '}
            {currentLog.toolEndReason || 'N/A'}
          </div>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow p-6 space-y-3">
        <h3 className="text-lg font-semibold text-gray-900 mb-2">Structured Fields</h3>
        <div className="bg-gray-50 rounded-md p-3 grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
          <div>
            <span className="font-medium">Intent:</span>{' '}
            {currentLog.extracted?.intent || '-'}
          </div>
          <div>
            <span className="font-medium">Interest:</span>{' '}
            {currentLog.extracted?.interest_level || '-'}
          </div>
          <div>
            <span className="font-medium">Callback Requested:</span>{' '}
            {currentLog.extracted?.callback_requested ? 'Yes' : 'No'}
          </div>
          <div>
            <span className="font-medium">Callback Time:</span>{' '}
            {currentLog.extracted?.callback_time || '-'}
          </div>
          <div>
            <span className="font-medium">Free at:</span>{' '}
            {formatAvailability(currentLog.extracted?.availability) || '-'}
          </div>
          <div className="md:col-span-2">
            <span className="font-medium">Objections:</span>{' '}
            {(currentLog.extracted?.objections || []).join(', ') || '-'}
          </div>
          <div className="md:col-span-2">
            <span className="font-medium">Next Step:</span>{' '}
            {currentLog.extracted?.next_step || '-'}
          </div>
          <div className="md:col-span-2">
            <span className="font-medium">Notes:</span> {currentLog.extracted?.notes || '-'}
          </div>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow p-6 space-y-3">
        <h3 className="text-lg font-semibold text-gray-900 mb-2">Retry Chain</h3>
        <div className="bg-gray-50 rounded-md p-3 text-sm text-gray-700 space-y-2">
          <div>
            <span className="font-medium">Parent Session:</span>{' '}
            {currentLog.parentSessionId?._id || currentLog.parentSessionId || 'None'}
          </div>
          <div>
            <span className="font-medium">Child Sessions:</span>{' '}
            {Array.isArray(currentLog.childSessions) && currentLog.childSessions.length > 0
              ? currentLog.childSessions.map((child) => child._id || child).join(', ')
              : 'None'}
          </div>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow p-6 space-y-3">
        <h2 className="text-lg font-semibold text-gray-900">Transcript</h2>
        {transcriptTurns.length > 0 ? (
          <div className="bg-gray-50 rounded-md p-3 max-h-96 overflow-y-auto space-y-2">
            {transcriptTurns.map((turn, index) => (
              <div key={turn._id || index} className="text-sm">
                <span className="text-xs font-medium uppercase text-gray-500 mr-2">{turn.speaker}</span>
                <span className="text-gray-800">{turn.text}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-gray-700 whitespace-pre-wrap">No transcript available.</p>
        )}
      </div>

      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-3">Recording</h2>
        {currentLog.recordingUrl ? (
          <div className="space-y-3">
            <audio controls className="w-full">
              <source src={currentLog.recordingUrl} type="audio/mpeg" />
            </audio>
            <a
              href={currentLog.recordingUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-blue-600 hover:text-blue-800"
            >
              Open recording in new tab
            </a>
          </div>
        ) : (
          <p className="text-sm text-gray-600">No recording available.</p>
        )}
      </div>
    </div>
  );
};

export default CallLogDetail;
