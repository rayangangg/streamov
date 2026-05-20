import React from "react";
import ReactDOM from "react-dom/client";
import { installWebShim } from "./web-shim";
import App from "./App";
import "./styles/global.css";

installWebShim();

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
