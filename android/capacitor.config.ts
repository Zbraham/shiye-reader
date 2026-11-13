import type { CapacitorConfig } from '@capacitor/cli'
import { KeyboardResize } from '@capacitor/keyboard'

const config: CapacitorConfig = {
  appId: 'com.shiye.reader',
  appName: '拾页',
  webDir: 'dist',
  android: {
    backgroundColor: '#F7F4EC',
    allowMixedContent: true,
    webContentsDebuggingEnabled: false
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: false,
      backgroundColor: '#F7F4EC',
      androidSplashResourceName: 'splash',
      showSpinner: false
    },
    Keyboard: {
      resize: KeyboardResize.Native,
      resizeOnFullScreen: true
    }
  }
}

export default config
