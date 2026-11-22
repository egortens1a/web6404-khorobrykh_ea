class ModelConfiguration {
  static blocks = {
    linear: { title: 'Linear', defaults: { outFeatures: 128, bias: true } },
    conv2d: { title: 'Conv2d', defaults: { outChannels: 16, kernel: 3, stride: 1, padding: 1, bias: true } },
    maxpool2d: { title: 'MaxPool2d', defaults: { kernel: 2, stride: 2, padding: 0 } },
    avgpool2d: { title: 'AvgPool2d', defaults: { kernel: 2, stride: 2, padding: 0 } },
    flatten: { title: 'Flatten', defaults: {} },
    activation: { title: 'Активация', defaults: { activation: 'relu' } },
    batchnorm: { title: 'BatchNorm', defaults: {} },
    dropout: { title: 'Dropout', defaults: { probability: 0.2 } },
    add: { title: '+ Add - сложение', defaults: {} },
    concat: { title: '| Concat - объединение', defaults: {} },
  };

  static integer(value, title, min = 1, max = 1000000) {
    const number = Number(value);
    if (String(value).trim() === '' || !Number.isSafeInteger(number) || number < min || number > max) {
      throw new Error(`${title}: ожидается целое число от ${min} до ${max}.`);
    }
    return number;
  }

  static parseShape(value) {
    if (Array.isArray(value)) {
      if (![1, 3].includes(value.length)) throw new Error('Вход: вектор F или изображение C, H, W.');
      return value.map(size => this.integer(size, 'Размер входа'));
    }
    const text = String(value).trim();
    if (!/^\d+(?:\s*[,x\xD7]\s*\d+)*$/.test(text)) {
      throw new Error('Введите размер вектора, например 784, или C, H, W, например 3, 32, 32.');
    }
    return this.parseShape(text.split(/\s*[,x\xD7]\s*/));
  }

  static example(kind = 'mlp') {
    const node = (index, type, inputs, settings = {}) => ({
      id: `layer_${index}`, type, inputs,
      ...this.blocks[type].defaults, ...settings,
    });
    return kind === 'cnn' ? {
      inputShape: [3, 32, 32], batchSize: 64, learningRate: 0.001, outputId: 'layer_9',
      nodes: [
        node(1, 'conv2d', ['input']),
        node(2, 'activation', ['layer_1']),
        node(3, 'conv2d', ['layer_2']),
        node(4, 'add', ['layer_3', 'layer_2']),
        node(5, 'activation', ['layer_4']),
        node(6, 'maxpool2d', ['layer_5']),
        node(7, 'flatten', ['layer_6']),
        node(8, 'linear', ['layer_7']),
        node(9, 'linear', ['layer_8'], { outFeatures: 10 }),
      ],
    } : {
      inputShape: [784], batchSize: 64, learningRate: 0.001, outputId: 'layer_4',
      nodes: [
        node(1, 'linear', ['input']),
        node(2, 'activation', ['layer_1']),
        node(3, 'dropout', ['layer_2']),
        node(4, 'linear', ['layer_3'], { outFeatures: 10 }),
      ],
    };
  }

  constructor(data = ModelConfiguration.example()) {
    this.inputShape = ModelConfiguration.parseShape(data.inputShape);
    this.batchSize = ModelConfiguration.integer(data.batchSize, 'Размер батча', 1, 65536);
    this.learningRate = Number(data.learningRate);
    if (!Number.isFinite(this.learningRate) || this.learningRate <= 0 || this.learningRate > 1) {
      throw new Error('Learning rate: введите число больше 0 и не больше 1.');
    }
    if (!Array.isArray(data.nodes) || data.nodes.length > 64) throw new Error('Допустимо от 0 до 64 слоёв.');
    this.nodes = data.nodes.map(node => ({ ...node, inputs: [...(node.inputs || [])] }));
    this.outputId = data.outputId;
  }

  analyze() {
    function product(shape) {
      let total = 1;
      for (const size of shape) total *= size;
      return total;
    }
    const input = { id: 'input', type: 'input', title: 'Input', shape: this.inputShape, inputs: [], parameters: 0, flops: 0, buffers: 0 };
    const nodes = [input];
    const byId = { input };
    for (const node of this.nodes) {
      const definition = ModelConfiguration.blocks[node.type];
      if (!/^layer_[1-9]\d*$/.test(node.id) || byId[node.id]) throw new Error('Некорректный или повторяющийся идентификатор слоя.');
      if (!Object.hasOwn(ModelConfiguration.blocks, node.type)) throw new Error(`${node.id}: неизвестный тип слоя.`);
      const merged = ['add', 'concat'].includes(node.type);
      if (node.inputs.length !== (merged ? 2 : 1)) throw new Error(`${node.id}: выберите ${merged ? 'два входа' : 'вход'}.`);
      if (node.inputs.some(id => !Object.hasOwn(byId, id))) throw new Error(`${node.id}: вход должен ссылаться на предыдущий слой или Input.`);
      if (merged && node.inputs[0] === node.inputs[1]) throw new Error(`${node.id}: выберите два разных входа.`);
      const sources = node.inputs.map(id => byId[id]);
      const shape = [...sources[0].shape];
      const size = product(shape);
      const descriptor = { ...node, title: definition.title, shape, parameters: 0, flops: 0, buffers: 0 };
      const integer = (key, title, min = 1) => ModelConfiguration.integer(node[key], `${node.id}, ${title}`, min);
      const spatial = () => {
        if (shape.length !== 3) throw new Error(`${node.id}: ${definition.title} ожидает [C, H, W].`);
        const kernel = integer('kernel', 'kernel');
        const stride = integer('stride', 'stride');
        const padding = integer('padding', 'padding', 0);
        const height = Math.floor((shape[1] + 2 * padding - kernel) / stride) + 1;
        const width = Math.floor((shape[2] + 2 * padding - kernel) / stride) + 1;
        if (height <= 0 || width <= 0) throw new Error(`${node.id}: ядро не помещается во вход. Измените kernel/padding.`);
        return { kernel, stride, padding, height, width };
      };
      switch (node.type) {
        case 'linear': {
          if (shape.length !== 1) throw new Error(`${node.id}: перед Linear для изображения добавьте Flatten.`);
          const output = integer('outFeatures', 'out_features');
          descriptor.shape = [output];
          descriptor.parameters = shape[0] * output + (node.bias ? output : 0);
          descriptor.flops = 2 * shape[0] * output + (node.bias ? output : 0);
          descriptor.module = `nn.Linear(${shape[0]}, ${output}, bias=${node.bias ? 'True' : 'False'})`;
          break;
        }
        case 'conv2d': {
          const { kernel, stride, padding, height, width } = spatial();
          const channels = integer('outChannels', 'out_channels');
          descriptor.shape = [channels, height, width];
          descriptor.parameters = channels * (shape[0] * kernel * kernel + (node.bias ? 1 : 0));
          descriptor.flops = height * width * channels * (2 * shape[0] * kernel * kernel + (node.bias ? 1 : 0));
          descriptor.module = `nn.Conv2d(${shape[0]}, ${channels}, kernel_size=${kernel}, stride=${stride}, padding=${padding}, bias=${node.bias ? 'True' : 'False'})`;
          break;
        }
        case 'maxpool2d':
        case 'avgpool2d': {
          const { kernel, stride, padding, height, width } = spatial();
          if (padding > Math.floor(kernel / 2)) throw new Error(`${node.id}: padding Pooling не должен превышать половину kernel.`);
          descriptor.shape = [shape[0], height, width];
          descriptor.flops = node.type === 'avgpool2d' ? product(descriptor.shape) * kernel * kernel : 0;
          descriptor.module = `nn.${node.type === 'maxpool2d' ? 'MaxPool2d' : 'AvgPool2d'}(kernel_size=${kernel}, stride=${stride}, padding=${padding})`;
          break;
        }
        case 'flatten':
          descriptor.shape = [size];
          descriptor.module = 'nn.Flatten(start_dim=1)';
          break;
        case 'activation': {
          const names = { relu: 'ReLU', gelu: 'GELU', tanh: 'Tanh' };
          if (!Object.hasOwn(names, node.activation)) throw new Error(`${node.id}: неизвестная активация.`);
          descriptor.title = names[node.activation];
          descriptor.module = `nn.${descriptor.title}()`;
          break;
        }
        case 'batchnorm':
          descriptor.parameters = 2 * shape[0];
          descriptor.buffers = 2 * shape[0] * 4 + 8;
          descriptor.flops = 4 * size;
          descriptor.module = `nn.BatchNorm${shape.length === 3 ? '2' : '1'}d(${shape[0]})`;
          break;
        case 'dropout': {
          const probability = Number(node.probability);
          if (String(node.probability).trim() === '' || !Number.isFinite(probability) || probability < 0 || probability > 1) throw new Error(`${node.id}: dropout должен быть от 0 до 1.`);
          descriptor.module = `nn.Dropout(p=${probability})`;
          break;
        }
        case 'add':
          if (shape.join(',') !== sources[1].shape.join(',')) {
            throw new Error(`${node.id}: Add требует одинаковые размеры: [${shape}] и [${sources[1].shape}]. Используйте Conv2d 1x1 / Linear для проекции или Concat.`);
          }
          descriptor.flops = size;
          break;
        case 'concat':
          if (shape.length !== sources[1].shape.length || shape.slice(1).join(',') !== sources[1].shape.slice(1).join(',')) {
            throw new Error(`${node.id}: Concat требует одинаковые пространственные размеры и ранг входов.`);
          }
          descriptor.shape[0] += sources[1].shape[0];
          break;
      }
      if (![descriptor.parameters, descriptor.flops, product(descriptor.shape)].every(Number.isSafeInteger)) {
        throw new Error(`${node.id}: размеры слишком велики для точного расчёта.`);
      }
      nodes.push(descriptor);
      byId[node.id] = descriptor;
    }
    if (!Object.hasOwn(byId, this.outputId)) throw new Error('Выберите выход модели.');

    // Входы всегда идут раньше слоя. Идём с конца и отмечаем путь к выходу
    const used = { [this.outputId]: true };
    for (let i = nodes.length - 1; i >= 0; i--) {
      const node = nodes[i];
      node.active = Boolean(used[node.id]);
      if (node.active) {
        for (const id of node.inputs) used[id] = true;
      }
    }
    let parameters = 0, flops = 0, activationElements = 0, bufferBytes = 0, unused = 0;
    for (const node of nodes) {
      if (!node.active) { unused++; continue; }
      parameters += node.parameters;
      flops += this.batchSize * node.flops;
      bufferBytes += node.buffers;
      // Flatten и Dropout в eval используют существующий тензор
      if (node.type !== 'flatten' && node.type !== 'dropout') {
        activationElements += this.batchSize * product(node.shape);
      }
    }
    if (![parameters, flops, activationElements].every(Number.isSafeInteger)) throw new Error('Размеры слишком велики для точного расчёта.');
    return { nodes, parameters, flops, activationElements, bufferBytes, outputShape: byId[this.outputId].shape, unused };
  }

  memory(bytesPerValue, analysis = this.analyze()) {
    const weights = analysis.parameters * bytesPerValue;
    const activations = analysis.activationElements * bytesPerValue;
    return { weights, activations, buffers: analysis.bufferBytes, total: weights + activations + analysis.bufferBytes };
  }

  toPython(analysis = this.analyze()) {
    const active = analysis.nodes.filter(node => node.active && node.id !== 'input');
    const variable = id => id === 'input' ? 'x' : id;
    const lines = ['import torch', 'import torch.nn as nn', '', '', 'class CustomModel(nn.Module):', '    def __init__(self):', '        super().__init__()'];
    active.filter(node => node.module).forEach(node => lines.push(`        self.${node.id} = ${node.module}`));
    lines.push('', '    def forward(self, x):', `        # x: [N, ${this.inputShape.join(', ')}]`);
    active.forEach(node => {
      const inputs = node.inputs.map(variable);
      let expression;
      if (node.type === 'add') expression = `${inputs[0]} + ${inputs[1]}`;
      else if (node.type === 'concat') expression = `torch.cat((${inputs.join(', ')}), dim=1)`;
      else expression = `self.${node.id}(${inputs[0]})`;
      lines.push(`        ${node.id} = ${expression}`);
    });
    lines.push(`        return ${variable(this.outputId)}`, '', '', 'model = CustomModel()', 'model.eval()');
    if (analysis.parameters > 0) lines.push(`optimizer = torch.optim.Adam(model.parameters(), lr=${this.learningRate})`);
    return lines.join('\n');
  }

  printToConsole() {
    const analysis = this.analyze();
    console.groupCollapsed('Конфигурация CustomModel');
    console.table(analysis.nodes.map(node => ({
      layer: node.id, type: node.title, inputs: node.inputs.join(', '),
      shape: `[${this.batchSize}, ${node.shape.join(', ')}]`,
      parameters: node.parameters, active: node.active,
    })));
    console.groupEnd();
  }

  toSearch() {
    return new URLSearchParams({ config: JSON.stringify(this) }).toString();
  }

  static fromSearch(search) {
    const serialized = new URLSearchParams(search).get('config');
    if (!serialized) return new ModelConfiguration();
    if (serialized.length > 50000) throw new Error('Слишком большая конфигурация.');
    try {
      const configuration = new ModelConfiguration(JSON.parse(serialized));
      configuration.analyze();
      return configuration;
    } catch (error) {
      throw new Error(`Не удалось прочитать конфигурацию: ${error.message}`);
    }
  }
}

if (typeof module !== 'undefined' && module.exports) module.exports = ModelConfiguration;
