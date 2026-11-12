(function (root) {
  function outputs(node) {
    if (node.type === 'end') return [];
    if (node.type === 'condition') return ['yes', 'no'];
    if (node.type === 'buttons') return node.data.buttons.filter(b => b.action === 'transition').map(b => b.id);
    return ['next'];
  }

  function moveButton(node, id, offset) {
    const buttons = node.data.buttons;
    const from = buttons.findIndex(b => b.id === id);
    const to = from + offset;
    if (from < 0 || ![-1, 1].includes(offset) || to < 0 || to >= buttons.length) return false;
    [buttons[from], buttons[to]] = [buttons[to], buttons[from]];
    return true;
  }

  function reconnect(project, edgeId, connection) {
    const edge = project.edges.find(e => e.id === edgeId);
    const source = project.nodes.find(n => n.id === connection.source);
    const target = project.nodes.find(n => n.id === connection.target);
    if (!edge || !source || !target || !outputs(source).includes(connection.sourceHandle)) return false;
    if (project.edges.some(e => e.id !== edgeId && e.source === source.id && e.output === connection.sourceHandle)) return false;
    Object.assign(edge, { source: source.id, output: connection.sourceHandle, target: target.id });
    return true;
  }

  function searchNodes(project, query, names) {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return [];
    return project.nodes.filter(n => [n.id, n.type, names[n.type], n.data.text, n.data.command, n.data.description,
      ...(n.data.buttons || []).map(b => b.label)].some(value => String(value || '').toLocaleLowerCase().includes(needle)));
  }

  const api = { moveButton, reconnect, searchNodes };
  if (typeof module !== 'undefined') module.exports = api;
  else root.BotForgeEditor = api;
})(typeof window !== 'undefined' ? window : globalThis);
