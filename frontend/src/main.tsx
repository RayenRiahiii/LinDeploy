import React from "react";
import ReactDOM from "react-dom/client";
import { createTheme, MantineProvider } from "@mantine/core";
import { Notifications } from "@mantine/notifications";
import { useLocalStorage } from "@mantine/hooks";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "@mantine/core/styles.css";
import "@mantine/notifications/styles.css";
import "./index.css";

const theme = createTheme({
  primaryColor: "red",
  defaultRadius: "md",
  fontFamily: '"Bahnschrift", "Segoe UI", Arial, sans-serif',
  headings: {
    fontFamily: '"Bahnschrift", "Segoe UI", Arial, sans-serif',
  },
  colors: {
    red: [
      "#fff0f0",
      "#ffd9d9",
      "#ffb0b0",
      "#ff8585",
      "#ff5a5a",
      "#ff3f3f",
      "#f52d2d",
      "#d91c1c",
      "#b81313",
      "#8f0a0a",
    ],
    dark: [
      "#d5d7e0",
      "#acaebf",
      "#8c8fa3",
      "#666980",
      "#4d4f66",
      "#34354a",
      "#2a2b3d",
      "#1c1d2b",
      "#14151f",
      "#0b0b10",
    ],
  },
  components: {
    Button: {
      defaultProps: {
        color: "red",
      },
    },
    Card: {
      defaultProps: {
        radius: "lg",
        shadow: "xl",
      },
    },
  },
});

function Root() {
  const [colorScheme, setColorScheme] = useLocalStorage<"dark" | "light">({
    key: "lindeploy-color-scheme",
    defaultValue: "dark",
  });

  return (
    <BrowserRouter>
      <MantineProvider theme={theme} forceColorScheme={colorScheme}>
        <Notifications />
        <App colorScheme={colorScheme} onToggleColorScheme={() => setColorScheme((current) => (current === "dark" ? "light" : "dark"))} />
      </MantineProvider>
    </BrowserRouter>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);
