import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import SettingsApp from "./SettingsApp";
import DevAlignApp from "./DevAlignApp";
import VideoPlayerApp from "./VideoPlayerApp";
import InputCounterApp from "./InputCounterApp";
import RemotePlayerCardApp from "./RemotePlayerCardApp";
import "./styles/global.css";

const which = new URLSearchParams(window.location.search).get("window");
const Root = which === "settings"
    ? SettingsApp
    : which === "devalign"
        ? DevAlignApp
        : which === "video-player"
            ? VideoPlayerApp
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
