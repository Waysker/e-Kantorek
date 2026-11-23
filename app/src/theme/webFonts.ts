import { Platform } from "react-native";

const FONT_STYLESHEET =
  "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap";

// On web, load Inter and make it the default for every element under the app
// root. `#root *` outranks react-native-web's single-class default font rule,
// so no component has to set fontFamily itself. Native keeps the system font.
export function installWebFonts() {
  if (Platform.OS !== "web" || typeof document === "undefined") {
    return;
  }
  if (document.getElementById("partytura-fonts")) {
    return;
  }

  const preconnect = document.createElement("link");
  preconnect.rel = "preconnect";
  preconnect.href = "https://fonts.gstatic.com";
  preconnect.crossOrigin = "anonymous";
  document.head.appendChild(preconnect);

  const stylesheet = document.createElement("link");
  stylesheet.id = "partytura-fonts";
  stylesheet.rel = "stylesheet";
  stylesheet.href = FONT_STYLESHEET;
  document.head.appendChild(stylesheet);

  const style = document.createElement("style");
  style.textContent = [
    "#root *{font-family:Inter,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;",
    "font-feature-settings:'tnum' 1,'cv11' 1;}",
  ].join("");
  document.head.appendChild(style);
}
