export const ENV = {
  //
  TEMPLATE_APP: process.env.AWE_TEMPLATE_APP,
  TEMPLATE_MACHINE: process.env.AWE_TEMPLATE_MACHINE,
  POOL_APP: process.env.AWE_POOL_APP,

  // secrets are set in the Fly.io dashboard
  FLY_API_KEY: process.env.FLY_API_KEY,
  MONITOR_PASSWORD: process.env.MONITOR_PASSWORD,

  // injected by Fly
  CURRENT_APP: process.env.FLY_APP_NAME,
};
