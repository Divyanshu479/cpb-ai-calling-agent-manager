import { useCallback, useState, useRef } from 'react';
import ReactFlow, {
  MiniMap,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  addEdge,
  BackgroundVariant,
} from 'reactflow';
import 'reactflow/dist/style.css';

import StartNode from './nodes/StartNode';
import SayNode from './nodes/SayNode';
import ListenNode from './nodes/ListenNode';
import QuestionNode from './nodes/QuestionNode';
import ConditionNode from './nodes/ConditionNode';
import KnowledgeLookupNode from './nodes/KnowledgeLookupNode';
import TagNode from './nodes/TagNode';
import EndCallNode from './nodes/EndCallNode';
import NodePalette from './NodePalette';
import NodeEditor from './NodeEditor';

const nodeTypes = {
  start: StartNode,
  say: SayNode,
  listen: ListenNode,
  question: QuestionNode,
  condition: ConditionNode,
  knowledgeLookup: KnowledgeLookupNode,
  tag: TagNode,
  endCall: EndCallNode,
};

const initialNodes = [
  {
    id: '1',
    type: 'start',
    position: { x: 250, y: 50 },
    data: {},
  },
];

const ScriptCanvas = ({ initialScript, onSave }) => {
  const reactFlowWrapper = useRef(null);
  const [nodes, setNodes, onNodesChange] = useNodesState(initialScript?.nodes || initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialScript?.edges || []);
  const [selectedNode, setSelectedNode] = useState(null);
  const [reactFlowInstance, setReactFlowInstance] = useState(null);
  const nodeIdCounter = useRef(initialScript?.nodes?.length || 1);

  const onConnect = useCallback(
    (params) => setEdges((eds) => addEdge({ ...params, animated: true }, eds)),
    [setEdges]
  );

  const onDragOver = useCallback((event) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (event) => {
      event.preventDefault();

      const type = event.dataTransfer.getData('application/reactflow');

      if (typeof type === 'undefined' || !type) {
        return;
      }

      const position = reactFlowInstance.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      nodeIdCounter.current += 1;

      const newNode = {
        id: `${nodeIdCounter.current}`,
        type,
        position,
        data: {},
      };

      setNodes((nds) => nds.concat(newNode));
    },
    [reactFlowInstance, setNodes]
  );

  const onNodeClick = useCallback((event, node) => {
    setSelectedNode(node);
  }, []);

  const onPaneClick = useCallback(() => {
    setSelectedNode(null);
  }, []);

  const handleNodeUpdate = useCallback(
    (nodeId, newData) => {
      setNodes((nds) =>
        nds.map((node) => {
          if (node.id === nodeId) {
            return { ...node, data: newData };
          }
          return node;
        })
      );
    },
    [setNodes]
  );

  const handleNodeDelete = useCallback(
    (nodeId) => {
      setNodes((nds) => nds.filter((node) => node.id !== nodeId));
      setEdges((eds) => eds.filter((edge) => edge.source !== nodeId && edge.target !== nodeId));
      setSelectedNode(null);
    },
    [setNodes, setEdges]
  );

  const handleSave = () => {
    const script = {
      nodes: nodes.map((node) => ({
        id: node.id,
        type: node.type,
        position: node.position,
        data: node.data,
      })),
      edges: edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        sourceHandle: edge.sourceHandle,
        targetHandle: edge.targetHandle,
      })),
    };
    onSave(script);
  };

  const handleClear = () => {
    if (window.confirm('Are you sure you want to clear the entire script?')) {
      setNodes(initialNodes);
      setEdges([]);
      setSelectedNode(null);
      nodeIdCounter.current = 1;
    }
  };

  return (
    <div className="flex h-full">
      <NodePalette onAddNode={() => {}} />

      <div className="flex-1 flex flex-col">
        {/* Toolbar */}
        <div className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Script Builder</h2>
            <p className="text-sm text-gray-500">
              {nodes.length} nodes, {edges.length} connections
            </p>
          </div>
          <div className="flex space-x-3">
            <button
              onClick={handleClear}
              className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Clear All
            </button>
            <button
              onClick={handleSave}
              className="px-4 py-2 bg-primary-600 text-white rounded-md text-sm font-medium hover:bg-primary-700"
            >
              Save Script
            </button>
          </div>
        </div>

        {/* Canvas */}
        <div className="flex-1" ref={reactFlowWrapper}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onInit={setReactFlowInstance}
            onDrop={onDrop}
            onDragOver={onDragOver}
            onNodeClick={onNodeClick}
            onPaneClick={onPaneClick}
            nodeTypes={nodeTypes}
            fitView
            attributionPosition="bottom-left"
          >
            <Background variant={BackgroundVariant.Dots} gap={12} size={1} />
            <Controls />
            <MiniMap
              nodeColor={(node) => {
                const colors = {
                  start: '#10b981',
                  say: '#3b82f6',
                  listen: '#8b5cf6',
                  question: '#6366f1',
                  condition: '#eab308',
                  knowledgeLookup: '#14b8a6',
                  tag: '#f97316',
                  endCall: '#ef4444',
                };
                return colors[node.type] || '#6b7280';
              }}
              className="!bg-gray-50"
            />
          </ReactFlow>
        </div>
      </div>

      <NodeEditor
        selectedNode={selectedNode}
        onUpdate={handleNodeUpdate}
        onClose={() => setSelectedNode(null)}
        onDelete={handleNodeDelete}
      />
    </div>
  );
};

export default ScriptCanvas;
