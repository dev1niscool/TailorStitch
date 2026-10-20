import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.tailorstitch.app',
  appName: 'TailorStitch',
  webDir: 'dist',
  backgroundColor: '#f6f5f0',
  ios: {
    contentInset: 'never',
    allowsLinkPreview: false,
  },
};

export default config;
