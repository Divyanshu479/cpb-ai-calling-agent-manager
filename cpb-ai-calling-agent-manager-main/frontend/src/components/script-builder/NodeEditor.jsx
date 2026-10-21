import { useState, useEffect } from 'react';

const NodeEditor = ({ selectedNode, onUpdate, onClose, onDelete }) => {
  const [formData, setFormData] = useState({});

  useEffect(() => {
    if (selectedNode) {
      setFormData(selectedNode.data || {});
    }
  }, [selectedNode]);

  if (!selectedNode) {
    return (
      <div className="w-80 bg-white border-l border-gray-200 p-6 flex items-center justify-center">
        <div className="text-center text-gray-500">
          <svg className="mx-auto h-12 w-12 text-gray-400 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122" />
          </svg>
          <p className="text-sm">Select a node to edit</p>
        </div>
      </div>
    );
  }

  const handleChange = (field, value) => {
    const newData = { ...formData, [field]: value };
    setFormData(newData);
    onUpdate(selectedNode.id, newData);
  };

  const renderFields = () => {
    switch (selectedNode.type) {
      case 'say':
        return (
          <>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Message *
              </label>
              <textarea
                value={formData.message || ''}
                onChange={(e) => handleChange('message', e.target.value)}
                rows={4}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="What should the AI say?"
              />
              <p className="mt-1 text-xs text-gray-500">
                Use variables like {'{'}name{'}'} to personalize
              </p>
            </div>
          </>
        );

      case 'listen':
        return (
          <>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Timeout (seconds)
              </label>
              <input
                type="number"
                value={formData.timeout || 10}
                onChange={(e) => handleChange('timeout', parseInt(e.target.value))}
                min={1}
                max={60}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Save Response As
              </label>
              <input
                type="text"
                value={formData.saveAs || ''}
                onChange={(e) => handleChange('saveAs', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
                placeholder="e.g., userResponse"
              />
            </div>
          </>
        );

      case 'question':
        return (
          <>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Question *
              </label>
              <textarea
                value={formData.question || ''}
                onChange={(e) => handleChange('question', e.target.value)}
                rows={3}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="What question should the AI ask?"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Save Answer As
              </label>
              <input
                type="text"
                value={formData.saveAs || ''}
                onChange={(e) => handleChange('saveAs', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="e.g., userAnswer"
              />
            </div>
          </>
        );

      case 'condition':
        return (
          <>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Condition *
              </label>
              <textarea
                value={formData.condition || ''}
                onChange={(e) => handleChange('condition', e.target.value)}
                rows={3}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-yellow-500"
                placeholder="e.g., userResponse contains 'yes'"
              />
              <p className="mt-1 text-xs text-gray-500">
                Use simple conditions or JavaScript expressions
              </p>
            </div>
          </>
        );

      case 'knowledgeLookup':
        return (
          <>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Search Query *
              </label>
              <textarea
                value={formData.query || ''}
                onChange={(e) => handleChange('query', e.target.value)}
                rows={3}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-500"
                placeholder="What to search in knowledge base?"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Save Result As
              </label>
              <input
                type="text"
                value={formData.saveAs || ''}
                onChange={(e) => handleChange('saveAs', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-500"
                placeholder="e.g., knowledgeResult"
              />
            </div>
          </>
        );

      case 'tag':
        return (
          <>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Tags *
              </label>
              <input
                type="text"
                value={formData.tag || ''}
                onChange={(e) => handleChange('tag', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-orange-500"
                placeholder="e.g., interested, callback"
              />
              <p className="mt-1 text-xs text-gray-500">
                Separate multiple tags with commas
              </p>
            </div>
          </>
        );

      case 'endCall':
        return (
          <>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Reason
              </label>
              <select
                value={formData.reason || 'completed'}
                onChange={(e) => handleChange('reason', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-500"
              >
                <option value="completed">Completed Successfully</option>
                <option value="not_interested">Not Interested</option>
                <option value="callback">Callback Requested</option>
                <option value="voicemail">Voicemail</option>
                <option value="no_answer">No Answer</option>
                <option value="error">Error</option>
              </select>
            </div>
          </>
        );

      default:
        return null;
    }
  };

  return (
    <div className="w-80 bg-white border-l border-gray-200 p-6 overflow-y-auto">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-medium text-gray-900">Edit Node</h3>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-gray-500"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="mb-4 p-3 bg-gray-50 rounded-lg">
        <div className="text-xs font-medium text-gray-500 uppercase">Node Type</div>
        <div className="text-sm font-semibold text-gray-900 capitalize">{selectedNode.type}</div>
      </div>

      <div className="space-y-4">
        {renderFields()}
      </div>

      <div className="mt-6 pt-6 border-t border-gray-200">
        <button
          onClick={() => onDelete(selectedNode.id)}
          className="w-full px-4 py-2 bg-red-50 text-red-600 rounded-md hover:bg-red-100 transition-colors text-sm font-medium"
        >
          Delete Node
        </button>
      </div>
    </div>
  );
};

export default NodeEditor;
