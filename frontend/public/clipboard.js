/* Clipboard operations for the visual scenario editor. */
(() => {
  let clipboard = null;
  let pasteCount = 0;
  const clone = value => structuredClone(value);
  function selection(project, nodeIds) {
    const ids = new Set(nodeIds);
    const nodes = project.nodes.filter(node => ids.has(node.id) && node.type !== 'start').map(clone);
    const included = new Set(nodes.map(node => node.id));
    const edges = project.edges.filter(edge => included.has(edge.source) && included.has(edge.target)).map(clone);
    return { nodes, edges };
  }
  function copy(project, nodeIds) {
    const selected = selection(project, nodeIds);
    if (!selected.nodes.length) return 0;
    clipboard = selected;
    pasteCount = 0;
    return selected.nodes.length;
  }
  function paste(project) {
    if (!clipboard?.nodes.length) return null;
    if (project.nodes.length + clipboard.nodes.length > 500 || project.edges.length + clipboard.edges.length > 2000) return { error: 'Превышен лимит блоков или связей проекта.' };
    const offset = 40 * (++pasteCount);
    const ids = new Map();
    const nodes = clipboard.nodes.map(original => {
      const node = clone(original);
      node.id = crypto.randomUUID(); ids.set(original.id, node.id);
      node.x += offset; node.y += offset;
      if (node.type === 'command' && typeof node.data.command === 'string') {
        const used = new Set([...project.nodes, ...nodes].filter(n => n.type === 'command').map(n => n.data.command));
        const base = node.data.command.replace(/_[0-9]+$/, '').slice(0, 26);
        let index = 1, command = base + '_' + index;
        while (used.has(command)) command = base + '_' + (++index);
        node.data.command = command;
      }
      if (node.type === 'buttons' && Array.isArray(node.data.buttons)) {
        const buttonIds = new Map();
        node.data.buttons.forEach(button => { const next = crypto.randomUUID(); buttonIds.set(button.id, next); button.id = next; });
        node.__buttonIds = buttonIds;
      }
      return node;
    });
    const edges = clipboard.edges.map(edge => {
      const source = nodes.find(node => node.id === ids.get(edge.source));
      return { ...edge, id: crypto.randomUUID(), source: ids.get(edge.source), target: ids.get(edge.target), output: source?.__buttonIds?.get(edge.output) || edge.output };
    });
    nodes.forEach(node => { delete node.__buttonIds; });
    project.nodes.push(...nodes); project.edges.push(...edges);
    return { ids: nodes.map(node => node.id), edges: edges.map(edge => edge.id) };
  }
  window.BotForgeClipboard = { copy, paste, hasContent: () => !!clipboard?.nodes.length };
})();
