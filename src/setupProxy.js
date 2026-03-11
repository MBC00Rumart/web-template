const { createProxyMiddleware } = require('http-proxy-middleware');

module.exports = function (app) {
  app.use(
    '/api',
    createProxyMiddleware({
      target: `http://localhost:${process.env.REACT_APP_DEV_API_SERVER_PORT || 3500}`,
      changeOrigin: true,
    })
  );
};