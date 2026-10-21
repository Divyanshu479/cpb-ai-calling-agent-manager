import { Handle, Position } from 'reactflow';

const SayNode = ({ data, selected }) => {
  return (
    <div className={`px-4 py-3 rounded-lg border-2 bg-white min-w-[200px] max-w-[300px] ${
      selected ? 'border-blue-500 shadow-lg' : 'border-blue-300'
    }`}>
      <Handle type="target" position={Position.Top} className="!bg-blue-500 !w-3 !h-3" />

      <div className="flex items-start space-x-2">
        <div className="h-8 w-8 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
          <svg className="h-5 w-5 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs font-semibold text-gray-500 uppercase">Say</div>
          <div className="text-sm text-gray-900 break-words">
            {data.message || 'AI speaks to caller'}
          </div>
        </div>
      </div>

      {data.message && (
        <div className="mt-2 p-2 bg-gray-50 rounded text-xs text-gray-600 border border-gray-200">
          "{data.message.substring(0, 60)}{data.message.length > 60 ? '...' : ''}"
        </div>
      )}

      <Handle type="source" position={Position.Bottom} className="!bg-blue-500 !w-3 !h-3" />
    </div>
  );
};

export default SayNode;
