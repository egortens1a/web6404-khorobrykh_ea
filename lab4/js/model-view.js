// Экранируем значения перед вставкой в HTML, в том числе данные из URL.
function escapeHtml(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

const ModelView = {
  format(value) { return value.toLocaleString('ru-RU', { maximumFractionDigits: 6 }).replace(/\s/g, ' '); },
  row(values, inactive = false) {
    let html = `<tr class="${inactive ? 'table__row--inactive' : ''}">`;
    for (const value of values) html += `<td>${escapeHtml(value)}</td>`;
    return html + '</tr>';
  },
  render(model) {
    const result = model.analyze();
    document.querySelector('[data-model-code]').textContent = model.toPython(result);
    const values = { 'Параметры': this.format(result.parameters), 'FLOPs/батч, ~': this.format(result.flops), 'Выход': `[${model.batchSize}, ${result.outputShape.join(', ')}]` };
    let html = '';
    for (const label in values) html += `<div class="stats__item"><span class="stats__value">${values[label]}</span><span class="stats__label">${label}</span></div>`;
    document.querySelector('[data-model-summary]').innerHTML = html;
    html = '';
    for (const node of result.nodes) {
      html += this.row([node.id, node.title, node.inputs.join(', ') || '-', `[${model.batchSize}, ${node.shape.join(', ')}]`, this.format(node.parameters), this.format(model.batchSize * node.flops), node.active ? 'Да' : 'Нет'], !node.active);
    }
    document.querySelector('[data-model-layers]').innerHTML = html;
    html = '';
    const formats = { fp32: 4, fp16: 2, fp8: 1 };
    for (const name in formats) {
      const memory = model.memory(formats[name], result);
      const cells = [name];
      for (const key of ['weights', 'activations', 'buffers', 'total']) cells.push(this.format(memory[key] / 1048576));
      html += this.row(cells);
    }
    document.querySelector('[data-model-memory]').innerHTML = html;
    document.querySelector('[data-model-note]').textContent = `Слоёв в модели: ${model.nodes.length - result.unused} - Не используются: ${result.unused}`;
    this.drawDiagram(document.querySelector('[data-model-diagram]'), model, result);
    this.updateLinks(model);
    return result;
  },

  updateLinks(model) {
    const search = '?' + model.toSearch();
    for (const link of document.querySelectorAll('[data-model-link]')) link.href = link.getAttribute('href').split('?')[0] + search;
  },

  drawDiagram(container, model, result) {
    // глубина задаёт ряд
    // cлои одной глубины ставим рядом
    const cardWidth = 160, cardHeight = 72;
    const columnGap = 36, rowGap = 40, padding = 20;
    const positions = {}, rows = {}, edges = [];
    let maxDepth = 0, maxColumns = 1, skipCount = 0;
    for (const node of result.nodes) {
      let depth = 0;
      for (const id of node.inputs) depth = Math.max(depth, positions[id].depth + 1);
      const column = rows[depth] || 0;
      positions[node.id] = { depth, column };
      rows[depth] = column + 1;
      maxDepth = Math.max(maxDepth, depth);
      maxColumns = Math.max(maxColumns, column + 1);
      for (let i = 0; i < node.inputs.length; i++) {
        const source = node.inputs[i];
        const secondary = i > 0;
        const skip = depth - positions[source].depth > 1 || secondary;
        if (skip) skipCount++;
        edges.push({ source, target: node.id, skip, secondary, active: node.active });
      }
    }
    const columnStep = cardWidth + columnGap;
    const rowStep = cardHeight + rowGap;
    const nodesWidth = maxColumns * columnStep - columnGap;
    const width = 2 * padding + nodesWidth + (skipCount ? 16 + (skipCount - 1) * 14 : 0);
    const height = 2 * padding + maxDepth * rowStep + cardHeight;
    for (const node of result.nodes) {
      const position = positions[node.id];
      const rowOffset = (maxColumns - rows[position.depth]) * columnStep / 2;
      position.x = padding + rowOffset + position.column * columnStep;
      position.y = padding + position.depth * rowStep;
    }
    let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Граф модели со skip-connections"><defs>`;
    for (const type of ['normal', 'skip']) svg += `<marker id="model-arrow-${type}" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path class="model-graph__arrow--${type}" d="M0 0 L7 3.5 L0 7 Z"/></marker>`;
    svg += '</defs>';
    let lane = padding + nodesWidth + 16;
    for (const edge of edges) {
      const from = positions[edge.source], to = positions[edge.target];
      const x1 = from.x + cardWidth / 2 + (edge.skip ? 18 : 0);
      const y1 = from.y + cardHeight;
      const x2 = to.x + cardWidth / 2 + (edge.secondary ? 18 : 0);
      const y2 = to.y - 3;
      // Обходные связи идут справа, а к карточкам подходят между рядами
      const path = edge.skip
        ? `M${x1} ${y1} V${y1 + 12} H${lane} V${y2 - 12} H${x2} V${y2}`
        : `M${x1} ${y1} V${(y1 + y2) / 2} H${x2} V${y2}`;
      if (edge.skip) lane += 14;
      const type = edge.skip ? 'skip' : 'normal';
      svg += `<path class="model-graph__edge model-graph__edge--${type}${edge.active ? '' : ' model-graph__edge--inactive'}" data-source="${edge.source}" data-target="${edge.target}" d="${path}" marker-end="url(#model-arrow-${type})"><title>${edge.source} -> ${edge.target}</title></path>`;
    }
    for (const node of result.nodes) {
      const { x, y } = positions[node.id];
      svg += `<g class="model-graph__node${node.active ? '' : ' model-graph__node--inactive'}${node.id === model.outputId ? ' model-graph__node--output' : ''}" data-layer="${node.id}">
        <rect x="${x}" y="${y}" width="${cardWidth}" height="${cardHeight}" rx="5"/>
        <text x="${x + 10}" y="${y + 17}" class="model-graph__id">${node.id}</text>
        <text x="${x + 10}" y="${y + 39}" class="model-graph__title">${escapeHtml(node.title.split(' -')[0])}</text>
        <text x="${x + 10}" y="${y + 59}" class="model-graph__shape">[${model.batchSize}, ${node.shape.join(', ')}]</text></g>`;
    }
    container.innerHTML = svg + '</svg>';
  },
};
