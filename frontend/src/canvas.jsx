import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { ReactFlow, Background, Controls, MiniMap, Handle, Position, applyNodeChanges, applyEdgeChanges, MarkerType, useReactFlow, useNodesInitialized } from '@xyflow/react';
import '@xyflow/react/dist/style.css';

const icons = { start: '▶', command: '/', text: 'T', buttons: '▦', input: '↵', condition: '◇', end: '■' };
function ScenarioNode({ data, selected }) {
  return <div className={'scenario-node type-' + data.type + (selected ? ' is-selected' : '') + (data.active ? ' is-active' : '')}>
    <Handle type="target" position={Position.Left} aria-label={'Вход · ' + data.title} />
    <div className="scenario-node-title"><span className="block-symbol">{icons[data.type]}</span><strong>{data.title}</strong><span className="node-menu">···</span></div>
    <div className="scenario-node-body">{data.text || (data.type === 'start' ? 'Запуск по /start' : data.type === 'end' ? 'Конец ветки' : 'Нажмите, чтобы настроить')}</div>
    {data.outputs.map(([id, label]) => <div className="scenario-output" key={id}><span>{label}</span><Handle id={id} type="source" position={Position.Right} aria-label={'Выход · ' + label} /></div>)}
  </div>;
}
function FocusNode({ id }) {
  const ready = useNodesInitialized();
  const { fitView } = useReactFlow();
  useEffect(() => {
    if (ready && id) fitView({ nodes: [{ id }], padding: 0.8, maxZoom: 1.2, duration: 250 });
  }, [ready, id, fitView]);
  return null;
}
const nodeTypes = { scenario: ScenarioNode };
window.BotForgeCanvas = {
  mount(container, project, names, outputs, callbacks, viewport) {
    const root = createRoot(container);
    let refresh = () => {};
    function Canvas() {
      const [flow, setFlow] = useState(null);
      const [nodes, setNodes] = useState(project.nodes.map(n => ({ id: n.id, type: 'scenario', position: { x: n.x, y: n.y }, selected: n.id === callbacks.selected, data: { title: names[n.type], active: callbacks.current?.() === n.id, type: n.type, text: n.data.text || n.data.command, outputs: outputs(n) } })));
      const [edges, setEdges] = useState(project.edges.map(e => ({ id: e.id, source: e.source, target: e.target, sourceHandle: e.output, type: 'smoothstep', markerEnd: { type: MarkerType.ArrowClosed }, style: { strokeWidth: 2 } })));
      refresh = () => {
        setNodes(current => current.map(node => { const n = project.nodes.find(n => n.id === node.id); return n ? { ...node, data: { title: names[n.type], active: callbacks.current?.() === n.id, type: n.type, text: n.data.text || n.data.command, outputs: outputs(n) } } : node; }));
        setEdges(project.edges.map(e => ({ id: e.id, source: e.source, target: e.target, sourceHandle: e.output, type: 'smoothstep', markerEnd: { type: MarkerType.ArrowClosed } })));
      };
      return <ReactFlow onInit={setFlow} onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; }} onDrop={event => { event.preventDefault(); const type = event.dataTransfer.getData('application/botforge-block'); if (flow && type) callbacks.drop(type, flow.screenToFlowPosition({ x: event.clientX, y: event.clientY })); }} nodes={nodes} edges={edges} nodeTypes={nodeTypes}
        defaultViewport={viewport || { x: 70, y: 90, zoom: 1 }} fitView={!callbacks.focus && !viewport && project.nodes.length > 0} fitViewOptions={{ padding: 0.25, maxZoom: 1 }}
        minZoom={0.2} maxZoom={2} snapToGrid snapGrid={[16, 16]}
        onNodesChange={changes => { setNodes(current => applyNodeChanges(changes, current)); callbacks.move(changes); }}
        onEdgesChange={changes => { setEdges(current => applyEdgeChanges(changes, current)); callbacks.edges(changes); }}
        onConnect={connection => callbacks.connect(connection)}
        edgesReconnectable reconnectRadius={18}
        onReconnect={(edge, connection) => callbacks.reconnect(edge, connection)}
        onNodeClick={(_, node) => callbacks.select(node.id)}
        onPaneClick={() => callbacks.select(null)}
        onMoveEnd={(_, next) => callbacks.viewport(next)}
        deleteKeyCode={null} selectionKeyCode="Shift" panOnScroll zoomOnScroll={false} zoomOnPinch
        proOptions={{ hideAttribution: true }}
        ariaLabelConfig={{ 'controls.zoomIn.ariaLabel': 'Приблизить', 'controls.zoomOut.ariaLabel': 'Отдалить', 'controls.fitView.ariaLabel': 'Показать всю схему', 'controls.interactive.ariaLabel': 'Переключить перемещение блоков' }}>
        <FocusNode id={callbacks.focus}/>
        <Background color="#d6dce9" gap={20} size={1.2}/>
        <Controls showInteractive={false}/>
        <MiniMap pannable zoomable nodeColor={node => node.data.type === 'start' ? '#56b897' : '#a9bdf9'} maskColor="#f2f5fa99"/>
      </ReactFlow>;
    }
    root.render(<Canvas/>);
    const dispose = () => root.unmount();
    dispose.refresh = () => refresh();
    return dispose;
  }
};
