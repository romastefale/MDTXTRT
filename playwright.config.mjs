import {defineConfig,devices} from '@playwright/test';

const port=4173;
const sizes=[['390',{width:390,height:844}],['1280',{width:1280,height:800}]];
const engines=[['chromium',devices['Desktop Chrome']],['webkit',devices['Desktop Safari']]];
const themes=['light','dark'];

export default defineConfig({
  testDir:'tests/browser',
  testMatch:'*.spec.mjs',
  fullyParallel:true,
  retries:process.env.CI?1:0,
  reporter:process.env.CI?[['list'],['github']]:'list',
  use:{baseURL:`http://127.0.0.1:${port}`},
  webServer:{command:'node tests/browser/static-server.mjs',port,reuseExistingServer:!process.env.CI},
  projects:engines.flatMap(([engine,device])=>sizes.flatMap(([size,viewport])=>themes.map(theme=>({
    name:`${engine}-${size}-${theme}`,
    use:{...device,viewport,colorScheme:theme}
  }))))
});
