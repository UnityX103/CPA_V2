import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import SettingsApp from "./SettingsApp";
import DevAlignApp from "./DevAlignApp";
import InputCounterApp from "./InputCounterApp";
import RemotePlayerCardApp from "./RemotePlayerCardApp";
import VideoPlayerApp from "./VideoPlayerApp";
import { useExtensionPackSync } from "./domain/extensionPacks";
import "./styles/global.css";

const which = new URLSearchParams(window.location.search).get("window");
const Root = which === "settings"
    ? SettingsApp
    : which === "video-player"
        ? VideoPlayerApp
    : which === "devalign"
        ? DevAlignApp
        : which === "input-counter"
                ? InputCounterApp
                : which === "remote-player"
                    ? RemotePlayerCardApp
                    : App;

function WindowRoot() {
    useExtensionPackSync({ enabled: which === null || which === "settings" });
    return <Root />;
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
        <WindowRoot />
    </React.StrictMode>,
);
