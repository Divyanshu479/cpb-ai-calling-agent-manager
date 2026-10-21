import { useState } from 'react';
import ManagersList from '../../components/users/ManagersList';
import ManagerForm from '../../components/users/ManagerForm';
import LimitsModal from '../../components/users/LimitsModal';

const Managers = () => {
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingManager, setEditingManager] = useState(null);
  const [limitsManager, setLimitsManager] = useState(null);

  const handleCreate = () => {
    setShowCreateForm(true);
  };

  const handleEdit = (manager) => {
    setEditingManager(manager);
  };

  const handleViewLimits = (manager) => {
    setLimitsManager(manager);
  };

  const handleCloseForm = () => {
    setShowCreateForm(false);
    setEditingManager(null);
  };

  const handleCloseLimits = () => {
    setLimitsManager(null);
  };

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Campaign Managers</h1>
          <p className="text-gray-600 mt-2">
            Manage campaign managers and their allocated limits
          </p>
        </div>
        <button
          onClick={handleCreate}
          className="flex items-center px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors"
        >
          <svg className="w-5 h-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Create Manager
        </button>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center">
            <div className="flex-shrink-0 bg-blue-500 rounded-md p-3">
              <svg className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
              </svg>
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-500">Total Managers</p>
              <p className="text-2xl font-semibold text-gray-900">
                {/* This will be populated from Redux state */}
                0
              </p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center">
            <div className="flex-shrink-0 bg-green-500 rounded-md p-3">
              <svg className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-500">Active Managers</p>
              <p className="text-2xl font-semibold text-gray-900">0</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center">
            <div className="flex-shrink-0 bg-purple-500 rounded-md p-3">
              <svg className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
              </svg>
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-500">Total Calls Today</p>
              <p className="text-2xl font-semibold text-gray-900">0</p>
            </div>
          </div>
        </div>
      </div>

      {/* Managers List */}
      <ManagersList
        onEdit={handleEdit}
        onViewLimits={handleViewLimits}
      />

      {/* Create/Edit Manager Form Modal */}
      {(showCreateForm || editingManager) && (
        <ManagerForm
          manager={editingManager}
          onClose={handleCloseForm}
          onSuccess={() => {
            // Could show a success toast here
          }}
        />
      )}

      {/* Limits Modal */}
      {limitsManager && (
        <LimitsModal
          manager={limitsManager}
          onClose={handleCloseLimits}
          onSuccess={() => {
            // Could show a success toast here
          }}
        />
      )}
    </div>
  );
};

export default Managers;
