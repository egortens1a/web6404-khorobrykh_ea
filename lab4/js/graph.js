const graphStatus = document.getElementById('model-status');
try {
  const model = ModelConfiguration.fromSearch(location.search);
  const { nodes } = model.analyze();
  const diagram = document.querySelector('[data-model-diagram]');
  const picker = document.getElementById('graph-layer');
  const details = document.getElementById('graph-details');

  ModelView.drawDiagram(diagram, model, { nodes });
  ModelView.updateLinks(model);
  for (const node of nodes) picker.add(new Option(`${node.id} - ${node.title}`, node.id));

  const cards = diagram.querySelectorAll('[data-layer]');
  const edges = diagram.querySelectorAll('[data-source]');

  function selectLayer() {
    const id = picker.value;
    const layer = nodes.find(node => node.id === id);
    const upstream = { [id]: true };
    const downstream = { [id]: true };

    for (let i = nodes.length - 1; i >= 0; i--) {
      if (upstream[nodes[i].id]) {
        for (const input of nodes[i].inputs) upstream[input] = true;
      }
    }
    for (const node of nodes) {
      if (node.inputs.some(input => downstream[input])) downstream[node.id] = true;
    }
    for (const edge of edges) {
      const { source, target } = edge.dataset;
      const related = (upstream[source] && upstream[target]) || (downstream[source] && downstream[target]);
      edge.classList.toggle('model-graph__dimmed', Boolean(layer && !related));
    }
    for (const card of cards) {
      const key = card.dataset.layer;
      card.classList.toggle('model-graph__dimmed', Boolean(layer && !upstream[key] && !downstream[key]));
      card.classList.toggle('model-graph__node--selected', key === id);
    }

    details.hidden = !layer;
    if (!layer) return;
    const consumers = nodes.filter(node => node.inputs.includes(id)).map(node => node.id);
    document.getElementById('graph-inputs').textContent = layer.inputs.join(', ') || '-';
    document.getElementById('graph-consumers').textContent = consumers.join(', ') || '-';
    document.getElementById('graph-shape').textContent = `[${[model.batchSize, ...layer.shape].join(', ')}]`;
    document.getElementById('graph-parameters').textContent = ModelView.format(layer.parameters);
    document.getElementById('graph-role').textContent = id === model.outputId ? 'Выход модели' : layer.active ? 'На пути к выходу' : 'Вне пути к выходу';
  }

  picker.addEventListener('change', selectLayer);
  diagram.addEventListener('click', event => {
    const card = event.target.closest('[data-layer]');
    if (card) {
      picker.value = card.dataset.layer;
      selectLayer();
    }
  });
} catch (error) {
  graphStatus.textContent = error.message;
  document.querySelector('[data-preview]').hidden = true;
}
