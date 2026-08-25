module.exports = {
  apps: [
    {
      name: 'cushyaccess-api',
      script: 'dist/src/main.js',
      instances: 'max',
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        APP_ROLE: 'api',
        RIDER_ORDER_OFFER_RADIUS_KM: 18,
      },
    },

    {
      name: 'cushyaccess-worker',
      script: 'dist/src/main.js',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: 4000,
        APP_ROLE: 'worker',
        RIDER_ORDER_OFFER_RADIUS_KM: 18,
      },
    },
  ],
};
