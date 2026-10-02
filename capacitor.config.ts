import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'se.cuplex.bridgebuilder',
  appName: 'Bridge Builder',
  webDir: 'dist',
  android: {
    backgroundColor: '#0b1d38',
  },
  plugins: {
    SystemBars: {
      // Edge to edge: the page pads its HUD with env(safe-area-inset-*), as index.html sets viewport-fit=cover.
      insetsHandling: 'native',
      initialViewportFitValueHint: 'cover',
      // Light bar icons over the dark game.
      style: 'DARK',
    },
  },
};

export default config;
