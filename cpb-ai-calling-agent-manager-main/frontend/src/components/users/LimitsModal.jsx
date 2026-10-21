import { useState, useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { updateManagerLimits } from '../../store/slices/usersSlice';

const LimitsModal = ({ manager, onClose, onSuccess }) => {
  const dispatch = useDispatch();
  const { loading } = useSelector((state) => state.users);

  const [limits, setLimits] = useState({
    maxCalls: 0,
    maxMinutes: 0,
  });

  useEffect(() => {
    if (manager) {
      setLimits({
        maxCalls: manager.limits.maxCalls,
        maxMinutes: manager.limits.maxMinutes,
      });
    }
  }, [manager]);

  const handleSubmit = async (e) => {
    e.preventDefault();

    try {
      await dispatch(
        updateManagerLimits({
          id: manager._id,
          limits,
        })
      ).unwrap();

      onSuccess?.();
      onClose();
    } catch (err) {
      console.error('Failed to update limits:', err);
    }
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setLimits((prev) => ({
      ...prev,
      [name]: parseInt(value) || 0,
    }));
  };

  const usagePercentage = {
    calls: limits.maxCalls > 0 ? (manager.usage.callsUsed / limits.maxCalls) * 100 : 0,
    minutes: limits.maxMinutes > 0 ? (manager.usage.minutesUsed / limits.maxMinutes) * 100 : 0,
  };

  return (
    <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-lg w-full mx-4">
        <div className="p-6">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-lg font-medium text-gray-900">
              Update Limits - {manager.name}
            </h3>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-500"
            >
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Current Usage */}
          <div className="mb-6 p-4 bg-gray-50 rounded-lg">
            <h4 className="text-sm font-medium text-gray-700 mb-3">Current Usage</h4>

            <div className="space-y-3">
              <div>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-gray-600">Calls</span>
                  <span className="font-medium">
                    {manager.usage.callsUsed} / {manager.limits.maxCalls}
                  </span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div
                    className={`h-2 rounded-full ${
                      usagePercentage.calls >= 90 ? 'bg-red-600' :
                      usagePercentage.calls >= 70 ? 'bg-yellow-500' : 'bg-green-500'
                    }`}
                    style={{ width: `${Math.min(usagePercentage.calls, 100)}%` }}
                  />
                </div>
              </div>

              <div>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-gray-600">Minutes</span>
                  <span className="font-medium">
                    {manager.usage.minutesUsed} / {manager.limits.maxMinutes}
                  </span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div
                    className={`h-2 rounded-full ${
                      usagePercentage.minutes >= 90 ? 'bg-red-600' :
                      usagePercentage.minutes >= 70 ? 'bg-yellow-500' : 'bg-green-500'
                    }`}
                    style={{ width: `${Math.min(usagePercentage.minutes, 100)}%` }}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Update Limits Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="maxCalls" className="block text-sm font-medium text-gray-700 mb-1">
                Max Calls Limit
              </label>
              <input
                type="number"
                id="maxCalls"
                name="maxCalls"
                value={limits.maxCalls}
                onChange={handleChange}
                min="0"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
              <p className="mt-1 text-xs text-gray-500">
                Remaining: {Math.max(0, limits.maxCalls - manager.usage.callsUsed)} calls
              </p>
            </div>

            <div>
              <label htmlFor="maxMinutes" className="block text-sm font-medium text-gray-700 mb-1">
                Max Minutes Limit
              </label>
              <input
                type="number"
                id="maxMinutes"
                name="maxMinutes"
                value={limits.maxMinutes}
                onChange={handleChange}
                min="0"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
              <p className="mt-1 text-xs text-gray-500">
                Remaining: {Math.max(0, limits.maxMinutes - manager.usage.minutesUsed)} minutes
              </p>
            </div>

            {/* Warning for decreasing limits */}
            {(limits.maxCalls < manager.limits.maxCalls || limits.maxMinutes < manager.limits.maxMinutes) && (
              <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-md">
                <div className="flex">
                  <svg className="h-5 w-5 text-yellow-400 mr-2" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                  </svg>
                  <p className="text-sm text-yellow-700">
                    Warning: Decreasing limits may restrict the manager's ability to create new campaigns or make calls.
                  </p>
                </div>
              </div>
            )}

            <div className="flex justify-end space-x-3 pt-4">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50"
                disabled={loading}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading}
                className="px-4 py-2 bg-primary-600 border border-transparent rounded-md text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? 'Updating...' : 'Update Limits'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default LimitsModal;
