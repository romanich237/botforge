(function (root) {
  function createHistory(limit = 100) {
    let past = [], future = [], current = null, projectId = null;
    const snapshot = project => JSON.stringify({ nodes: project.nodes, edges: project.edges, variables: project.variables, behavior: project.behavior, description: project.description });
    function reset(project) { projectId = project?.id; past = []; future = []; current = project ? snapshot(project) : null; }
    function record(project) {
      if (!project || project.id !== projectId) { reset(project); return false; }
      const next = snapshot(project);
      if (next === current) return false;
      past.push(current); if (past.length > limit) past.shift();
      current = next; future = []; return true;
    }
    function travel(project, direction) {
      if (!project || project.id !== projectId) return false;
      const from = direction === 'undo' ? past : future, to = direction === 'undo' ? future : past;
      if (!from.length) return false;
      to.push(current); current = from.pop();
      Object.assign(project, JSON.parse(current)); return true;
    }
    return { reset, record, undo: project => travel(project, 'undo'), redo: project => travel(project, 'redo'), canUndo: () => past.length > 0, canRedo: () => future.length > 0 };
  }
  if (typeof module !== 'undefined') module.exports = { createHistory };
  else root.BotForgeHistory = { createHistory };
})(typeof window !== 'undefined' ? window : globalThis);
