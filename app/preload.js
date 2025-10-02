const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('stoneware', {
  fetchHello: async (name='Stoneware') => (await fetch(`http://127.0.0.1:8000/hello?name=${encodeURIComponent(name)}`)).json(),
  fetchHealth: async () => (await fetch('http://127.0.0.1:8000/health')).json(),
  fetchLinear: async (formula='mpg~wt', dataName='mtcars') => {
    const res = await fetch(`http://127.0.0.1:8000/analyze/linear?data=${encodeURIComponent(dataName)}&formula=${encodeURIComponent(formula)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  },
  uploadCSV: async (file, name='my_data') => {
    const fd = new FormData();
    fd.append('name', name);
    fd.append('file', file);
    const res = await fetch('http://127.0.0.1:8000/data/upload', { method: 'POST', body: fd });
    if (!res.ok) throw new Error(`Upload failed: HTTP ${res.status}`);
    return res.json();
  }
});
