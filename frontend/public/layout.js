(function (root) {
  function arrange(project) {
    const nodes = project.nodes.map(node => ({ ...node }));
    const existing = new Set(nodes.map(n => n.id));
    const edges = project.edges.filter(e => existing.has(e.source) && existing.has(e.target));
    const incoming = new Set(edges.map(e => e.target));
    const levels = new Map();
    const walk = start => {
      const queue = [start]; levels.set(start, 0);
      for (let i = 0; i < queue.length; i++) for (const edge of edges.filter(e => e.source === queue[i])) {
        if (!levels.has(edge.target)) { levels.set(edge.target, levels.get(queue[i]) + 1); queue.push(edge.target); }
      }
    };
    for (const n of nodes) if (['start', 'command'].includes(n.type) && !levels.has(n.id)) walk(n.id);
    for (const n of nodes) if (!incoming.has(n.id) && !levels.has(n.id)) walk(n.id);
    for (const n of nodes) if (!levels.has(n.id)) walk(n.id);
    const offsets = new Map();
    for (const n of nodes) {
      const level = levels.get(n.id); n.x = level * 360; n.y = offsets.get(level) || 0;
      const outputs = n.type === 'buttons' ? (n.data.buttons || []).filter(b => b.action === 'transition').length : n.type === 'condition' ? 2 : n.type === 'end' ? 0 : 1;
      offsets.set(level, n.y + 230 + outputs * 42 + 50);
    }
    return { ...project, nodes };
  }
  if (typeof module !== 'undefined') module.exports = { arrange }; else root.BotForgeLayout = { arrange };
})(typeof window !== 'undefined' ? window : globalThis);
