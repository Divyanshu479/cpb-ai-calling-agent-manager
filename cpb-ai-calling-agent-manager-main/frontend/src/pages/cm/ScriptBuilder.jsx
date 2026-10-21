import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import ScriptCanvas from '../../components/script-builder/ScriptCanvas';
import { fetchCaller, updateCallerScript } from '../../store/slices/callersSlice';

const ScriptBuilder = () => {
  const { callerId } = useParams();
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const { callers, loading } = useSelector((state) => state.callers);
  const [caller, setCaller] = useState(null);

  useEffect(() => {
    if (callerId) {
      dispatch(fetchCaller(callerId));
    }
  }, [dispatch, callerId]);

  useEffect(() => {
    const currentCaller = callers.find((c) => c._id === callerId);
    if (currentCaller) {
      setCaller(currentCaller);
    }
  }, [callers, callerId]);

  const handleSave = async (script) => {
    try {
      await dispatch(
        updateCallerScript({
          id: callerId,
          nodes: script.nodes,
          edges: script.edges,
        })
      ).unwrap();

      alert('Script saved successfully!');
    } catch (error) {
      console.error('Failed to save script:', error);
      alert('Failed to save script. Please try again.');
    }
  };

  const handleBack = () => {
    navigate('/cm/callers');
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading script builder...</p>
        </div>
      </div>
    );
  }

  if (!caller) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <h3 className="mt-2 text-sm font-medium text-gray-900">AI Caller not found</h3>
          <p className="mt-1 text-sm text-gray-500">The AI caller you're looking for doesn't exist.</p>
          <div className="mt-6">
            <button
              onClick={handleBack}
              className="inline-flex items-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-primary-600 hover:bg-primary-700"
            >
              Go Back to AI Callers
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <button
              onClick={handleBack}
              className="p-2 text-gray-400 hover:text-gray-600 rounded-md hover:bg-gray-100"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">{caller.name}</h1>
              <p className="text-sm text-gray-500">Design your conversation flow</p>
            </div>
          </div>
          <div className="flex items-center space-x-3">
            <div className="text-right">
              <div className="text-xs text-gray-500">AI Caller</div>
              <div className="text-sm font-medium text-gray-900">{caller.name}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Script Builder Canvas */}
      <div className="flex-1 overflow-hidden">
        <ScriptCanvas
          initialScript={caller.scriptFlow}
          onSave={handleSave}
        />
      </div>
    </div>
  );
};

export default ScriptBuilder;
