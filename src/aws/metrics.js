export function createMetrics({ namespace = 'Saathi', enabled = true, log = console.log } = {}) {
  return {
    emit(name, value = 1, dimensions = {}, unit = 'Count') {
      if (!enabled) return;
      const dimKeys = Object.keys(dimensions);
      log(JSON.stringify({
        _aws: {
          Timestamp: Date.now(),
          CloudWatchMetrics: [{ Namespace: namespace, Dimensions: [dimKeys], Metrics: [{ Name: name, Unit: unit }] }],
        },
        ...dimensions,
        [name]: value,
      }));
    },
  };
}
