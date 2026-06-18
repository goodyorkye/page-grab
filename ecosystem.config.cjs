module.exports = {
  apps: [
    {
      name: 'page-grab-http',
      cwd: __dirname,
      script: 'python3',
      args: '-m http.server 20621',
      interpreter: 'none',
      autorestart: true,
      watch: false,
      time: true,
      env: {
        PYTHONUNBUFFERED: '1',
      },
    },
  ],
}
