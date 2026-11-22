const modelForm = document.getElementById('model-form');
const layerList = document.getElementById('layer-list');
const outputSelect = document.getElementById('output-id');
const status = document.getElementById('model-status');
const inputShape = document.getElementById('input-shape');
const batchSize = document.getElementById('batch-size');
const learningRate = document.getElementById('learning-rate');
let draft;
try { draft = ModelConfiguration.fromSearch(location.search); }
catch (error) { draft = new ModelConfiguration(); status.textContent = error.message; }

// Для каждого типа перечислены только его собственные настройки.
const fields = {
  linear: [['outFeatures', 'Признаки', 'number'], ['bias', 'Bias', 'checkbox']],
  conv2d: [['outChannels', 'Каналы', 'number'], ['kernel', 'Kernel', 'number'], ['stride', 'Stride', 'number'], ['padding', 'Padding', 'number'], ['bias', 'Bias', 'checkbox']],
  maxpool2d: [['kernel', 'Kernel', 'number'], ['stride', 'Stride', 'number'], ['padding', 'Padding', 'number']],
  avgpool2d: [['kernel', 'Kernel', 'number'], ['stride', 'Stride', 'number'], ['padding', 'Padding', 'number']],
  activation: [['activation', 'Активация', 'select']],
  dropout: [['probability', 'Вероятность', 'number']],
};
function option(value, text, selected) {
  return `<option value="${escapeHtml(value)}"${value === selected ? ' selected' : ''}>${escapeHtml(text)}</option>`;
}
function hint(node) {
  if (node.type === 'linear') return `${node.outFeatures} признаков`;
  if (node.type === 'conv2d') return `${node.outChannels} каналов - ${node.kernel}x${node.kernel}`;
  if (node.kernel) return `${node.kernel}x${node.kernel}`;
  if (node.type === 'dropout') return `p=${node.probability}`;
  return node.activation || node.inputs.join(', ');
}
function renderCards(openId) {
  const opened = layerList.querySelector('[open]');
  if (openId === undefined) openId = opened ? opened.dataset.nodeId : 'layer_1';
  let html = '', outputs = option('input', 'Input - без слоёв', draft.outputId);
  const earlier = [{ id: 'input', title: 'Input' }];
  for (const node of draft.nodes) {
    const title = ModelConfiguration.blocks[node.type].title;
    html += `<details class="layer-card" name="layer-settings" id="${node.id}" data-node-id="${node.id}"${node.id === openId ? ' open' : ''}>
      <summary><span class="layer-card__id">${node.id}</span><strong>${title.split(' -')[0]}</strong><span class="layer-card__hint">${escapeHtml(hint(node))}</span></summary><div class="layer-card__fields">`;
    for (let i = 0; i < node.inputs.length; i++) {
      html += `<label>Вход${node.inputs.length > 1 ? ' ' + (i + 1) : ''}<select id="${node.id}-input-${i}" data-input-index="${i}">`;
      for (const source of earlier) html += option(source.id, source.title, node.inputs[i]);
      html += '</select></label>';
    }
    for (const [key, label, type] of fields[node.type] || []) {
      const attributes = `id="${node.id}-${key}" data-field="${key}"`;
      html += `<label class="${type === 'checkbox' ? 'model-form__checkbox' : ''}">${label}`;
      if (type === 'select') {
        html += `<select ${attributes}>`;
        for (const name of ['relu', 'gelu', 'tanh']) html += option(name, name, node[key]);
        html += '</select>';
      } else if (type === 'checkbox') html += `<input type="checkbox" ${attributes}${node[key] ? ' checked' : ''}>`;
      else html += `<input type="number" ${attributes} value="${escapeHtml(node[key])}" min="${key === 'padding' || key === 'probability' ? 0 : 1}" max="${key === 'probability' ? 1 : 1000000}" step="${key === 'probability' ? 'any' : 1}" required>`;
      html += '</label>';
    }
    html += `</div><button class="button button--secondary layer-card__remove" type="button" data-remove="${node.id}">Удалить слой</button></details>`;
    earlier.push({ id: node.id, title: `${node.id} - ${title}` });
    outputs += option(node.id, `${node.id} - ${title}`, draft.outputId);
  }
  layerList.innerHTML = html;
  outputSelect.innerHTML = outputs;
  document.getElementById('layer-count').textContent = draft.nodes.length;
}
function readConfiguration() {
  return new ModelConfiguration({ inputShape: inputShape.value, batchSize: batchSize.value,
    learningRate: learningRate.value, nodes: draft.nodes, outputId: outputSelect.value });
}
function refresh() {
  let errorText = '';
  try {
    const model = readConfiguration();
    ModelView.render(model);
    document.getElementById('serialized-config').value = JSON.stringify(model);
  } catch (error) { errorText = error.message; }
  status.textContent = errorText;
  modelForm.querySelector('[type="submit"]').disabled = Boolean(errorText);
  document.querySelector('[data-preview]').hidden = Boolean(errorText);
  
  // при ошибке раскрываем соответствующий слой
  const id = errorText.match(/^layer_\d+/);
  if (id && document.getElementById(id[0])) document.getElementById(id[0]).open = true;
}
function fillForm() {
  inputShape.value = draft.inputShape.join(', ');
  batchSize.value = draft.batchSize;
  learningRate.value = draft.learningRate;
  renderCards();
  refresh();
}
let options = '';
for (const type in ModelConfiguration.blocks) options += option(type, ModelConfiguration.blocks[type].title);
document.getElementById('new-layer-type').innerHTML = options;

