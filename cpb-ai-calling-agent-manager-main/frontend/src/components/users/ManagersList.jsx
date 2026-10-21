import { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { fetchManagers, deleteManager } from '../../store/slices/usersSlice';

const ManagersList = ({ onEdit, onViewLimits }) => {
  const dispatch = useDispatch();
  const { managers, loading } = useSelector((state) => state.users);
  const [deleteConfirm, setDeleteConfirm] = useState(null);

  useEffect(() => {
    dispatch(fetchManagers());
  }, [dispatch]);

  const handleDelete = async (id) => {
    await dispatch(deleteManager(id));
    setDeleteConfirm(null);
  };

  const getUsageColor = (used, max) => {
    if (max === 0) return 'text-gray-500';
    const percentage = (used / max) * 100;
    if (percentage >= 90) return 'text-red-600';
    if (percentage >= 70) return 'text-yellow-600';
    return 'text-green-600';
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center py-12">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  return (
    <div className="bg-white shadow rounded-lg overflow-hidden">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Manager
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Calls Usage
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Minutes Usage
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Status
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Last Login
            </th>
            <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
              Actions
            </th>
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {managers.length === 0 ? (
            <tr>
              <td colSpan="6" className="px-6 py-8 text-center text-gray-500">
                No campaign managers found. Create one to get started.
              </td>
            </tr>
          ) : (
            managers.map((manager) => (
              <tr key={manager._id} className="hover:bg-gray-50">
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="flex items-center">
                    <div className="flex-shrink-0 h-10 w-10 bg-primary-100 rounded-full flex items-center justify-center">
                      <span className="text-primary-600 font-medium">
                        {manager.name.charAt(0).toUpperCase()}
                      </span>
                    </div>
                    <div className="ml-4">
                      <div className="text-sm font-medium text-gray-900">{manager.name}</div>
                      <div className="text-sm text-gray-500">{manager.email}</div>
                    </div>
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="text-sm text-gray-900">
                    <span className={getUsageColor(manager.usage.callsUsed, manager.limits.maxCalls)}>
                      {manager.usage.callsUsed}
                    </span>
                    {' / '}
                    {manager.limits.maxCalls}
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-1.5 mt-1">
                    <div
                      className={`h-1.5 rounded-full ${
                        manager.limits.maxCalls > 0 && (manager.usage.callsUsed / manager.limits.maxCalls) * 100 >= 90
                          ? 'bg-red-600'
                          : manager.limits.maxCalls > 0 && (manager.usage.callsUsed / manager.limits.maxCalls) * 100 >= 70
                          ? 'bg-yellow-500'
                          : 'bg-green-500'
                      }`}
                      style={{
                        width: `${manager.limits.maxCalls > 0 ? Math.min((manager.usage.callsUsed / manager.limits.maxCalls) * 100, 100) : 0}%`,
                      }}
                    />
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="text-sm text-gray-900">
                    <span className={getUsageColor(manager.usage.minutesUsed, manager.limits.maxMinutes)}>
                      {manager.usage.minutesUsed}
                    </span>
                    {' / '}
                    {manager.limits.maxMinutes}
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-1.5 mt-1">
                    <div
                      className={`h-1.5 rounded-full ${
                        manager.limits.maxMinutes > 0 && (manager.usage.minutesUsed / manager.limits.maxMinutes) * 100 >= 90
                          ? 'bg-red-600'
                          : manager.limits.maxMinutes > 0 && (manager.usage.minutesUsed / manager.limits.maxMinutes) * 100 >= 70
                          ? 'bg-yellow-500'
                          : 'bg-green-500'
                      }`}
                      style={{
                        width: `${manager.limits.maxMinutes > 0 ? Math.min((manager.usage.minutesUsed / manager.limits.maxMinutes) * 100, 100) : 0}%`,
                      }}
                    />
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span
                    className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                      manager.isActive
                        ? 'bg-green-100 text-green-800'
                        : 'bg-red-100 text-red-800'
                    }`}
                  >
                    {manager.isActive ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                  {manager.lastLogin
                    ? new Date(manager.lastLogin).toLocaleDateString()
                    : 'Never'}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                  <button
                    onClick={() => onViewLimits(manager)}
                    className="text-primary-600 hover:text-primary-900 mr-4"
                  >
                    Limits
                  </button>
                  <button
                    onClick={() => onEdit(manager)}
                    className="text-blue-600 hover:text-blue-900 mr-4"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => setDeleteConfirm(manager._id)}
                    className="text-red-600 hover:text-red-900"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      {/* Delete Confirmation Modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-medium text-gray-900 mb-4">Confirm Delete</h3>
            <p className="text-sm text-gray-500 mb-6">
              Are you sure you want to deactivate this campaign manager? This action will prevent them from logging in.
            </p>
            <div className="flex justify-end space-x-3">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDelete(deleteConfirm)}
                className="px-4 py-2 bg-red-600 border border-transparent rounded-md text-sm font-medium text-white hover:bg-red-700"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ManagersList;
