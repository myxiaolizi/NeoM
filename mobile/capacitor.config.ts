import type { CapacitorConfig } from '@capacitor/cli'

/**
 * NeoM mobile shell (Android + iOS).
 *
 * Serving strategy
 *  - Production: the built web bundle is bundled INTO the app (webDir = ../web/dist),
 *    so the editor works offline and starts instantly. API traffic goes to
 *    https://m.zhengl.vip (absolute base injected through VITE_API_BASE at build time
 *    or window.__NEOM_API_BASE__ at runtime).
 *  - `server.url` is left undefined on purpose: a remote url would make the app a thin
 *    WebView wrapper with no offline support. For quick device testing set
 *    CAP_SERVER_URL=http://<lan-ip>:5273 to live-reload from the Vite dev server.
 *
 * appId must match the Android applicationId and the iOS bundle identifier.
 */
const devServerUrl = process.env.CAP_SERVER_URL || ''

const config: CapacitorConfig = {
  appId: 'vip.zhengl.neom',
  appName: 'NeoM',
  webDir: '../web/dist',

  /** Live-reload only (never shipped: env-gated). */
  ...(devServerUrl
    ? {
        server: {
          url: devServerUrl,
          cleartext: true,
          allowNavigation: ['m.zhengl.vip', '*.zhengl.vip']
        }
      }
    : {
        server: {
          androidScheme: 'https',
          iosScheme: 'capacitor',
          hostname: 'localhost',
          allowNavigation: ['m.zhengl.vip', '*.zhengl.vip']
        }
      }),

  android: {
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: true,
    /** Adjust resize delivers keyboard insets we consume in the styles. */
    adjustMarginsForEdgeToEdge: 'auto',
    buildOptions: {
      releaseType: 'AAB'
    }
  },

  ios: {
    /** Safe area is mandatory: the editor ships a bottom status bar. */
    contentInset: 'always',
    limitsNavigationsToAppBoundDomains: false,
    scrollEnabled: true,
    allowsLinkPreview: false,
    scheme: 'NeoM',
    backgroundColor: '#f3f4f7'
  },

  plugins: {
    SplashScreen: {
      launchShowDuration: 800,
      launchAutoHide: true,
      backgroundColor: '#f3f4f7',
      androidScaleType: 'CENTER_CROP',
      showSpinner: false,
      splashFullScreen: false,
      splashImmersive: false
    },
    StatusBar: {
      style: 'DEFAULT',
      backgroundColor: '#f3f4f7',
      overlaysWebView: false
    },
    Keyboard: {
      resize: 'native',
      style: 'default',
      resizeOnFullScreen: true
    },
    Filesystem: {
      iosScheme: 'capacitor'
    }
  }
}

export default config
