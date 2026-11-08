export default { server: { proxy: { '/api': { target: 'http://localhost:8787', ws: true } } } };
