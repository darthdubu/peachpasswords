import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.peach.passwords',
  appName: 'Peach Passwords',
  webDir: 'dist',
  server: {
    androidScheme: 'https'
  },
  android: {
    buildOptions: {
      keystorePath: undefined,
      keystoreAlias: undefined,
    },
    allowMixedContent: true
  },
  plugins: {
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#0f0f0f'
    },
    Keyboard: {
      resize: 'body'
    }
  }
};

export default config;