modelForm.addEventListener('input', event => {
  if (event.target === outputSelect) draft.outputId = outputSelect.value;
  const card = event.target.closest('[data-node-id]');
  if (card) {
    const node = draft.nodes.find(item => item.id === card.dataset.nodeId);
    const key = event.target.dataset.field;
    if (key) node[key] = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
    else node.inputs[Number(event.target.dataset.inputIndex)] = event.target.value;
    card.querySelector('.layer-card__hint').textContent = hint(node);
  }
  refresh();
});
document.getElementById('add-layer').addEventListener('click', () => {
  if (draft.nodes.length >= 64) { status.textContent = 'Максимум 64 слоя.'; return; }
  const type = document.getElementById('new-layer-type').value;
  let nextId = 1, source = 'input';
  for (const node of draft.nodes) { nextId = Math.max(nextId, Number(node.id.slice(6)) + 1); source = node.id; }
  const node = { id: `layer_${nextId}`, type, inputs: type === 'add' || type === 'concat' ? [source, 'input'] : [source], ...ModelConfiguration.blocks[type].defaults };
  draft.nodes.push(node);
  draft.outputId = node.id;
  renderCards(node.id);
  refresh();
});
layerList.addEventListener('click', event => {
  const button = event.target.closest('[data-remove]');
  if (!button) return;
  const removed = draft.nodes.find(node => node.id === button.dataset.remove);
  const replacement = removed.inputs[0];
  draft.nodes = draft.nodes.filter(node => node.id !== removed.id);
  for (const node of draft.nodes) node.inputs = node.inputs.map(id => id === removed.id ? replacement : id);
  if (draft.outputId === removed.id) draft.outputId = replacement;
  renderCards(replacement);
  refresh();
});
for (const button of document.querySelectorAll('[data-example]')) button.addEventListener('click', () => {
  draft = new ModelConfiguration(ModelConfiguration.example(button.dataset.example));
  fillForm();
});
modelForm.addEventListener('submit', event => {
  try {
    const model = readConfiguration();
    model.printToConsole();
    document.getElementById('serialized-config').value = JSON.stringify(model);
  } catch (error) { event.preventDefault(); status.textContent = error.message; }
});
const initialError = status.textContent;
fillForm();
if (initialError) status.textContent = `${initialError} Показан пример MLP.`;
