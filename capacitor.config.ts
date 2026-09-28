import type { CapacitorConfig } from "@capacitor/cli";

// The iOS app is the same Vite build as the website (`npm run build:ios`), served
// from the app bundle by a WKWebView. Nothing is loaded from the network.
const config: CapacitorConfig = {
  appId: "com.dnuke.frontierpainter",
  appName: "Frontier Painter",
  webDir: "dist",
  backgroundColor: "#05080f",
  ios: {
    contentInset: "never",
    scrollEnabled: false,
    preferredContentMode: "mobile",
  },
};

export default config;
