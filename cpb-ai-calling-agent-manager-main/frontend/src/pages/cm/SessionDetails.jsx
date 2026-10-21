import { useParams, useNavigate } from "react-router-dom";
import { useEffect, useMemo, useState } from 'react';
import axios from '../../utils/axios';
import { mergeTranscriptTurnsBySpeaker } from '../../utils/transcript';
import { callOutcomeSeverity, getCallOutcomeBadge } from '../../utils/callOutcome';
import { formatAvailability, availabilityCloseness } from '../../utils/availability';

const SessionDetails = () => {
  const { campaignId, sid } = useParams();
  const navigate = useNavigate();

  const [selectedSession, setSelectedSession] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState('');

  const loadSessionDetail = async (sessionId) => {
    if (!campaignId || !sessionId) return;
    setLoadingDetail(true);
    setDetailError('');
    try {
      const response = await axios.get(`/campaigns/${campaignId}/sessions/${sessionId}`);
      const detail = response.data?.data || null;
      setSelectedSession(detail);
    } catch (error) {
      setSelectedSession(null);
      setDetailError(error.response?.data?.message || 'Failed to load session details');
    } finally {
      setLoadingDetail(false);
    }
  };

  useEffect(() => {
    if (sid) loadSessionDetail(sid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sid, campaignId]);

  const mergedSessionTranscriptTurns = useMemo(
    () => mergeTranscriptTurnsBySpeaker(selectedSession?.transcriptTurns || []),
    [selectedSession?.transcriptTurns]
  );

  const formatDuration = (durationSeconds) => {
    const safeSeconds = Number(durationSeconds) || 0;
    if (safeSeconds <= 0) return '0s';
    const mins = Math.floor(safeSeconds / 60);
    const secs = safeSeconds % 60;
    return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
  };

  const formatCurrency = (v) => {
    const n = Number(v || 0);
    if (Number.isNaN(n)) return '-';
    try {
      return n.toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 6 });
    } catch (e) {
      return `₹${n.toFixed(6)}`;
    }
  };

  const renderTokenUsage = (usage = {}) => {
    if (!usage || Object.keys(usage).length === 0) return <div className="text-xs text-gray-500">No token usage recorded.</div>;
    return (
      <div className="text-xs text-gray-800 space-y-1">
        <div><span className="font-medium">Prompt:</span> {usage.promptTokenCount ?? usage.promptTokens ?? usage.promptTokenCountByModality ?? 0}</div>
        <div><span className="font-medium">Response:</span> {usage.responseTokenCount ?? usage.responseTokens ?? 0}</div>
        <div><span className="font-medium">Total:</span> {usage.totalTokenCount ?? usage.total ?? usage.totalTokens ?? 0}</div>
        {usage.promptTokensByModality && (
          <div>
            <span className="font-medium">By Modality:</span>{' '}
            {Object.entries(usage.promptTokensByModality).map(([k, v]) => `${k}:${v}`).join(', ')}
          </div>
        )}
      </div>
    );
  };

  const renderBridgeMetrics = (metrics = {}) => {
    if (!metrics || Object.keys(metrics).length === 0) return <div className="text-xs text-gray-500">No bridge metrics.</div>;
    const normalizedMetrics = {
      ...metrics,
      playbackQueueHighWaterMark: metrics.playbackQueueHighWaterMark ?? metrics.queueHighWaterMark,
      playbackFramesSent: metrics.playbackFramesSent ?? metrics.twilioFramesSent,
      playbackFramesDropped: metrics.playbackFramesDropped ?? metrics.twilioFramesDropped,
      mediaPacketsIn: metrics.mediaPacketsIn ?? metrics.twilioMediaPacketsIn,
      mediaBytesIn: metrics.mediaBytesIn ?? metrics.twilioMediaBytesIn,
      modelMessagesIn: metrics.modelMessagesIn ?? metrics.geminiMessagesIn,
      modelAudioPartsIn: metrics.modelAudioPartsIn ?? metrics.geminiAudioPartsIn,
      modelAudioBytesIn: metrics.modelAudioBytesIn ?? metrics.geminiAudioBytesIn,
      userAudioChunksSentToModel:
        metrics.userAudioChunksSentToModel ?? metrics.geminiAudioChunksOut,
      userAudioBytesSentToModel:
        metrics.userAudioBytesSentToModel ?? metrics.geminiAudioBytesOut,
      playbackEventsSent: metrics.playbackEventsSent ?? metrics.playAudioSent,
    };
    const keys = [
      'durationMs',
      'interruptions',
      'playbackQueueHighWaterMark',
      'mediaPacketsIn',
      'mediaBytesIn',
      'modelMessagesIn',
      'modelAudioPartsIn',
      'modelAudioBytesIn',
      'userAudioChunksSentToModel',
      'userAudioBytesSentToModel',
      'playbackEventsSent',
      'playbackFramesSent',
      'playbackFramesDropped',
      'usageMetadataEvents',
      'proactiveGreetingPrompts',
      'proactiveGreetingRetries',
      'closedAt',
    ];
    return (
      <div className="text-xs text-gray-800 grid grid-cols-1 sm:grid-cols-2 gap-2">
        {keys.map((k) => (
          normalizedMetrics[k] !== undefined ? (
            <div key={k}><span className="font-medium">{k.replace(/([A-Z])/g, ' $1')}:</span> {String(normalizedMetrics[k])}</div>
          ) : null
        ))}
        {Object.keys(normalizedMetrics)
          .filter((k) => !keys.includes(k))
          .slice(0, 20)
          .map((k) => (
            <div key={k}><span className="font-medium">{k}:</span> {String(normalizedMetrics[k])}</div>
          ))}
      </div>
    );
  };

  const getResourceUsageData = () => {
    if (!selectedSession) {
      return {
        duration: 0,
        totalCost: 0,
        promptTokens: 0,
        responseTokens: 0,
        totalTokens: 0,
        costPerMinute: '0',
        tokensPerMinute: 0,
        model: 'Unknown',
      };
    }

    const duration = Number(selectedSession.durationSeconds) || 0;

    // Prefer INR fields persisted by backend
    const inrObj = selectedSession.estimatedTokenCostInr || selectedSession.estimatedTokenCost || selectedSession.bridgeMetrics?.estimatedTokenCostInr || null;
    let totalCostInr = null;
    if (inrObj && (inrObj.totalInrWithPlatform || inrObj.totalInrWithPlatform === 0)) {
      totalCostInr = Number(inrObj.totalInrWithPlatform || 0);
    } else if (inrObj && (inrObj.totalInrWithPlatform === undefined) && inrObj.tokenTotalInr) {
      totalCostInr = Number(inrObj.tokenTotalInr + (inrObj.vobizPlatformCostInr || 0));
    } else if (selectedSession.estimatedTokenCostUsd && selectedSession.estimatedTokenCostUsd.totalUsd && selectedSession.estimatedTokenCostUsd.usdToInrRate) {
      totalCostInr = Number((selectedSession.estimatedTokenCostUsd.totalUsd * selectedSession.estimatedTokenCostUsd.usdToInrRate).toFixed(6));
    } else if (selectedSession.bridgeMetrics?.estimatedTokenCostUsd && selectedSession.bridgeMetrics.estimatedTokenCostUsd.totalUsd && selectedSession.bridgeMetrics.estimatedTokenCostUsd.usdToInrRate) {
      totalCostInr = Number((selectedSession.bridgeMetrics.estimatedTokenCostUsd.totalUsd * selectedSession.bridgeMetrics.estimatedTokenCostUsd.usdToInrRate).toFixed(6));
    }

    const promptTokens = selectedSession.tokenUsage?.promptTokenCount || selectedSession.metrics?.tokenUsage?.promptTokenCount || 0;
    const responseTokens = selectedSession.tokenUsage?.responseTokenCount || selectedSession.metrics?.tokenUsage?.responseTokenCount || 0;
    const totalTokens = promptTokens + responseTokens;

    const minuteFraction = duration > 0 ? (duration / 60) : 1; 
    const costPerMinute = duration > 0 && totalCostInr !== null ? (totalCostInr / Math.ceil(minuteFraction) ) : 0;
    const tokensPerMinute = duration > 0 ? Math.round(totalTokens / Math.ceil(minuteFraction)) : 0;

    return {
      duration,
      totalCost: totalCostInr !== null ? totalCostInr : null,
      promptTokens,
      responseTokens,
      totalTokens,
      costPerMinute,
      tokensPerMinute,
      model: selectedSession.model || selectedSession.estimatedTokenCostUsd?.pricingModel || 'Unknown',
    };
  };

  const usage = getResourceUsageData();

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <button
            onClick={() => navigate(`/cm/campaigns/${campaignId}/sessions`)}
            className="text-sm text-blue-600 hover:text-blue-800 mb-2"
          >
            ← Back to Sessions
          </button>
          <h1 className="text-3xl font-bold text-gray-900">Session Details</h1>
          <p className="text-gray-600 mt-2 text-sm">
            Campaign ID: <span className="font-mono">{campaignId}</span> • Session ID: <span className="font-mono">{sid}</span>
          </p>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow">
        <div className="px-4 py-3 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Details</h2>
        </div>

        {loadingDetail ? (
          <div className="p-8 text-center text-gray-500">Loading details...</div>
        ) : detailError ? (
          <div className="p-8 text-center text-red-600">{detailError}</div>
        ) : !selectedSession ? (
          <div className="p-8 text-center text-gray-500">Select a session to view details.</div>
        ) : (
          <div className="p-4 space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
              <div className="bg-gray-50 rounded-md p-3">
                <div className="text-xs text-gray-500 uppercase">Status</div>
                <div className={`text-sm font-semibold mt-1 ${callOutcomeSeverity(selectedSession) === 'error' ? 'text-red-700' : callOutcomeSeverity(selectedSession) === 'warning' ? 'text-amber-700' : 'text-gray-900'}`}>
                  {(callOutcomeSeverity(selectedSession) === 'error'
                    ? 'failed'
                    : callOutcomeSeverity(selectedSession) === 'warning'
                      ? 'warning'
                      : (selectedSession.status || 'unknown')
                  ).replace('_', ' ')}
                </div>
              </div>
              <div className="bg-gray-50 rounded-md p-3">
                <div className="text-xs text-gray-500 uppercase">Call Status</div>
                <div className="mt-1">
                  {(() => {
                    const badge = getCallOutcomeBadge(selectedSession);
                    if (!badge) return <span className="text-sm text-gray-400">—</span>;
                    return (
                      <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold ${badge.color}`}>
                        <span className="text-[11px]">{badge.icon}</span>
                        {badge.label}
                      </span>
                    );
                  })()}
                </div>
              </div>
              <div className="bg-gray-50 rounded-md p-3">
                <div className="text-xs text-gray-500 uppercase">Duration</div>
                <div className="text-sm font-semibold mt-1">
                  {formatDuration(selectedSession.durationSeconds)}
                </div>
              </div>
              <div className="bg-gray-50 rounded-md p-3">
                <div className="text-xs text-gray-500 uppercase">Provider Call ID</div>
                <div className="text-xs font-mono mt-1 break-all">
                  {selectedSession.providerCallId || selectedSession.twilioCallSid || 'N/A'}
                </div>
              </div>
              <div className="bg-gray-50 rounded-md p-3">
                <div className="text-xs text-gray-500 uppercase">Scheduled For</div>
                <div className="text-sm font-semibold mt-1">
                  {selectedSession.scheduledFor
                    ? new Date(selectedSession.scheduledFor).toLocaleString()
                    : '-'}
                </div>
              </div>
            </div>

            <div>
              <h3 className="text-sm font-semibold text-gray-900 mb-2">Summary and End Reason</h3>
              <div className="bg-gray-50 rounded-md p-3 space-y-2">
                <div className="text-sm text-gray-700">
                  <span className="font-medium">Summary:</span> {selectedSession.summary || 'N/A'}
                </div>
                <div className="text-sm text-gray-700">
                  <span className="font-medium">End Reason:</span> {selectedSession.endReason || 'N/A'}
                </div>
                <div className="text-sm text-gray-700">
                  <span className="font-medium">Tool End Reason:</span>{' '}
                  {selectedSession.toolEndReason || 'N/A'}
                </div>
              </div>
            </div>

            <div>
              <h3 className="text-sm font-semibold text-gray-900 mb-2">Structured Fields</h3>
              <div className="bg-gray-50 rounded-md p-3 grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                <div>
                  <span className="font-medium">Intent:</span>{' '}
                  {selectedSession.extracted?.intent || '-'}
                </div>
                <div>
                  <span className="font-medium">Interest:</span>{' '}
                  {selectedSession.extracted?.interest_level || '-'}
                </div>
                <div>
                  <span className="font-medium">Callback Requested:</span>{' '}
                  {selectedSession.extracted?.callback_requested ? 'Yes' : 'No'}
                </div>
                <div>
                  <span className="font-medium">Callback Time:</span>{' '}
                  {selectedSession.extracted?.callback_time || '-'}
                </div>
                <div>
                  <span className="font-medium">Free at:</span>{' '}
                  {availabilityCloseness(selectedSession.extracted?.availability)
                    ? `${availabilityCloseness(selectedSession.extracted.availability)} · ${formatAvailability(selectedSession.extracted.availability)}`
                    : (formatAvailability(selectedSession.extracted?.availability) || '-')}
                </div>
                <div className="md:col-span-2">
                  <span className="font-medium">Objections:</span>{' '}
                  {(selectedSession.extracted?.objections || []).join(', ') || '-'}
                </div>
                <div className="md:col-span-2">
                  <span className="font-medium">Next Step:</span>{' '}
                  {selectedSession.extracted?.next_step || '-'}
                </div>
                <div className="md:col-span-2">
                  <span className="font-medium">Notes:</span> {selectedSession.extracted?.notes || '-'}
                </div>
              </div>
            </div>

            <div>
              <h3 className="text-sm font-semibold text-gray-900 mb-2">Retry Chain</h3>
              <div className="bg-gray-50 rounded-md p-3 text-sm text-gray-700 space-y-2">
                <div>
                  <span className="font-medium">Parent Session:</span>{' '}
                  {selectedSession.parentSessionId?._id || 'None'}
                </div>
                <div>
                  <span className="font-medium">Child Sessions:</span>{' '}
                  {Array.isArray(selectedSession.childSessions) && selectedSession.childSessions.length > 0
                    ? selectedSession.childSessions.map((child) => child._id).join(', ')
                    : 'None'}
                </div>
              </div>
            </div>

            <div>
              <h3 className="text-sm font-semibold text-gray-900 mb-2">Transcript</h3>
              <div className="bg-gray-50 rounded-md p-3 max-h-96 overflow-y-auto space-y-2">
                {mergedSessionTranscriptTurns.length === 0 ? (
                  <p className="text-sm text-gray-500">No transcript stored.</p>
                ) : (
                  mergedSessionTranscriptTurns.map((turn) => (
                    <div key={turn._id || `${turn.speaker}-${turn.timestamp}`} className="text-sm">
                      <span className="font-medium uppercase text-xs text-gray-500 mr-2">
                        {turn.speaker}
                      </span>
                      <span className="text-gray-800">{turn.text}</span>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* <div>
              <h3 className="text-sm font-semibold text-gray-900 mb-2">Resource Usage</h3>
              <div className="bg-gray-50 rounded-md p-3 text-sm space-y-4">
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  <div>
                    <div className="text-xs text-gray-500 uppercase">Total Cost</div>
                    <div className="text-lg font-semibold text-gray-900">{usage.totalCost === null ? '-' : formatCurrency(usage.totalCost)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-500 uppercase">Cost/Min</div>
                      <div className="text-lg font-semibold text-gray-900">{formatCurrency(usage.costPerMinute)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-500 uppercase">Total Tokens</div>
                    <div className="text-lg font-semibold text-gray-900">{usage.totalTokens.toLocaleString()}</div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-500 uppercase">Tokens/Min</div>
                    <div className="text-lg font-semibold text-gray-900">{usage.tokensPerMinute.toLocaleString()}</div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-500 uppercase">Input Tokens</div>
                    <div className="text-base font-semibold text-gray-800">{usage.promptTokens.toLocaleString()}</div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-500 uppercase">Output Tokens</div>
                    <div className="text-base font-semibold text-gray-800">{usage.responseTokens.toLocaleString()}</div>
                  </div>
                </div>

                <div className="border-t border-gray-200 pt-3">
                  <div className="text-xs text-gray-500 uppercase mb-2">Model</div>
                  <div className="font-mono text-sm text-gray-700 break-all">{usage.model}</div>
                </div> 
              </div>
            </div> */}
          </div>
        )}
      </div>
      </div>
    );
}

export default SessionDetails;
