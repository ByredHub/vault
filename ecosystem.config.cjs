module.exports = {
  apps: [
    {
      name: 'vault-api',
      script: '/root/vault/venv/bin/python3',
      args: 'dev_server.py',
      cwd: '/root/vault',
      max_restarts: 10,
      restart_delay: 3000,
      watch: false,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: '/root/vault/logs/api-error.log',
      out_file: '/root/vault/logs/api-out.log',
    },
    {
      name: 'vault-bot',
      script: '/root/vault/venv/bin/python3',
      args: '-m bot.main',
      cwd: '/root/vault',
      max_restarts: 10,
      restart_delay: 3000,
      watch: false,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: '/root/vault/logs/bot-error.log',
      out_file: '/root/vault/logs/bot-out.log',
    },
  ],
};
