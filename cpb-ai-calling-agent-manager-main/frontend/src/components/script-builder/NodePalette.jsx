const NodePalette = ({ onAddNode }) => {
  const nodeTypes = [
    {
      type: 'start',
      label: 'Start',
      icon: '▶️',
      color: 'green',
      description: 'Beginning of call',
      disabled: true, // Only one start node allowed
    },
    {
      type: 'say',
      label: 'Say',
      icon: '💬',
      color: 'blue',
      description: 'AI speaks to caller',
    },
    {
      type: 'listen',
      label: 'Listen',
      icon: '🎤',
      color: 'purple',
      description: 'Wait for caller response',
    },
    {
      type: 'question',
      label: 'Question',
      icon: '❓',
      color: 'indigo',
      description: 'Ask a specific question',
    },
    {
      type: 'condition',
      label: 'Condition',
      icon: '🔀',
      color: 'yellow',
      description: 'If/Else logic',
    },
    {
      type: 'knowledgeLookup',
      label: 'Knowledge Lookup',
      icon: '📚',
      color: 'teal',
      description: 'Search knowledge base',
    },
    {
      type: 'tag',
      label: 'Tag Lead',
      icon: '🏷️',
      color: 'orange',
      description: 'Add tags to lead',
    },
    {
      type: 'endCall',
      label: 'End Call',
      icon: '🔚',
      color: 'red',
      description: 'Terminate the call',
    },
  ];

  const handleDragStart = (event, nodeType) => {
    event.dataTransfer.setData('application/reactflow', nodeType);
    event.dataTransfer.effectAllowed = 'move';
  };

  return (
    <div className="w-64 bg-white border-r border-gray-200 p-4 overflow-y-auto">
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-gray-900 mb-1">Node Palette</h3>
        <p className="text-xs text-gray-500">Drag nodes to the canvas</p>
      </div>

      <div className="space-y-2">
        {nodeTypes.map((node) => (
          <div
            key={node.type}
            draggable={!node.disabled}
            onDragStart={(e) => handleDragStart(e, node.type)}
            className={`p-3 rounded-lg border-2 cursor-move transition-all ${
              node.disabled
                ? 'border-gray-200 bg-gray-50 opacity-50 cursor-not-allowed'
                : `border-${node.color}-200 bg-${node.color}-50 hover:shadow-md hover:border-${node.color}-400`
            }`}
          >
            <div className="flex items-center space-x-2">
              <span className="text-2xl">{node.icon}</span>
              <div className="flex-1">
                <div className="text-sm font-medium text-gray-900">{node.label}</div>
                <div className="text-xs text-gray-600">{node.description}</div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-6 p-3 bg-blue-50 border border-blue-200 rounded-lg">
        <div className="flex items-start space-x-2">
          <svg className="h-5 w-5 text-blue-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <div className="text-xs text-blue-700">
            <p className="font-medium mb-1">Tips:</p>
            <ul className="list-disc list-inside space-y-1">
              <li>Drag nodes onto the canvas</li>
              <li>Click a node to edit its properties</li>
              <li>Connect nodes by dragging from one handle to another</li>
              <li>Every script must start with a Start node</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};

export default NodePalette;
