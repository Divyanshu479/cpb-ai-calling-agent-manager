import { Handle, Position } from 'reactflow';

const KnowledgeLookupNode = ({ data, selected }) => {
  return (
    <div className={`px-4 py-3 rounded-lg border-2 bg-white min-w-[200px] ${
      selected ? 'border-teal-500 shadow-lg' : 'border-teal-300'
    }`}>
      <Handle type="target" position={Position.Top} className="!bg-teal-500 !w-3 !h-3" />

      <div className="flex items-start space-x-2">
        <div className="h-8 w-8 rounded-full bg-teal-100 flex items-center justify-center flex-shrink-0">
          <svg className="h-5 w-5 text-teal-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
          </svg>
        </div>
        <div className="flex-1">
          <div className="text-xs font-semibold text-gray-500 uppercase">Knowledge Lookup</div>
          <div className="text-sm text-gray-900">
            {data.query || 'Search knowledge base'}
          </div>
        </div>
      </div>

      {data.query && (
        <div className="mt-2 p-2 bg-gray-50 rounded text-xs text-gray-600 border border-gray-200">
          Query: "{data.query.substring(0, 50)}{data.query.length > 50 ? '...' : ''}"
        </div>
      )}

      {data.saveAs && (
        <div className="mt-2 text-xs text-gray-600">
          Save result as: <span className="font-mono bg-gray-100 px-1 rounded">{data.saveAs}</span>
        </div>
      )}

      <Handle type="source" position={Position.Bottom} className="!bg-teal-500 !w-3 !h-3" />
    </div>
  );
};

export default KnowledgeLookupNode;
