const { isDeepStrictEqual } = require('node:util');
const { arrange } = require('./public/layout');
const fail = message => { throw Object.assign(Error(message), { status: 502 }); };
function removals(values, existing, label) {
  if (values === undefined) return new Set();
  if (!Array.isArray(values) || values.some(id => typeof id !== 'string' || !existing.has(id))) fail('ИИ указал неизвестные элементы для удаления: ' + label);
  return new Set(values);
}
function changes(before, after) {
  const compare = (oldItems, newItems, key, content = value => value) => {
    const old = new Map(oldItems.map(item => [item[key], item])), next = new Map(newItems.map(item => [item[key], item]));
    return { added: [...next.keys()].filter(id => !old.has(id)), updated: [...next.keys()].filter(id => old.has(id) && !isDeepStrictEqual(content(old.get(id)), content(next.get(id)))), removed: [...old.keys()].filter(id => !next.has(id)) };
  };
  return { nodes: compare(before.nodes, after.nodes, 'id', n => ({ type: n.type, data: n.data })), edges: compare(before.edges, after.edges, 'id', e => ({ source: e.source, output: e.output, target: e.target })), variables: compare(before.variables, after.variables, 'name') };
}
function mergeProposal(project, patch, mode, id) {
  for (const [items, key] of [[patch.nodes, n => n?.id], [patch.variables, v => v?.name], [patch.edges, e => JSON.stringify([e?.source, e?.output])]]) if (new Set(items.map(key)).size !== items.length) fail('ИИ вернул повторяющиеся блоки, переменные или выходы.');
  if (mode === 'create') return { ...project, nodes: patch.nodes.map(n => ({ id: n?.id, type: n?.type, data: n?.data, x: 0, y: 0 })), edges: patch.edges.map(e => ({ id: id(), source: e?.source, output: e?.output, target: e?.target })), variables: patch.variables };
  const oldNodes = new Map(project.nodes.map(n => [n.id, n]));
  const removedNodes = removals(patch.removeNodeIds, new Set(oldNodes.keys()), 'блоки');
  const removedEdges = removals(patch.removeEdgeIds, new Set(project.edges.map(e => e.id)), 'связи');
  const removedVariables = removals(patch.removeVariableNames, new Set(project.variables.map(v => v.name)), 'переменные');
  const nodes = new Map(project.nodes.filter(n => !removedNodes.has(n.id)).map(n => [n.id, n]));
  for (const n of patch.nodes) {
    if (!n || typeof n.id !== 'string' || removedNodes.has(n.id)) fail('ИИ одновременно изменяет и удаляет один блок.');
    const old = oldNodes.get(n.id); nodes.set(n.id, { id: n.id, type: n.type, data: n.data, x: old?.x ?? 0, y: old?.y ?? 0 });
  }
  const variables = new Map(project.variables.filter(v => !removedVariables.has(v.name)).map(v => [v.name, v]));
  for (const v of patch.variables) { if (!v || typeof v.name !== 'string' || removedVariables.has(v.name)) fail('ИИ одновременно изменяет и удаляет переменную.'); variables.set(v.name, v); }
  const edges = new Map(project.edges.filter(e => !removedEdges.has(e.id) && !removedNodes.has(e.source) && !removedNodes.has(e.target)).map(e => [JSON.stringify([e.source, e.output]), e]));
  for (const e of patch.edges) {
    if (!e) fail('ИИ вернул некорректную связь.');
    const port = JSON.stringify([e.source, e.output]); const old = edges.get(port);
    edges.set(port, { id: old?.id || id(), source: e.source, output: e.output, target: e.target });
  }
  return { ...project, nodes: [...nodes.values()], edges: [...edges.values()], variables: [...variables.values()] };
}
function positionProposal(project, proposal, mode) {
  const positioned = arrange(proposal);
  if (mode === 'create') return positioned;
  const old = new Map(project.nodes.map(n => [n.id, n]));
  const height = n => 230 + 42 * (n.type === 'buttons' ? (n.data.buttons || []).filter(b => b.action === 'transition').length : n.type === 'condition' ? 2 : 1);
  const placed = positioned.nodes.filter(n => old.has(n.id)).map(n => ({ ...n, x: old.get(n.id).x, y: old.get(n.id).y }));
  const fresh = new Map();
  for (const node of positioned.nodes.filter(n => !old.has(n.id))) {
    let collisions;
    while ((collisions = placed.filter(n => node.x < n.x + 280 && node.x + 280 > n.x && node.y < n.y + height(n) + 30 && node.y + height(node) + 30 > n.y)).length) node.y = Math.max(...collisions.map(n => n.y + height(n) + 50));
    placed.push(node); fresh.set(node.id, node);
  }
  return { ...positioned, nodes: positioned.nodes.map(n => old.has(n.id) ? { ...n, x: old.get(n.id).x, y: old.get(n.id).y } : fresh.get(n.id)) };
}
module.exports = { mergeProposal, positionProposal, changes };
