// PM2 Configuration for production deployment
module.exports = {
  apps: [
    {
      name: 'ai-calling-backend',
      script: './server.js',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
      },
      error_file: './logs/err.log',
      out_file: './logs/out.log',
      log_file: './logs/combined.log',
      merge_logs: true,
      time: true,
      max_memory_restart: '1G',
      autorestart: true,
      watch: false,
      // Graceful shutdown
      kill_timeout: 10000,
      listen_timeout: 10000,
      min_uptime: '10s',
      max_restarts: 10,
    },
  ],
};
