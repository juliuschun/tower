const os = require("os");
const path = require("path");
const home = os.homedir();

module.exports = {
  apps: [{
    name: "tower",
    script: "dist/backend/index.js",
    env: {
      NODE_ENV: "production",
      PORT: 32354,
      HOST: "0.0.0.0",
      GIT_AUTO_COMMIT: "true",
      WORKSPACE_ROOT: path.join(home, "workspace"),
      DEFAULT_CWD: path.join(home, "workspace"),
      PUBLIC_URL: "https://desk.moatai.app",
    },
    autorestart: true,
    max_restarts: 10,
    min_uptime: "5s",
    restart_delay: 3000,
    merge_logs: true,
    log_date_format: "YYYY-MM-DD HH:mm:ss",
  }],
};
