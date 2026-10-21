import { useDispatch, useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { deleteCaller } from '../../store/slices/callersSlice';
import { S2S_PROVIDERS } from '../../utils/constants';

const CallersList = ({ onEdit, onEditScript, onCreate }) => {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const { callers, loading } = useSelector((state) => state.callers);

  const handleEdit = (caller) => {
    if (onEdit) {
      onEdit(caller);
      return;
    }
    navigate('/cm/callers');
  };

  const handleDelete = async (id) => {
    if (window.confirm('Are you sure you want to delete this AI Caller?')) {
      try {
        await dispatch(deleteCaller(id)).unwrap();
      } catch (error) {
        alert('Failed to delete AI Caller: ' + (error || 'Unknown error'));
      }
    }
  };

  const getProviderName = (providers, id) => {
    const provider = providers.find(p => p.id === id);
    return provider ? provider.name : id;
  };

  const handleCreate = () => {
    if (onCreate) {
      onCreate();
      return;
    }
    navigate('/cm/callers');
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center py-12">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  if (callers.length === 0) {
    return (
      <div className="text-center py-12">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-gray-100 mb-4">
          <svg className="w-8 h-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
          </svg>
        </div>
        <h3 className="text-lg font-medium text-gray-900 mb-2">No AI Callers Yet</h3>
        <p className="text-gray-500 mb-6">Create your first AI caller to get started with automated calling campaigns.</p>
        <button
          onClick={handleCreate}
          className="inline-flex items-center px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700"
        >
          <svg className="w-5 h-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Create AI Caller
        </button>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {callers.map((caller) => (
        <div
          key={caller._id}
          className="bg-white rounded-lg shadow hover:shadow-lg transition-shadow border border-gray-200"
        >
          {(() => {
            const pipeline = caller.s2sConfig?.pipeline || 'GEMINI_LIVE';
            const isSttLlmTts = pipeline === 'STT_LLM_TTS';

            return (
          <div className="p-6">
            {/* Header */}
            <div className="flex items-start justify-between mb-4">
              <div className="flex-1">
                <h3 className="text-lg font-semibold text-gray-900 mb-1">{caller.name}</h3>
                {caller.description && (
                  <p className="text-sm text-gray-500 line-clamp-2">{caller.description}</p>
                )}
              </div>
              <span
                className={`ml-2 px-2 py-1 text-xs font-semibold rounded-full ${
                  caller.isActive ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                }`}
              >
                {caller.isActive ? 'Active' : 'Inactive'}
              </span>
            </div>

            {/* Configuration Details */}
            <div className="space-y-3 mb-4">
              <div className="flex items-center text-sm">
                <div className="w-20 text-gray-500 font-medium">Mode:</div>
                <div className="flex-1">
                  <span className="inline-flex items-center px-2 py-1 rounded bg-indigo-50 text-indigo-700 text-xs">
                    {isSttLlmTts ? 'STT → LLM → TTS' : 'Speech-to-Speech'}
                  </span>
                </div>
              </div>
              {isSttLlmTts ? (
                <>
                  <div className="flex items-center text-sm">
                    <div className="w-20 text-gray-500 font-medium">STT:</div>
                    <div className="flex-1 text-gray-600 text-xs">
                      {caller.s2sConfig?.sttModel || 'Deepgram'}
                      {' · '}
                      {caller.s2sConfig?.sttLanguage || 'en-US'}
                    </div>
                  </div>
                  <div className="flex items-center text-sm">
                    <div className="w-20 text-gray-500 font-medium">LLM:</div>
                    <div className="flex-1 text-gray-600 text-xs">
                      {caller.s2sConfig?.llmModel || 'Configured model'}
                    </div>
                  </div>
                  <div className="flex items-center text-sm">
                    <div className="w-20 text-gray-500 font-medium">TTS:</div>
                    <div className="flex-1 text-gray-600 text-xs">
                      {caller.s2sConfig?.ttsModel || 'Configured model'}
                      {' · '}
                      {caller.s2sConfig?.ttsVoice || 'Configured voice'}
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex items-center text-sm">
                    <div className="w-20 text-gray-500 font-medium">S2S:</div>
                    <div className="flex-1">
                      <span className="inline-flex items-center px-2 py-1 rounded bg-blue-50 text-blue-700 text-xs">
                        {getProviderName(S2S_PROVIDERS, caller.s2sConfig?.provider)}
                      </span>
                      <span className="ml-2 text-gray-600 text-xs">
                        {caller.s2sConfig?.model || 'Default model'}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center text-sm">
                    <div className="w-20 text-gray-500 font-medium">Voice:</div>
                    <div className="flex-1">
                      <span className="inline-flex items-center px-2 py-1 rounded bg-green-50 text-green-700 text-xs">
                        {caller.s2sConfig?.voice || 'Default'}
                      </span>
                      <span className="ml-2 text-gray-600 text-xs">
                        {caller.s2sConfig?.promptRegion === 'south' ? 'South' : 'North'}
                        {' · '}
                        {caller.s2sConfig?.language || 'en-US'}
                      </span>
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Stats */}
            <div className="border-t border-gray-200 pt-4 mb-4">
              <div className="grid grid-cols-2 gap-4 text-center">
                <div>
                  <div className="text-2xl font-bold text-gray-900">
                    {caller.qaEntries?.length || 0}
                  </div>
                  <div className="text-xs text-gray-500">Q&A Pairs</div>
                </div>
                <div>
                  <div className="text-2xl font-bold text-gray-900">
                    {caller.scriptFlow?.nodes?.length || 0}
                  </div>
                  <div className="text-xs text-gray-500">Script Nodes</div>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center justify-between pt-4 border-t border-gray-200">
              <button
                onClick={() => (onEditScript ? onEditScript(caller) : navigate(`/cm/callers/${caller._id}/script`))}
                className="text-sm text-blue-600 hover:text-blue-800 font-medium"
              >
                Edit Script
              </button>
              <div className="flex space-x-2">
                <button
                  onClick={() => handleEdit(caller)}
                  className="p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded"
                  title="Edit"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                </button>
                <button
                  onClick={() => handleDelete(caller._id)}
                  className="p-2 text-red-600 hover:text-red-800 hover:bg-red-50 rounded"
                  title="Delete"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
            );
          })()}
        </div>
      ))}
    </div>
  );
};

export default CallersList;
