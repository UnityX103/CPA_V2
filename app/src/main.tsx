import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { clearHitRegions } from "./domain/passthrough";
import "./styles/global.css";

void clearHitRegions();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
        <App />
    </React.StrictMode>,
);
