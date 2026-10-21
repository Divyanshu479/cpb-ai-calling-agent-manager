import { Handle, Position } from 'reactflow';

const StartNode = ({ data, selected }) => {
  return (
    <div className={`px-4 py-3 rounded-lg border-2 bg-white min-w-[150px] ${
      selected ? 'border-green-500 shadow-lg' : 'border-green-300'
    }`}>
      <div className="flex items-center space-x-2">
        <div className="h-8 w-8 rounded-full bg-green-100 flex items-center justify-center">
          <svg className="h-5 w-5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <div>
          <div className="text-xs font-semibold text-gray-500 uppercase">Start</div>
          <div className="text-sm font-medium text-gray-900">Call Begins</div>
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-green-500 !w-3 !h-3" />
    </div>
  );
};

export default StartNode;
