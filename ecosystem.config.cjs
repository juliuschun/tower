const os = require("os");
const path = require("path");
const home = os.homedir();

const shared = {
  script: "dist/backend/packages/backend/index.js",
  autorestart: true,
  max_restarts: 10,
  min_uptime: "5s",
  restart_delay: 3000,
  merge_logs: true,
  log_date_format: "YYYY-MM-DD HH:mm:ss",
};

const sharedEnv = {
  NODE_ENV: "production",
  HOST: "0.0.0.0",
  GIT_AUTO_COMMIT: "true",
  WORKSPACE_ROOT: path.join(home, "workspace"),
  DEFAULT_CWD: path.join(home, "workspace"),
};

module.exports = {
  apps: [
    {
      ...shared,
      name: "tower",
      env: { ...sharedEnv, PORT: 32354 },
    },
    {
      ...shared,
      name: "tower-prod",
      env: { ...sharedEnv, PORT: 32364, PUBLIC_URL: "https://tower.moatai.app" },
    },
  ],
};
