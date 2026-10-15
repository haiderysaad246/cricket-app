import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";

const pwaScript = document.createElement("script");
pwaScript.src = "/js/pwa.js";
pwaScript.async = false;
document.head.appendChild(pwaScript);

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
