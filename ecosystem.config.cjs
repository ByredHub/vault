module.exports = {
  apps: [
    {
      name: 'vault-api',
      script: 'dev_server.py',
      interpreter: 'python3',
      cwd: '/opt/vault',
      env: {
        NODE_ENV: 'production',
      },
      max_restarts: 10,
      restart_delay: 3000,
      watch: false,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: '/opt/vault/logs/api-error.log',
      out_file: '/opt/vault/logs/api-out.log',
    },
    {
      name: 'vault-bot',
      script: '-m',
      args: 'bot.main',
      interpreter: 'python3',
      cwd: '/opt/vault',
      max_restarts: 10,
      restart_delay: 3000,
      watch: false,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: '/opt/vault/logs/bot-error.log',
      out_file: '/opt/vault/logs/bot-out.log',
    },
  ],
};
