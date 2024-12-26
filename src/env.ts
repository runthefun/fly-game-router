export const ENV = {
  // set in fly.toml
  TEMPLATE_APP: process.env.AWE_TEMPLATE_APP,
  TEMPLATE_MACHINE: process.env.AWE_TEMPLATE_MACHINE,
  POOL_APP: process.env.AWE_POOL_APP,
  FIREBASE_ADMIN_PROJECT_ID: process.env.FIREBASE_ADMIN_PROJECT_ID,
  FIREBASE_ADMIN_CLIENT_EMAIL: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,

  // set in the Fly.io dashboard secrets
  FLY_API_KEY: process.env.FLY_API_KEY,
  MONITOR_PASSWORD: process.env.MONITOR_PASSWORD,
  FIREBASE_ADMIN_PRIVATE_KEY: process.env.FIREBASE_ADMIN_PRIVATE_KEY,

  // injected by Fly
  CURRENT_APP: process.env.FLY_APP_NAME,

  //
};
