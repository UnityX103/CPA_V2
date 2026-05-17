import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import SettingsApp from "./SettingsApp";
import DevAlignApp from "./DevAlignApp";
import "./styles/global.css";

const which = new URLSearchParams(window.location.search).get("window");
const Root = which === "settings" ? SettingsApp : which === "devalign" ? DevAlignApp : App;

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
        <Root />
    </React.StrictMode>,
);
