import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import SettingsApp from "./SettingsApp";
import DevAlignApp from "./DevAlignApp";
import InputCounterApp from "./InputCounterApp";
import RemotePlayerCardApp from "./RemotePlayerCardApp";
import VideoPlayerApp from "./VideoPlayerApp";
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

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
        <Root />
    </React.StrictMode>,
);
