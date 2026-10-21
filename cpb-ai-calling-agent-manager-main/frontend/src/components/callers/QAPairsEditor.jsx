import { useState } from 'react';

const QAPairsEditor = ({ qaEntries = [], onChange }) => {
  const [editingIndex, setEditingIndex] = useState(null);
  const [newPair, setNewPair] = useState({ question: '', answer: '' });
  const [showAddForm, setShowAddForm] = useState(false);

  const handleAdd = () => {
    if (newPair.question.trim() && newPair.answer.trim()) {
      onChange([...qaEntries, newPair]);
      setNewPair({ question: '', answer: '' });
      setShowAddForm(false);
    }
  };

  const handleEdit = (index) => {
    setEditingIndex(index);
  };

  const handleSave = (index, updatedPair) => {
    const updated = [...qaEntries];
    updated[index] = updatedPair;
    onChange(updated);
    setEditingIndex(null);
  };

  const handleDelete = (index) => {
    const updated = qaEntries.filter((_, i) => i !== index);
    onChange(updated);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-medium text-gray-900">Q&A Pairs</h3>
          <p className="text-xs text-gray-500 mt-1">
            Add common questions and answers for the AI to reference
          </p>
        </div>
        {!showAddForm && (
          <button
            type="button"
            onClick={() => setShowAddForm(true)}
            className="inline-flex items-center px-3 py-1.5 text-sm bg-primary-600 text-white rounded hover:bg-primary-700"
          >
            <svg className="w-4 h-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Add Q&A
          </button>
        )}
      </div>

      {/* Add New Q&A Form */}
      {showAddForm && (
        <div className="border border-primary-200 bg-primary-50 rounded-lg p-4 mb-4">
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Question
              </label>
              <input
                type="text"
                value={newPair.question}
                onChange={(e) => setNewPair({ ...newPair, question: e.target.value })}
                placeholder="What are your business hours?"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Answer
              </label>
              <textarea
                value={newPair.answer}
                onChange={(e) => setNewPair({ ...newPair, answer: e.target.value })}
                placeholder="We are open Monday to Friday, 9 AM to 6 PM."
                rows="2"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>
            <div className="flex justify-end space-x-2">
              <button
                type="button"
                onClick={() => {
                  setShowAddForm(false);
                  setNewPair({ question: '', answer: '' });
                }}
                className="px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleAdd}
                className="px-3 py-1.5 text-sm bg-primary-600 text-white rounded hover:bg-primary-700"
              >
                Add
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Q&A List */}
      {qaEntries.length === 0 ? (
        <div className="text-center py-8 border-2 border-dashed border-gray-300 rounded-lg">
          <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="mt-2 text-sm text-gray-500">No Q&A pairs added yet</p>
          <p className="text-xs text-gray-400">Click "Add Q&A" to get started</p>
        </div>
      ) : (
        <div className="space-y-3">
          {qaEntries.map((pair, index) => (
            <div key={index} className="border border-gray-200 rounded-lg p-4 hover:border-gray-300">
              {editingIndex === index ? (
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Question</label>
                    <input
                      type="text"
                      defaultValue={pair.question}
                      id={`edit-q-${index}`}
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Answer</label>
                    <textarea
                      defaultValue={pair.answer}
                      id={`edit-a-${index}`}
                      rows="2"
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                    />
                  </div>
                  <div className="flex justify-end space-x-2">
                    <button
                      type="button"
                      onClick={() => setEditingIndex(null)}
                      className="px-2 py-1 text-xs border border-gray-300 rounded hover:bg-gray-50"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const question = document.getElementById(`edit-q-${index}`).value;
                        const answer = document.getElementById(`edit-a-${index}`).value;
                        handleSave(index, { question, answer });
                      }}
                      className="px-2 py-1 text-xs bg-primary-600 text-white rounded hover:bg-primary-700"
                    >
                      Save
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex items-start justify-between">
                    <div className="flex-1 mr-4">
                      <div className="flex items-start mb-2">
                        <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-primary-100 text-primary-600 text-xs font-medium mr-2 flex-shrink-0 mt-0.5">
                          Q
                        </span>
                        <p className="text-sm font-medium text-gray-900">{pair.question}</p>
                      </div>
                      <div className="flex items-start">
                        <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-green-100 text-green-600 text-xs font-medium mr-2 flex-shrink-0 mt-0.5">
                          A
                        </span>
                        <p className="text-sm text-gray-600">{pair.answer}</p>
                      </div>
                    </div>
                    <div className="flex space-x-1">
                      <button
                        type="button"
                        onClick={() => handleEdit(index)}
                        className="p-1.5 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded"
                        title="Edit"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(index)}
                        className="p-1.5 text-red-600 hover:text-red-800 hover:bg-red-50 rounded"
                        title="Delete"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default QAPairsEditor;
