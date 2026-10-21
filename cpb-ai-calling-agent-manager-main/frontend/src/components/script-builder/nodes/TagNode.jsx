import { Handle, Position } from 'reactflow';

const TagNode = ({ data, selected }) => {
  return (
    <div className={`px-4 py-3 rounded-lg border-2 bg-white min-w-[180px] ${
      selected ? 'border-orange-500 shadow-lg' : 'border-orange-300'
    }`}>
      <Handle type="target" position={Position.Top} className="!bg-orange-500 !w-3 !h-3" />

      <div className="flex items-center space-x-2">
        <div className="h-8 w-8 rounded-full bg-orange-100 flex items-center justify-center">
          <svg className="h-5 w-5 text-orange-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
          </svg>
        </div>
        <div className="flex-1">
          <div className="text-xs font-semibold text-gray-500 uppercase">Tag Lead</div>
          <div className="text-sm font-medium text-gray-900">
            {data.tag || 'Apply tag'}
          </div>
        </div>
      </div>

      {data.tag && (
        <div className="mt-2 flex flex-wrap gap-1">
          {data.tag.split(',').map((tag, i) => (
            <span key={i} className="px-2 py-1 bg-orange-100 text-orange-700 text-xs rounded-full">
              {tag.trim()}
            </span>
          ))}
        </div>
      )}

      <Handle type="source" position={Position.Bottom} className="!bg-orange-500 !w-3 !h-3" />
    </div>
  );
};

export default TagNode;
