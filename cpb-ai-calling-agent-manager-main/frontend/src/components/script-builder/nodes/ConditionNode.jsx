import { Handle, Position } from 'reactflow';

const ConditionNode = ({ data, selected }) => {
  return (
    <div className={`px-4 py-3 rounded-lg border-2 bg-white min-w-[200px] ${
      selected ? 'border-yellow-500 shadow-lg' : 'border-yellow-300'
    }`}>
      <Handle type="target" position={Position.Top} className="!bg-yellow-500 !w-3 !h-3" />

      <div className="flex items-start space-x-2">
        <div className="h-8 w-8 rounded-full bg-yellow-100 flex items-center justify-center flex-shrink-0">
          <svg className="h-5 w-5 text-yellow-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <div className="flex-1">
          <div className="text-xs font-semibold text-gray-500 uppercase">Condition</div>
          <div className="text-sm text-gray-900">
            {data.condition || 'If/Else Logic'}
          </div>
        </div>
      </div>

      {data.condition && (
        <div className="mt-2 p-2 bg-gray-50 rounded text-xs text-gray-600 border border-gray-200">
          {data.condition}
        </div>
      )}

      <div className="flex justify-between mt-3">
        <div className="relative">
          <Handle
            type="source"
            position={Position.Bottom}
            id="true"
            className="!bg-green-500 !w-3 !h-3 !-left-4"
          />
          <span className="text-xs text-green-600 font-medium">True</span>
        </div>
        <div className="relative">
          <Handle
            type="source"
            position={Position.Bottom}
            id="false"
            className="!bg-red-500 !w-3 !h-3 !-right-4"
          />
          <span className="text-xs text-red-600 font-medium">False</span>
        </div>
      </div>
    </div>
  );
};

export default ConditionNode;
