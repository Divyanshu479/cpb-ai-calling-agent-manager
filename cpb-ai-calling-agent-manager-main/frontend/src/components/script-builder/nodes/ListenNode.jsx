import { Handle, Position } from 'reactflow';

const ListenNode = ({ data, selected }) => {
  return (
    <div className={`px-4 py-3 rounded-lg border-2 bg-white min-w-[180px] ${
      selected ? 'border-purple-500 shadow-lg' : 'border-purple-300'
    }`}>
      <Handle type="target" position={Position.Top} className="!bg-purple-500 !w-3 !h-3" />

      <div className="flex items-center space-x-2">
        <div className="h-8 w-8 rounded-full bg-purple-100 flex items-center justify-center">
          <svg className="h-5 w-5 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
          </svg>
        </div>
        <div>
          <div className="text-xs font-semibold text-gray-500 uppercase">Listen</div>
          <div className="text-sm font-medium text-gray-900">
            {data.timeout ? `${data.timeout}s timeout` : 'Caller responds'}
          </div>
        </div>
      </div>

      {data.saveAs && (
        <div className="mt-2 text-xs text-gray-600">
          Save as: <span className="font-mono bg-gray-100 px-1 rounded">{data.saveAs}</span>
        </div>
      )}

      <Handle type="source" position={Position.Bottom} className="!bg-purple-500 !w-3 !h-3" />
    </div>
  );
};

export default ListenNode;
