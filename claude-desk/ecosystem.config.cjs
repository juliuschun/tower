module.exports = {
  apps: [{
    name: 'claude-desk',
    script: 'dist/backend/index.js',
    cwd: '/home/azureuser/tunnelingcc/claude-desk',
    env: {
      NODE_ENV: 'production',
      PORT: 32354,
      HOST: '0.0.0.0',
      DEFAULT_CWD: '/home/azureuser',
      WORKSPACE_ROOT: '/home/azureuser',
      GIT_AUTO_COMMIT: 'true',
      // NO_AUTH 미설정 → 인증 활성화 (admin/admin123)
    },
    // 크래시 시 자동 재시작
    autorestart: true,
    max_restarts: 10,
    min_uptime: '5s',
    restart_delay: 3000,
    // 로그
    error_file: '/home/azureuser/.pm2/logs/claude-desk-error.log',
    out_file: '/home/azureuser/.pm2/logs/claude-desk-out.log',
    merge_logs: true,
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
  }],
};
