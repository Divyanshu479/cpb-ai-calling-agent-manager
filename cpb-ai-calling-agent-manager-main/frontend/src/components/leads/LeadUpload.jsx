import { useState, useCallback } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { uploadLeads, clearUploadProgress } from '../../store/slices/leadsSlice';
import FieldMapping from './FieldMapping';

const LeadUpload = ({ campaignId, onClose, onSuccess }) => {
  const dispatch = useDispatch();
  const { uploadProgress } = useSelector((state) => state.leads);

  const [file, setFile] = useState(null);
  const [csvData, setCsvData] = useState(null);
  const [headers, setHeaders] = useState([]);
  const [previewRows, setPreviewRows] = useState([]);
  const [step, setStep] = useState(1); // 1: Upload, 2: Map Fields, 3: Confirm
  const [fieldMapping, setFieldMapping] = useState({
    name: '',
    phoneNumber: '',
    email: '',
    customFields: {},
  });
  const [dragActive, setDragActive] = useState(false);

  const handleDrag = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  }, []);

  const parseCSV = (text) => {
    const lines = text.split('\n').filter(line => line.trim());
    if (lines.length === 0) return null;

    const headers = lines[0].split(',').map(h => h.trim().replace(/^["']|["']$/g, ''));
    const rows = [];

    for (let i = 1; i < Math.min(lines.length, 6); i++) {
      const values = lines[i].split(',').map(v => v.trim().replace(/^["']|["']$/g, ''));
      const row = {};
      headers.forEach((header, index) => {
        row[header] = values[index] || '';
      });
      rows.push(row);
    }

    return { headers, rows, rawText: text };
  };

  const handleFile = useCallback((file) => {
    if (!file.name.endsWith('.csv')) {
      alert('Please upload a CSV file');
      return;
    }

    setFile(file);
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target.result;
      const parsed = parseCSV(text);

      if (parsed) {
        setHeaders(parsed.headers);
        setPreviewRows(parsed.rows);
        setCsvData(parsed.rawText);
        setStep(2);
      } else {
        alert('Failed to parse CSV file');
      }
    };
    reader.readAsText(file);
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFile(e.dataTransfer.files[0]);
    }
  }, [handleFile]);

  const handleFileChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      handleFile(e.target.files[0]);
    }
  };

  const handleUpload = async () => {
    if (!file || !fieldMapping.phoneNumber) {
      alert('Please map at least the phone number field');
      return;
    }

    try {
      await dispatch(uploadLeads({ campaignId, file, fieldMapping })).unwrap();
      if (onSuccess) onSuccess();
      setTimeout(() => {
        if (onClose) onClose();
      }, 2000);
    } catch (error) {
      console.error('Upload failed:', error);
    }
  };

  const handleClose = () => {
    dispatch(clearUploadProgress());
    if (onClose) onClose();
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl my-8">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">Upload Leads</h2>
            <p className="text-sm text-gray-600 mt-1">
              Step {step} of 2: {step === 1 ? 'Upload CSV File' : 'Map Fields'}
            </p>
          </div>
          <button
            onClick={handleClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-6">
          {/* Step 1: File Upload */}
          {step === 1 && (
            <div>
              <div
                className={`border-2 border-dashed rounded-lg p-12 text-center transition-colors ${
                  dragActive ? 'border-primary-500 bg-primary-50' : 'border-gray-300 bg-gray-50'
                }`}
                onDragEnter={handleDrag}
                onDragLeave={handleDrag}
                onDragOver={handleDrag}
                onDrop={handleDrop}
              >
                <svg
                  className="mx-auto h-12 w-12 text-gray-400"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                  />
                </svg>
                <p className="mt-2 text-sm text-gray-600">
                  Drag and drop your CSV file here, or
                </p>
                <label className="mt-2 inline-block">
                  <span className="mt-2 px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700 cursor-pointer inline-block">
                    Browse Files
                  </span>
                  <input
                    type="file"
                    accept=".csv"
                    onChange={handleFileChange}
                    className="hidden"
                  />
                </label>
                <p className="mt-2 text-xs text-gray-500">CSV files only (max 10MB)</p>
              </div>

              <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                <h4 className="text-sm font-medium text-blue-900 mb-2">CSV Format Requirements:</h4>
                <ul className="text-sm text-blue-800 space-y-1">
                  <li>• Must include a column for phone numbers</li>
                  <li>• First row should contain column headers</li>
                  <li>• Use comma (,) as delimiter</li>
                  <li>• Example: Name,Phone,Email,Company</li>
                </ul>
              </div>
            </div>
          )}

          {/* Step 2: Field Mapping */}
          {step === 2 && !uploadProgress && (
            <div>
              <FieldMapping
                headers={headers}
                previewRows={previewRows}
                fieldMapping={fieldMapping}
                onChange={setFieldMapping}
              />
            </div>
          )}

          {/* Upload Progress */}
          {uploadProgress && (
            <div className="py-8">
              {uploadProgress.status === 'uploading' && (
                <div className="text-center">
                  <svg className="animate-spin h-12 w-12 text-primary-600 mx-auto" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  <p className="mt-4 text-gray-600">{uploadProgress.message}</p>
                </div>
              )}

              {uploadProgress.status === 'success' && (
                <div className="text-center">
                  <svg className="h-12 w-12 text-green-600 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <p className="mt-4 text-lg font-medium text-green-600">{uploadProgress.message}</p>
                  {uploadProgress.data && (
                    <div className="mt-4 text-sm text-gray-600">
                      <p>Imported: {uploadProgress.data.imported} leads</p>
                      {uploadProgress.data.errors > 0 && (
                        <p className="text-yellow-600">Errors: {uploadProgress.data.errors}</p>
                      )}
                    </div>
                  )}
                </div>
              )}

              {uploadProgress.status === 'error' && (
                <div className="text-center">
                  <svg className="h-12 w-12 text-red-600 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <p className="mt-4 text-lg font-medium text-red-600">Upload Failed</p>
                  <p className="mt-2 text-sm text-gray-600">{uploadProgress.message}</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        {!uploadProgress && (
          <div className="flex justify-end space-x-3 p-6 border-t border-gray-200">
            {step === 2 && (
              <button
                onClick={() => setStep(1)}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
              >
                Back
              </button>
            )}
            <button
              onClick={handleClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
            >
              Cancel
            </button>
            {step === 2 && (
              <button
                onClick={handleUpload}
                disabled={!fieldMapping.phoneNumber}
                className="px-4 py-2 text-sm font-medium text-white bg-primary-600 border border-transparent rounded-md hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Upload Leads
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default LeadUpload;
