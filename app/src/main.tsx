import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import SettingsApp from "./SettingsApp";
import DevAlignApp from "./DevAlignApp";
import { clearHitRegions } from "./domain/passthrough";
import "./styles/global.css";

const which = new URLSearchParams(window.location.search).get("window");
const Root = which === "settings" ? SettingsApp : which === "devalign" ? DevAlignApp : App;

// 仅主窗口需要重置透传命中表；子窗口（设置 / dev-align）有自己的窗体，不参与 passthrough。
if (!which) {
    void clearHitRegions();
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
        <Root />
    </React.StrictMode>,
);
