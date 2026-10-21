import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import axios from '../../utils/axios';
import { mergeTranscriptTurnsBySpeaker, transcriptTextToTurns } from '../../utils/transcript';

const formatDuration = (seconds) => {
  const safe = Number(seconds) || 0;
  if (safe <= 0) return '0s';
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
};

const AdminCallLogDetail = () => {
  const { callId } = useParams();
  const navigate = useNavigate();
  const [log, setLog] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const load = async () => {
      if (!callId) return;
      setLoading(true);
      setError('');
      try {
        const response = await axios.get(`/admin/provider-call-logs/${callId}`);
        setLog(response.data?.data || null);
      } catch (fetchError) {
        setError(fetchError.response?.data?.message || 'Failed to fetch call details');
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [callId]);

  if (loading && !log) {
    return <div className="p-6 text-gray-600">Loading call details...</div>;
  }

  if (error && !log) {
    return (
      <div className="p-6">
        <button
          onClick={() => navigate('/admin/logs')}
          className="text-sm text-blue-600 hover:text-blue-800 mb-3"
        >
          ← Back to All Call Logs
        </button>
        <div className="bg-white rounded-lg shadow p-6 text-red-600">{error}</div>
      </div>
    );
  }

  if (!log) {
    return null;
  }

  const transcriptTurns = (log.transcriptTurns || []).length > 0
    ? mergeTranscriptTurnsBySpeaker(log.transcriptTurns)
    : transcriptTextToTurns(log.transcriptText);

  return (
    <div className="p-6 space-y-6">
      <div>
        <button
          onClick={() => navigate('/admin/logs')}
          className="text-sm text-blue-600 hover:text-blue-800 mb-2"
        >
          ← Back to All Call Logs
        </button>
        <h1 className="text-3xl font-bold text-gray-900">Call Detail (Admin)</h1>
        <p className="text-gray-600 mt-2 font-mono text-xs">{log.callSid}</p>
      </div>

      <div className="bg-white rounded-lg shadow p-6 grid grid-cols-1 md:grid-cols-4 gap-4">
        <div>
          <p className="text-xs text-gray-500 uppercase">Status</p>
          <p className="text-lg font-semibold text-gray-900 capitalize">{log.status || 'unknown'}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500 uppercase">Duration</p>
          <p className="text-lg font-semibold text-gray-900">{formatDuration(log.duration)}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500 uppercase">From</p>
          <p className="text-sm font-medium text-gray-900">{log.from || 'N/A'}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500 uppercase">To</p>
          <p className="text-sm font-medium text-gray-900">{log.to || 'N/A'}</p>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow p-6 space-y-4">
        <h2 className="text-lg font-semibold text-gray-900">Attribution</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-gray-500">Campaign:</span>{' '}
            <span className="font-medium text-gray-900">{log.campaignId?.name || 'N/A'}</span>
          </div>
          <div>
            <span className="text-gray-500">Manager:</span>{' '}
            <span className="font-medium text-gray-900">{log.campaignId?.createdBy?.name || 'N/A'}</span>
          </div>
          <div>
            <span className="text-gray-500">Manager Email:</span>{' '}
            <span className="font-medium text-gray-900">{log.campaignId?.createdBy?.email || 'N/A'}</span>
          </div>
          <div>
            <span className="text-gray-500">Lead:</span>{' '}
            <span className="font-medium text-gray-900">{log.lead?.name || 'N/A'}</span>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow p-6 space-y-3">
        <h2 className="text-lg font-semibold text-gray-900">AI Summary</h2>
        <p className="text-sm text-gray-700 whitespace-pre-wrap">{log.aiSummary || 'No summary available.'}</p>
      </div>

      <div className="bg-white rounded-lg shadow p-6 space-y-3">
        <h2 className="text-lg font-semibold text-gray-900">Transcript</h2>
        {transcriptTurns.length > 0 ? (
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {transcriptTurns.map((turn, index) => (
              <div key={turn._id || index} className="text-sm">
                <span className="text-xs uppercase text-gray-500 mr-2">{turn.speaker}</span>
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
        {log.recordingUrl ? (
          <div className="space-y-3">
            <audio controls className="w-full">
              <source src={log.recordingUrl} type="audio/mpeg" />
            </audio>
            <a
              href={log.recordingUrl}
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

export default AdminCallLogDetail;
