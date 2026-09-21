// pm2 is optional. `npm run dev:sandbox` runs the same server in the foreground.
// cwd resolves from this file so the config works in any checkout location.
const path = require('node:path');

module.exports = {
  apps: [{
    name: 'jeonse-shield',
    script: 'npx',
    args: 'wrangler pages dev dist --local --ip 0.0.0.0 --port 3000',
    cwd: path.resolve(__dirname),
    watch: false,
    instances: 1,
    exec_mode: 'fork'
  }]
};
