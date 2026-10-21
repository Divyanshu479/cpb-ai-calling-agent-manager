import { useState, useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { createManager, updateManager } from '../../store/slices/usersSlice';
import CredentialsModal from './CredentialsModal';

const ManagerForm = ({ manager, onClose, onSuccess }) => {
  const dispatch = useDispatch();
  const { loading, error } = useSelector((state) => state.users);

  const [formData, setFormData] = useState({
    name: '',
    email: '',
    maxCalls: 1000,
    maxMinutes: 500,
    isActive: true,
  });

  const [errors, setErrors] = useState({});
  const [showCredentials, setShowCredentials] = useState(false);
  const [credentials, setCredentials] = useState(null);

  useEffect(() => {
    if (manager) {
      setFormData({
        name: manager.name,
        email: manager.email,
        maxCalls: manager.limits.maxCalls,
        maxMinutes: manager.limits.maxMinutes,
        isActive: manager.isActive,
      });
    }
  }, [manager]);

  const validateForm = () => {
    const newErrors = {};

    if (!formData.name.trim()) {
      newErrors.name = 'Name is required';
    }

    if (!formData.email.trim()) {
      newErrors.email = 'Email is required';
    } else if (!/\S+@\S+\.\S+/.test(formData.email)) {
      newErrors.email = 'Email is invalid';
    }

    if (formData.maxCalls < 0) {
      newErrors.maxCalls = 'Max calls must be 0 or greater';
    }

    if (formData.maxMinutes < 0) {
      newErrors.maxMinutes = 'Max minutes must be 0 or greater';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!validateForm()) {
      return;
    }

    try {
      if (manager) {
        // Update existing manager
        await dispatch(
          updateManager({
            id: manager._id,
            data: {
              name: formData.name,
              email: formData.email,
              isActive: formData.isActive,
            },
          })
        ).unwrap();
        onSuccess?.();
        onClose();
      } else {
        // Create new manager
        const result = await dispatch(
          createManager({
            name: formData.name,
            email: formData.email,
            limits: {
              maxCalls: formData.maxCalls,
              maxMinutes: formData.maxMinutes,
            },
          })
        ).unwrap();

        // Show credentials modal with the generated password
        if (result.credentials) {
          setCredentials(result.credentials);
          setShowCredentials(true);
        } else {
          onSuccess?.();
          onClose();
        }
      }
    } catch (err) {
      // Error is handled by Redux
      console.error('Failed to save manager:', err);
    }
  };

  const handleCredentialsClose = () => {
    setShowCredentials(false);
    setCredentials(null);
    onSuccess?.();
    onClose();
  };

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value,
    }));

    // Clear error for this field
    if (errors[name]) {
      setErrors((prev) => ({ ...prev, [name]: null }));
    }
  };

  return (
    <>
      <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 max-h-[90vh] overflow-y-auto">
          <div className="p-6">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-medium text-gray-900">
                {manager ? 'Edit Campaign Manager' : 'Create Campaign Manager'}
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

            {error && (
              <div className="mb-4 bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Name */}
              <div>
                <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-1">
                  Name *
                </label>
                <input
                  type="text"
                  id="name"
                  name="name"
                  value={formData.name}
                  onChange={handleChange}
                  className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 ${
                    errors.name ? 'border-red-500' : 'border-gray-300'
                  }`}
                  placeholder="John Doe"
                />
                {errors.name && <p className="mt-1 text-sm text-red-600">{errors.name}</p>}
              </div>

              {/* Email */}
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
                  Email *
                </label>
                <input
                  type="email"
                  id="email"
                  name="email"
                  value={formData.email}
                  onChange={handleChange}
                  className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 ${
                    errors.email ? 'border-red-500' : 'border-gray-300'
                  }`}
                  placeholder="john@example.com"
                />
                {errors.email && <p className="mt-1 text-sm text-red-600">{errors.email}</p>}
              </div>

              {/* Password info (only for new managers) */}
              {!manager && (
                <div className="bg-blue-50 border border-blue-200 rounded-md p-3">
                  <div className="flex">
                    <svg className="h-5 w-5 text-blue-400 mr-2 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <p className="text-sm text-blue-700">
                      A secure password will be automatically generated and shown after creation.
                    </p>
                  </div>
                </div>
              )}

              {/* Limits (only for new managers) */}
              {!manager && (
                <>
                  <div>
                    <label htmlFor="maxCalls" className="block text-sm font-medium text-gray-700 mb-1">
                      Max Calls Limit
                    </label>
                    <input
                      type="number"
                      id="maxCalls"
                      name="maxCalls"
                      value={formData.maxCalls}
                      onChange={handleChange}
                      min="0"
                      className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 ${
                        errors.maxCalls ? 'border-red-500' : 'border-gray-300'
                      }`}
                    />
                    {errors.maxCalls && <p className="mt-1 text-sm text-red-600">{errors.maxCalls}</p>}
                  </div>

                  <div>
                    <label htmlFor="maxMinutes" className="block text-sm font-medium text-gray-700 mb-1">
                      Max Minutes Limit
                    </label>
                    <input
                      type="number"
                      id="maxMinutes"
                      name="maxMinutes"
                      value={formData.maxMinutes}
                      onChange={handleChange}
                      min="0"
                      className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 ${
                        errors.maxMinutes ? 'border-red-500' : 'border-gray-300'
                      }`}
                    />
                    {errors.maxMinutes && <p className="mt-1 text-sm text-red-600">{errors.maxMinutes}</p>}
                  </div>
                </>
              )}

              {/* Active Status (only for edit) */}
              {manager && (
                <div className="flex items-center">
                  <input
                    type="checkbox"
                    id="isActive"
                    name="isActive"
                    checked={formData.isActive}
                    onChange={handleChange}
                    className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
                  />
                  <label htmlFor="isActive" className="ml-2 block text-sm text-gray-900">
                    Active
                  </label>
                </div>
              )}

              {/* Buttons */}
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
                  {loading ? 'Saving...' : manager ? 'Update' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>

      {/* Credentials Modal */}
      {showCredentials && credentials && (
        <CredentialsModal credentials={credentials} onClose={handleCredentialsClose} />
      )}
    </>
  );
};

export default ManagerForm;
