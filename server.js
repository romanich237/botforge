const { createServer, start } = require('./backend/server');

if (require.main === module) start();

module.exports = { createServer };
