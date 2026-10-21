import { useState } from 'react';

const FieldMapping = ({ headers, previewRows, fieldMapping, onChange }) => {
  const [customFieldName, setCustomFieldName] = useState('');

  const handleFieldChange = (field, value) => {
    onChange({
      ...fieldMapping,
      [field]: value,
    });
  };

  const handleCustomFieldAdd = () => {
    if (!customFieldName.trim()) return;

    onChange({
      ...fieldMapping,
      customFields: {
        ...fieldMapping.customFields,
        [customFieldName]: '',
      },
    });
    setCustomFieldName('');
  };

  const handleCustomFieldMap = (fieldName, csvColumn) => {
    onChange({
      ...fieldMapping,
      customFields: {
        ...fieldMapping.customFields,
        [fieldName]: csvColumn,
      },
    });
  };

  const handleCustomFieldRemove = (fieldName) => {
    const { [fieldName]: removed, ...rest } = fieldMapping.customFields;
    onChange({
      ...fieldMapping,
      customFields: rest,
    });
  };

  return (
    <div className="space-y-6">
      {/* Instructions */}
      <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
        <p className="text-sm text-blue-900">
          Map your CSV columns to lead fields. Phone number is required, other fields are optional.
        </p>
      </div>

      {/* Standard Fields */}
      <div className="space-y-4">
        <h3 className="text-lg font-semibold text-gray-900">Standard Fields</h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Name
              <span className="text-gray-400 ml-1">(Optional)</span>
            </label>
            <select
              value={fieldMapping.name}
              onChange={(e) => handleFieldChange('name', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              <option value="">-- Select Column --</option>
              {headers.map((header) => (
                <option key={header} value={header}>
                  {header}
                </option>
              ))}
            </select>
          </div>

          {/* Phone Number */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Phone Number
              <span className="text-red-500 ml-1">*</span>
            </label>
            <select
              value={fieldMapping.phoneNumber}
              onChange={(e) => handleFieldChange('phoneNumber', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              <option value="">-- Select Column --</option>
              {headers.map((header) => (
                <option key={header} value={header}>
                  {header}
                </option>
              ))}
            </select>
            {!fieldMapping.phoneNumber && (
              <p className="mt-1 text-xs text-red-600">Phone number is required</p>
            )}
          </div>

          {/* Email */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Email
              <span className="text-gray-400 ml-1">(Optional)</span>
            </label>
            <select
              value={fieldMapping.email}
              onChange={(e) => handleFieldChange('email', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              <option value="">-- Select Column --</option>
              {headers.map((header) => (
                <option key={header} value={header}>
                  {header}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Custom Fields */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-gray-900">Custom Fields</h3>
          <div className="flex items-center space-x-2">
            <input
              type="text"
              value={customFieldName}
              onChange={(e) => setCustomFieldName(e.target.value)}
              placeholder="Field name"
              className="px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
              onKeyPress={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleCustomFieldAdd();
                }
              }}
            />
            <button
              onClick={handleCustomFieldAdd}
              className="px-3 py-1.5 text-sm bg-primary-600 text-white rounded-md hover:bg-primary-700"
            >
              Add Field
            </button>
          </div>
        </div>

        {Object.keys(fieldMapping.customFields).length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {Object.keys(fieldMapping.customFields).map((fieldName) => (
              <div key={fieldName} className="flex items-center space-x-2">
                <div className="flex-1">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {fieldName}
                  </label>
                  <select
                    value={fieldMapping.customFields[fieldName]}
                    onChange={(e) => handleCustomFieldMap(fieldName, e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                  >
                    <option value="">-- Select Column --</option>
                    {headers.map((header) => (
                      <option key={header} value={header}>
                        {header}
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  onClick={() => handleCustomFieldRemove(fieldName)}
                  className="mt-6 p-2 text-red-600 hover:bg-red-50 rounded"
                  title="Remove field"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-gray-500 italic">
            No custom fields added. Click "Add Field" to map additional columns.
          </p>
        )}
      </div>

      {/* Preview */}
      <div className="space-y-4">
        <h3 className="text-lg font-semibold text-gray-900">Data Preview</h3>
        <div className="overflow-x-auto border border-gray-200 rounded-lg">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                  Name
                </th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                  Phone
                </th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                  Email
                </th>
                {Object.keys(fieldMapping.customFields).map((fieldName) => (
                  <th
                    key={fieldName}
                    className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase"
                  >
                    {fieldName}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {previewRows.map((row, index) => (
                <tr key={index} className="hover:bg-gray-50">
                  <td className="px-4 py-2 text-sm text-gray-900">
                    {fieldMapping.name ? row[fieldMapping.name] : '-'}
                  </td>
                  <td className="px-4 py-2 text-sm text-gray-900">
                    {fieldMapping.phoneNumber ? row[fieldMapping.phoneNumber] : '-'}
                  </td>
                  <td className="px-4 py-2 text-sm text-gray-900">
                    {fieldMapping.email ? row[fieldMapping.email] : '-'}
                  </td>
                  {Object.keys(fieldMapping.customFields).map((fieldName) => (
                    <td key={fieldName} className="px-4 py-2 text-sm text-gray-900">
                      {fieldMapping.customFields[fieldName]
                        ? row[fieldMapping.customFields[fieldName]]
                        : '-'}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-gray-500">
          Showing first {previewRows.length} rows as preview
        </p>
      </div>
    </div>
  );
};

export default FieldMapping;
