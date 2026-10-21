import { Handle, Position } from 'reactflow';

const QuestionNode = ({ data, selected }) => {
  return (
    <div className={`px-4 py-3 rounded-lg border-2 bg-white min-w-[200px] max-w-[300px] ${
      selected ? 'border-indigo-500 shadow-lg' : 'border-indigo-300'
    }`}>
      <Handle type="target" position={Position.Top} className="!bg-indigo-500 !w-3 !h-3" />

      <div className="flex items-start space-x-2">
        <div className="h-8 w-8 rounded-full bg-indigo-100 flex items-center justify-center flex-shrink-0">
          <svg className="h-5 w-5 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs font-semibold text-gray-500 uppercase">Question</div>
          <div className="text-sm text-gray-900 break-words">
            {data.question || 'Ask a question'}
          </div>
        </div>
      </div>

      {data.question && (
        <div className="mt-2 p-2 bg-gray-50 rounded text-xs text-gray-600 border border-gray-200">
          "{data.question.substring(0, 60)}{data.question.length > 60 ? '...' : ''}"
        </div>
      )}

      {data.saveAs && (
        <div className="mt-2 text-xs text-gray-600">
          Save answer as: <span className="font-mono bg-gray-100 px-1 rounded">{data.saveAs}</span>
        </div>
      )}

      <Handle type="source" position={Position.Bottom} className="!bg-indigo-500 !w-3 !h-3" />
    </div>
  );
};

export default QuestionNode;
