import { Handle, Position } from 'reactflow';

const EndCallNode = ({ data, selected }) => {
  return (
    <div className={`px-4 py-3 rounded-lg border-2 bg-white min-w-[150px] ${
      selected ? 'border-red-500 shadow-lg' : 'border-red-300'
    }`}>
      <Handle type="target" position={Position.Top} className="!bg-red-500 !w-3 !h-3" />

      <div className="flex items-center space-x-2">
        <div className="h-8 w-8 rounded-full bg-red-100 flex items-center justify-center">
          <svg className="h-5 w-5 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </div>
        <div>
          <div className="text-xs font-semibold text-gray-500 uppercase">End Call</div>
          <div className="text-sm font-medium text-gray-900">
            {data.reason || 'Call Ends'}
          </div>
        </div>
      </div>

      {data.reason && (
        <div className="mt-2 text-xs text-gray-600">
          Reason: {data.reason}
        </div>
      )}
    </div>
  );
};

export default EndCallNode;
